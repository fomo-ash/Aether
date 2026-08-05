# @flowpilot/database

## Purpose
This package provides the central persistence layer and Prisma ORM client for the FlowPilot orchestration system. It acts as the single source of truth for all workflow definitions, execution states, and audit event logs.

## Responsibilities
- Define the PostgreSQL database schema (`schema.prisma`).
- Export a highly-available, singleton Prisma Client for use across the monorepo.
- Expose strongly-typed data access patterns.

## What it should NEVER do
- **No Orchestration Logic:** It must never contain business logic for evaluating DAGs or scheduling workers.
- **No Queueing:** It must never be used as a high-frequency polling queue for workers (we use Redis for this).

## Future Scalability Notes
- **Transient Worker State:** The `Worker` table was intentionally excluded from the MVP relational schema. Because workers emit high-frequency heartbeats (e.g., every 30 seconds), writing this to Postgres causes massive table bloat and unnecessary write IOPS. Worker presence and capability tracking is handled transparently in Redis (using expiring keys). `step_executions.workerId` is stored purely as a nullable UUID reference.
- **Payload Bloat:** If JSON payloads become large, they will be offloaded to an S3 bucket and only their URIs will be stored here.
- **Event Partitioning:** As the system scales, the `events` table will be partitioned chronologically.
