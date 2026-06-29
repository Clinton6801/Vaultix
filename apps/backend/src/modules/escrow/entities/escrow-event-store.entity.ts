import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
} from 'typeorm';
import { EscrowEventType } from '../enums/escrow-event-type.enum';

@Entity('escrow_event_store')
@Unique('UQ_escrow_idempotency', ['escrowId', 'idempotencyKey'])
@Index('IDX_escrow_version', ['escrowId', 'version'])
@Index('IDX_event_type_occurred', ['eventType', 'occurredAt'])
export class EscrowEventStore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  escrowId: string;

  @Column({ type: 'int' })
  version: number; // monotonically increasing per escrow

  @Column({ type: 'varchar' })
  eventType: EscrowEventType;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'varchar', nullable: true })
  txHash: string | null;

  @Column({ type: 'uuid' })
  idempotencyKey: string; // prevents duplicate events
}
