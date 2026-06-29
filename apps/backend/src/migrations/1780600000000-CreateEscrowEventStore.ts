import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEscrowEventStore1780600000000 implements MigrationInterface {
  name = 'CreateEscrowEventStore1780600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the escrow_event_store table with SQLite syntax
    await queryRunner.query(
      `
      CREATE TABLE "escrow_event_store" (
        "id" varchar PRIMARY KEY NOT NULL,
        "escrowId" varchar NOT NULL,
        "version" integer NOT NULL,
        "eventType" varchar NOT NULL,
        "actorId" varchar,
        "payload" text NOT NULL DEFAULT '{}',
        "occurredAt" datetime NOT NULL,
        "txHash" varchar,
        "idempotencyKey" varchar NOT NULL,
        UNIQUE ("escrowId", "idempotencyKey")
      )
      `,
    );

    // Create index on (escrowId, version) for efficient replay
    await queryRunner.query(
      `CREATE INDEX "IDX_escrow_version" ON "escrow_event_store" ("escrowId", "version")`,
    );

    // Create index on (eventType, occurredAt) for global filtering
    await queryRunner.query(
      `CREATE INDEX "IDX_event_type_occurred" ON "escrow_event_store" ("eventType", "occurredAt")`,
    );

    // Create index on escrowId alone for fast lookups
    await queryRunner.query(
      `CREATE INDEX "IDX_event_escrow_id" ON "escrow_event_store" ("escrowId")`,
    );

    // Create index on actorId for admin audit queries
    await queryRunner.query(
      `CREATE INDEX "IDX_event_actor_id" ON "escrow_event_store" ("actorId")`,
    );

    // Create index on idempotencyKey for deduplication checks
    await queryRunner.query(
      `CREATE INDEX "IDX_idempotency_key" ON "escrow_event_store" ("idempotencyKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_idempotency_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_event_actor_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_event_escrow_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_event_type_occurred"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_escrow_version"`);

    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "escrow_event_store"`);
  }
}
