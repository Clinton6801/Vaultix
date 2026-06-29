import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { EscrowEventStoreService } from './escrow-event-store.service';
import { EscrowEventStore } from '../entities/escrow-event-store.entity';
import { EscrowEventType } from '../enums/escrow-event-type.enum';

describe('EscrowEventStoreService', () => {
  let service: EscrowEventStoreService;
  let repository: Repository<EscrowEventStore>;

  const mockRepository = {
    insert: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowEventStoreService,
        {
          provide: getRepositoryToken(EscrowEventStore),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<EscrowEventStoreService>(EscrowEventStoreService);
    repository = module.get<Repository<EscrowEventStore>>(
      getRepositoryToken(EscrowEventStore),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('append', () => {
    it('should append an event with auto-incremented version', async () => {
      const escrowId = uuidv4();
      const eventId1 = uuidv4();
      const eventId2 = uuidv4();
      const idemKey1 = uuidv4();
      const idemKey2 = uuidv4();

      // Mock: no existing event
      mockRepository.findOne.mockResolvedValueOnce(null);
      // Mock: max version is 0 (no prior events)
      mockRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ maxVersion: 0 }),
      });
      // Mock: insert returns ID
      mockRepository.insert.mockResolvedValueOnce({
        identifiers: [{ id: eventId1 }],
      });
      // Mock: retrieve inserted event
      const event1 = {
        id: eventId1,
        escrowId,
        version: 1,
        eventType: EscrowEventType.CREATED,
        actorId: uuidv4(),
        payload: {},
        occurredAt: new Date(),
        txHash: null,
        idempotencyKey: idemKey1,
      };
      mockRepository.findOne.mockResolvedValueOnce(event1);

      const result1 = await service.append({
        escrowId,
        eventType: EscrowEventType.CREATED,
        actorId: event1.actorId,
        idempotencyKey: idemKey1,
      });

      expect(result1.version).toBe(1);
      expect(mockRepository.insert).toHaveBeenCalledTimes(1);

      // Reset for second event
      jest.clearAllMocks();

      // Mock: no existing event
      mockRepository.findOne.mockResolvedValueOnce(null);
      // Mock: max version is 1
      mockRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ maxVersion: 1 }),
      });
      // Mock: insert returns ID
      mockRepository.insert.mockResolvedValueOnce({
        identifiers: [{ id: eventId2 }],
      });
      // Mock: retrieve inserted event
      const event2 = {
        id: eventId2,
        escrowId,
        version: 2,
        eventType: EscrowEventType.FUNDED,
        actorId: uuidv4(),
        payload: { amount: 100 },
        occurredAt: new Date(),
        txHash: null,
        idempotencyKey: idemKey2,
      };
      mockRepository.findOne.mockResolvedValueOnce(event2);

      const result2 = await service.append({
        escrowId,
        eventType: EscrowEventType.FUNDED,
        actorId: event2.actorId,
        payload: { amount: 100 },
        idempotencyKey: idemKey2,
      });

      expect(result2.version).toBe(2);
      expect(mockRepository.insert).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent with same idempotencyKey', async () => {
      const escrowId = uuidv4();
      const eventId = uuidv4();
      const idemKey = uuidv4();

      const existingEvent = {
        id: eventId,
        escrowId,
        version: 1,
        eventType: EscrowEventType.CREATED,
        actorId: uuidv4(),
        payload: {},
        occurredAt: new Date(),
        txHash: null,
        idempotencyKey: idemKey,
      };

      // Mock: existing event found
      mockRepository.findOne.mockResolvedValueOnce(existingEvent);

      const result = await service.append({
        escrowId,
        eventType: EscrowEventType.CREATED,
        idempotencyKey: idemKey,
      });

      expect(result).toEqual(existingEvent);
      expect(mockRepository.insert).not.toHaveBeenCalled();
    });

    it('should generate idempotencyKey if not provided', async () => {
      const escrowId = uuidv4();
      const eventId = uuidv4();

      mockRepository.findOne.mockResolvedValueOnce(null);
      mockRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ maxVersion: 0 }),
      });
      mockRepository.insert.mockResolvedValueOnce({
        identifiers: [{ id: eventId }],
      });
      const event = {
        id: eventId,
        escrowId,
        version: 1,
        eventType: EscrowEventType.CREATED,
        actorId: null,
        payload: {},
        occurredAt: new Date(),
        txHash: null,
        idempotencyKey: expect.any(String),
      };
      mockRepository.findOne.mockResolvedValueOnce(event);

      const result = await service.append({
        escrowId,
        eventType: EscrowEventType.CREATED,
      });

      expect(result).toBeDefined();
      expect(mockRepository.insert).toHaveBeenCalledTimes(1);
      const callArgs = mockRepository.insert.mock.calls[0][0];
      expect(callArgs.idempotencyKey).toBeDefined();
    });
  });

  describe('getEventsForEscrow', () => {
    it('should return paginated events filtered by type', async () => {
      const escrowId = uuidv4();
      const events = [
        {
          id: uuidv4(),
          escrowId,
          version: 1,
          eventType: EscrowEventType.FUNDED,
          actorId: uuidv4(),
          payload: {},
          occurredAt: new Date(),
          txHash: null,
          idempotencyKey: uuidv4(),
        },
        {
          id: uuidv4(),
          escrowId,
          version: 2,
          eventType: EscrowEventType.FUNDED,
          actorId: uuidv4(),
          payload: {},
          occurredAt: new Date(),
          txHash: null,
          idempotencyKey: uuidv4(),
        },
      ];

      mockRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([events, 2]),
      });

      const result = await service.getEventsForEscrow(escrowId, {
        eventType: EscrowEventType.FUNDED,
        page: 1,
        limit: 20,
      });

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('buildTimeline', () => {
    it('should build timeline with human-readable descriptions', async () => {
      const escrowId = uuidv4();
      const events = [
        {
          id: uuidv4(),
          escrowId,
          version: 1,
          eventType: EscrowEventType.CREATED,
          actorId: uuidv4(),
          payload: {},
          occurredAt: new Date(),
          txHash: null,
          idempotencyKey: uuidv4(),
        },
        {
          id: uuidv4(),
          escrowId,
          version: 2,
          eventType: EscrowEventType.FUNDED,
          actorId: uuidv4(),
          payload: { amount: '100', asset: 'XLM' },
          occurredAt: new Date(),
          txHash: 'abc123',
          idempotencyKey: uuidv4(),
        },
        {
          id: uuidv4(),
          escrowId,
          version: 3,
          eventType: EscrowEventType.DISPUTE_FILED,
          actorId: uuidv4(),
          payload: { reason: 'Quality issue' },
          occurredAt: new Date(),
          txHash: null,
          idempotencyKey: uuidv4(),
        },
      ];

      mockRepository.find.mockResolvedValueOnce(events);

      const result = await service.buildTimeline(escrowId);

      expect(result).toHaveLength(3);
      expect(result[0].eventType).toBe(EscrowEventType.CREATED);
      expect(result[0].description).toBe('Escrow created');
      expect(result[1].description).toContain('100');
      expect(result[1].description).toContain('XLM');
      expect(result[2].description).toContain('Quality issue');
    });

    it('should return empty timeline for escrow with no events', async () => {
      const escrowId = uuidv4();

      mockRepository.find.mockResolvedValueOnce([]);

      const result = await service.buildTimeline(escrowId);

      expect(result).toEqual([]);
    });
  });

  describe('replayEvents', () => {
    it('should detect inconsistencies during replay', async () => {
      const escrowId = uuidv4();
      const events = [
        {
          id: uuidv4(),
          escrowId,
          version: 1,
          eventType: EscrowEventType.CREATED,
          actorId: uuidv4(),
          payload: {},
          occurredAt: new Date(),
          txHash: null,
          idempotencyKey: uuidv4(),
        },
        {
          id: uuidv4(),
          escrowId,
          version: 2,
          eventType: EscrowEventType.FUNDED,
          actorId: uuidv4(),
          payload: {},
          occurredAt: new Date(),
          txHash: null,
          idempotencyKey: uuidv4(),
        },
      ];

      mockRepository.find.mockResolvedValueOnce(events);

      const result = await service.replayEvents(escrowId);

      expect(result.reconstructedState).toBeDefined();
      expect(result.reconstructedState.status).toBe('active');
      expect(result.reconstructedState.isFunded).toBe(true);
      expect(result.reconstructedState.eventsProcessed).toBe(2);
    });

    it('should mark state as consistent when no mismatches', async () => {
      const escrowId = uuidv4();
      const events = [
        {
          id: uuidv4(),
          escrowId,
          version: 1,
          eventType: EscrowEventType.CREATED,
          actorId: uuidv4(),
          payload: {},
          occurredAt: new Date(),
          txHash: null,
          idempotencyKey: uuidv4(),
        },
      ];

      mockRepository.find.mockResolvedValueOnce(events);

      const result = await service.replayEvents(escrowId);

      expect(result.isConsistent).toBe(true);
      expect(result.inconsistencies).toHaveLength(0);
    });
  });

  describe('getGlobalEvents', () => {
    it('should filter global events by actorId and date range', async () => {
      const actorId = uuidv4();
      const events = [
        {
          id: uuidv4(),
          escrowId: uuidv4(),
          version: 1,
          eventType: EscrowEventType.CREATED,
          actorId,
          payload: {},
          occurredAt: new Date('2026-06-01'),
          txHash: null,
          idempotencyKey: uuidv4(),
        },
      ];

      mockRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([events, 1]),
      });

      const result = await service.getGlobalEvents({
        actorId,
        fromDate: new Date('2026-06-01'),
        toDate: new Date('2026-06-30'),
        page: 1,
        limit: 50,
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].actorId).toBe(actorId);
      expect(result.total).toBe(1);
    });
  });

  describe('protectAppendOnly', () => {
    it('should throw ForbiddenException when trying to update or delete', async () => {
      await expect(service.protectAppendOnly()).rejects.toThrow(
        'Event store is append-only',
      );
    });
  });
});
