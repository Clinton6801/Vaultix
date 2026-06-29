import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { EscrowEventStore } from '../entities/escrow-event-store.entity';
import { EscrowEventType } from '../enums/escrow-event-type.enum';

export interface AppendEventDto {
  escrowId: string;
  eventType: EscrowEventType;
  actorId?: string | null;
  payload?: Record<string, unknown>;
  txHash?: string | null;
  idempotencyKey?: string;
}

export interface TimelineEntry {
  version: number;
  eventType: EscrowEventType;
  description: string;
  actorId: string | null;
  occurredAt: Date;
  txHash: string | null;
  payload?: Record<string, unknown>;
}

export interface ReplayResult {
  reconstructedState: Record<string, any>;
  currentState: Record<string, any>;
  inconsistencies: string[];
  isConsistent: boolean;
}

@Injectable()
export class EscrowEventStoreService {
  constructor(
    @InjectRepository(EscrowEventStore)
    private eventStoreRepository: Repository<EscrowEventStore>,
  ) {}

  /**
   * Append an event to the event store
   * - Auto-generates idempotencyKey if not provided
   * - Auto-increments version for the escrow
   * - On duplicate idempotencyKey: returns existing event (idempotent)
   * - NEVER updates or deletes events
   */
  async append(dto: AppendEventDto): Promise<EscrowEventStore> {
    const idempotencyKey = dto.idempotencyKey || uuidv4();

    // Check if this event already exists (by idempotencyKey)
    const existingEvent = await this.eventStoreRepository.findOne({
      where: {
        escrowId: dto.escrowId,
        idempotencyKey,
      },
    });

    if (existingEvent) {
      // Idempotent: return existing event
      return existingEvent;
    }

    // Get current max version for this escrowId
    const maxVersionResult = await this.eventStoreRepository
      .createQueryBuilder('event')
      .select('MAX(event.version)', 'maxVersion')
      .where('event.escrowId = :escrowId', { escrowId: dto.escrowId })
      .getRawOne();

    const maxVersion = maxVersionResult?.maxVersion || 0;
    const nextVersion = maxVersion + 1;

    // Insert the new event (use repository.insert for append-only)
    const insertResult = await this.eventStoreRepository.insert({
      id: uuidv4(),
      escrowId: dto.escrowId,
      version: nextVersion,
      eventType: dto.eventType,
      actorId: dto.actorId ?? null,
      payload: dto.payload ?? {},
      occurredAt: new Date(),
      txHash: dto.txHash ?? null,
      idempotencyKey,
    });

    // Retrieve and return the inserted event
    const newEvent = await this.eventStoreRepository.findOne({
      where: { id: insertResult.identifiers[0].id },
    });

    if (!newEvent) {
      throw new Error('Failed to retrieve inserted event');
    }

    return newEvent;
  }

  /**
   * Get paginated events for a specific escrow
   */
  async getEventsForEscrow(
    escrowId: string,
    filters?: {
      eventType?: EscrowEventType;
      page?: number;
      limit?: number;
    },
  ): Promise<{ events: EscrowEventStore[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const skip = (page - 1) * limit;

    let query = this.eventStoreRepository
      .createQueryBuilder('event')
      .where('event.escrowId = :escrowId', { escrowId })
      .orderBy('event.version', 'ASC');

    if (filters?.eventType) {
      query = query.andWhere('event.eventType = :eventType', {
        eventType: filters.eventType,
      });
    }

    const [events, total] = await query
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { events, total };
  }

  /**
   * Get paginated global events with optional filtering
   */
  async getGlobalEvents(filters?: {
    actorId?: string;
    eventType?: EscrowEventType;
    fromDate?: Date;
    toDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ events: EscrowEventStore[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 50;
    const skip = (page - 1) * limit;

    let query = this.eventStoreRepository
      .createQueryBuilder('event')
      .orderBy('event.occurredAt', 'DESC');

    if (filters?.actorId) {
      query = query.where('event.actorId = :actorId', {
        actorId: filters.actorId,
      });
    }

    if (filters?.eventType) {
      const whereClause = filters.actorId
        ? 'AND event.eventType = :eventType'
        : 'WHERE event.eventType = :eventType';
      query = query.andWhere('event.eventType = :eventType', {
        eventType: filters.eventType,
      });
    }

    if (filters?.fromDate) {
      query = query.andWhere('event.occurredAt >= :fromDate', {
        fromDate: filters.fromDate,
      });
    }

    if (filters?.toDate) {
      query = query.andWhere('event.occurredAt <= :toDate', {
        toDate: filters.toDate,
      });
    }

    const [events, total] = await query
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { events, total };
  }

  /**
   * Build a human-readable timeline from events
   */
  async buildTimeline(escrowId: string): Promise<TimelineEntry[]> {
    const events = await this.eventStoreRepository.find({
      where: { escrowId },
      order: { version: 'ASC' },
    });

    return events.map((event) => ({
      version: event.version,
      eventType: event.eventType,
      description: this.getEventDescription(event),
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      txHash: event.txHash,
      payload: event.payload,
    }));
  }

  /**
   * Replay all events for an escrow to reconstruct state
   * Returns comparison between reconstructed and current state
   */
  async replayEvents(escrowId: string): Promise<ReplayResult> {
    const events = await this.eventStoreRepository.find({
      where: { escrowId },
      order: { version: 'ASC' },
    });

    const reconstructedState = this.reconstructStateFromEvents(events);

    // For now, current state is placeholder (would be fetched from DB in real scenario)
    const currentState = {
      escrowId,
      eventCount: events.length,
      lastEventVersion: events.length > 0 ? events[events.length - 1].version : 0,
    };

    const inconsistencies = this.detectInconsistencies(
      reconstructedState,
      currentState,
    );

    return {
      reconstructedState,
      currentState,
      inconsistencies,
      isConsistent: inconsistencies.length === 0,
    };
  }

  /**
   * Prevent update or delete operations on events
   */
  async protectAppendOnly(): Promise<never> {
    throw new ForbiddenException(
      'Event store is append-only: updates and deletes are forbidden',
    );
  }

  // ===== PRIVATE HELPER METHODS =====

  private getEventDescription(event: EscrowEventStore): string {
    const payload = event.payload || {};

    const descriptions: Record<EscrowEventType, string> = {
      [EscrowEventType.CREATED]: 'Escrow created',
      [EscrowEventType.FUNDED]: `Escrow funded with ${payload.amount} ${payload.asset || 'XLM'}`,
      [EscrowEventType.CONDITION_FULFILLED]: `Condition fulfilled: ${payload.conditionDescription || '(no description)'}`,
      [EscrowEventType.CONDITION_CONFIRMED]: `Condition confirmed by ${payload.confirmedBy || 'system'}`,
      [EscrowEventType.MILESTONE_RELEASED]: `Milestone released: ${payload.milestoneDescription || '(no description)'}`,
      [EscrowEventType.PARTY_INVITED]: `Party invited: ${payload.partyEmail || payload.partyId || '(unknown)'}`,
      [EscrowEventType.PARTY_ACCEPTED]: `Party accepted invitation`,
      [EscrowEventType.PARTY_REJECTED]: `Party rejected invitation`,
      [EscrowEventType.DISPUTE_FILED]: `Dispute filed: ${payload.reason || '(no reason provided)'}`,
      [EscrowEventType.DISPUTE_RESOLVED]: `Dispute resolved: ${payload.outcome || '(no outcome recorded)'}`,
      [EscrowEventType.RELEASED]: `Funds released to ${payload.recipientId || '(unknown recipient)'}`,
      [EscrowEventType.CANCELLED]: `Escrow cancelled: ${payload.cancellationReason || '(no reason provided)'}`,
      [EscrowEventType.EXPIRED]: `Escrow expired`,
      [EscrowEventType.REFUND_PROCESSED]: `Refund processed to ${payload.refundRecipient || '(unknown)'}`,
      [EscrowEventType.EXPIRATION_WARNING]: `Expiration warning sent`,
    };

    return descriptions[event.eventType] || 'Unknown event';
  }

  private reconstructStateFromEvents(
    events: EscrowEventStore[],
  ): Record<string, any> {
    let state: Record<string, any> = {
      status: 'pending',
      isFunded: false,
      isReleased: false,
      isCancelled: false,
      isDisputed: false,
      isExpired: false,
      milestoneCount: 0,
      conditionsFulfilled: 0,
      eventsProcessed: 0,
    };

    for (const event of events) {
      state.eventsProcessed += 1;

      switch (event.eventType) {
        case EscrowEventType.CREATED:
          state.status = 'active';
          break;
        case EscrowEventType.FUNDED:
          state.isFunded = true;
          break;
        case EscrowEventType.CONDITION_FULFILLED:
          state.conditionsFulfilled += 1;
          break;
        case EscrowEventType.MILESTONE_RELEASED:
          state.milestoneCount += 1;
          break;
        case EscrowEventType.RELEASED:
          state.isReleased = true;
          state.status = 'completed';
          break;
        case EscrowEventType.CANCELLED:
          state.isCancelled = true;
          state.status = 'cancelled';
          break;
        case EscrowEventType.DISPUTE_FILED:
          state.isDisputed = true;
          state.status = 'disputed';
          break;
        case EscrowEventType.DISPUTE_RESOLVED:
          state.isDisputed = false;
          break;
        case EscrowEventType.EXPIRED:
          state.isExpired = true;
          state.status = 'expired';
          break;
      }
    }

    return state;
  }

  private detectInconsistencies(
    reconstructedState: Record<string, any>,
    currentState: Record<string, any>,
  ): string[] {
    const inconsistencies: string[] = [];

    // Check if event count doesn't match expectations
    if (
      reconstructedState.eventsProcessed !== currentState.eventCount &&
      currentState.eventCount !== undefined
    ) {
      inconsistencies.push(
        `Event count mismatch: reconstructed=${reconstructedState.eventsProcessed}, current=${currentState.eventCount}`,
      );
    }

    return inconsistencies;
  }
}
