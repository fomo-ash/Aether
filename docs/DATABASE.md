# Database Design: FlowPilot

## 1. Purpose
This document outlines the relational database schema for FlowPilot. It focuses on the architectural design of tables, constraints, indexing strategies, and normalization choices.

Refer to [DOMAIN_MODEL.md](DOMAIN_MODEL.md) for conceptual entity definitions and [STATE_MACHINE.md](STATE_MACHINE.md) for valid state values.

## 2. Scope
The database acts as the strict source of truth for the Orchestrator. It uses PostgreSQL. We do not use the database as a high-frequency queue (that is delegated to Redis), but rather as the persistent ledger of workflow blueprints, execution state, and historical events.

## 3. Schema Design

### 3.1 `users`
**Columns:**
- `id` (UUID, Primary Key)
- `email` (VARCHAR, Unique)
- `api_key_hash` (VARCHAR, Unique, Nullable)
- `created_at` (TIMESTAMP)

### 3.2 `workflows`
**Columns:**
- `id` (UUID, Primary Key)
- `user_id` (UUID, Foreign Key -> `users.id`)
- `name` (VARCHAR)
- `trigger_type` (ENUM: 'MANUAL', 'WEBHOOK', 'CRON')
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

**Indexes:**
- B-Tree on `(user_id)` for fetching a user's workflows.

### 3.3 `step_definitions`
**Columns:**
- `id` (UUID, Primary Key)
- `workflow_id` (UUID, Foreign Key -> `workflows.id` ON DELETE CASCADE)
- `name` (VARCHAR) - Describes why this step exists.
- `description` (TEXT, Nullable)
- `task_id` (VARCHAR) - Identifies what code the worker should run. Dynamically resolved via the Task Registry rather than hardcoded enums.
- `payload_template` (JSONB) - Liquid/Handlebars template mapping previous outputs to this step's inputs.
- `retry_policy` (JSONB) - Defines max retries, backoff strategy.
- `depends_on` (JSONB) - Array of `step_definition_id`s that must complete first.

**Constraints:**
- The Orchestrator will enforce DAG cycle-checking at the application layer before inserting records here.

**Indexes:**
- B-Tree on `(workflow_id)`.

### 3.4 `workflow_executions`
**Columns:**
- `id` (UUID, Primary Key)
- `workflow_id` (UUID, Foreign Key -> `workflows.id` ON DELETE RESTRICT)
- `status` (ENUM: 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED')
- `started_at` (TIMESTAMP, Nullable)
- `completed_at` (TIMESTAMP, Nullable)
- `error_details` (JSONB, Nullable)

**Indexes:**
- B-Tree on `(workflow_id, status)` - Critical for the Orchestrator to find active vs completed runs.

### 3.5 `step_executions`
**Columns:**
- `id` (UUID, Primary Key)
- `execution_id` (UUID, Foreign Key -> `workflow_executions.id` ON DELETE CASCADE)
- `step_definition_id` (UUID, Foreign Key -> `step_definitions.id`)
- `worker_id` (UUID, Foreign Key -> `workers.id`, Nullable)
- `status` (ENUM: 'PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING')
- `input_payload` (JSONB, Nullable) - Fully resolved input data.
- `output_payload` (JSONB, Nullable) - Result from the worker.
- `attempt_count` (INT, Default 0)
- `updated_at` (TIMESTAMP)

**Indexes:**
- B-Tree on `(execution_id)` - Fast retrieval of the whole execution graph.
- B-Tree on `(status)` - Useful for identifying stalled steps.

### 3.6 `workers`
**Columns:**
- `id` (UUID, Primary Key)
- `hostname` (VARCHAR)
- `supported_taskIds` (JSONB) - Array of strings.
- `last_heartbeat` (TIMESTAMP)
- `status` (ENUM: 'ACTIVE', 'OFFLINE')

**Indexes:**
- B-Tree on `(status, last_heartbeat)` - Used by the Orchestrator to reap dead workers.

### 3.7 `events` (Audit/Log)
**Columns:**
- `id` (UUID, Primary Key)
- `execution_id` (UUID, Foreign Key -> `workflow_executions.id` ON DELETE CASCADE)
- `step_execution_id` (UUID, Nullable, Foreign Key -> `step_executions.id`)
- `event_type` (VARCHAR) - e.g., 'workflow.started', 'step.failed'
- `payload` (JSONB)
- `created_at` (TIMESTAMP)

**Indexes:**
- B-Tree on `(execution_id, created_at)` - To render the timeline of a workflow run in the Dashboard.

### 3.8 `notifications`
**Columns:**
- `id` (UUID, Primary Key)
- `execution_id` (UUID, Foreign Key -> `workflow_executions.id`)
- `channel` (VARCHAR)
- `message_body` (TEXT)
- `status` (ENUM: 'PENDING', 'SENT', 'FAILED')
- `dispatched_at` (TIMESTAMP, Nullable)

## 4. Design Decisions & Trade-offs

### 4.1 Task Registry vs Hardcoded Enums
- **Why Chosen (Task Registry):** We identify capabilities using a dynamic `task_id` string rather than a Prisma `enum TaskType`. This ensures the Orchestrator and Database never need a schema migration or redeployment when a new capability (e.g., `storage.s3.upload`) is added to the workers. New tasks are registered entirely in code within the `task-registry` package.

### 4.2 JSONB vs Relational Tables
- **Why Chosen (JSONB for Config):** The `payload_template`, `retry_policy`, and `depends_on` structures are inherently dynamic. Parsing a JSONB column is significantly faster for the Orchestrator than performing a 5-way JOIN to resolve step configuration.

### 4.3 Storing DAG Dependencies in JSONB vs Adjacency List Table
- **Why Chosen (JSONB Array):** The `depends_on` column in `step_definitions` stores parent IDs as a JSON array. Workflows are relatively small (usually < 20 steps). Querying a JSON array in Postgres using the `@>` operator is exceptionally fast, and it avoids the overhead of managing a complex many-to-many `step_dependencies` join table.
- **Alternatives Considered:** A dedicated `step_edges (parent_id, child_id)` table.
- **Why Rejected:** Over-engineered for the MVP. It requires complex recursive CTEs to resolve the graph, which adds unnecessary query latency when the orchestrator just needs the full DAG in memory to schedule.

### 4.4 Use of ON DELETE CASCADE vs RESTRICT
- **Why Chosen:** `workflow_executions` uses `RESTRICT` against `workflows`. We must *never* delete a Workflow Definition if it has historical executions. Conversely, deleting a `workflow_execution` cascades down to `step_executions` and `events`.
- **Alternatives Considered:** Soft-deletes across all tables.
- **Why Rejected:** Soft deletes dramatically complicate indexing (requiring `WHERE deleted_at IS NULL` on every index) and pollute foreign key constraints. We will hard delete cascading data or archive it instead.

## 5. Future Scalability & Improvements

### 5.1 The Event Table Bottleneck
- **MVP:** The `events` table sits in the primary Postgres instance.
- **Future Production:** As the system scales to thousands of concurrent workflows, the `events` table will see massive write-heavy throughput. We will need to:
  1. Partition the `events` table by `created_at` (e.g., monthly partitions).
  2. Implement a background chron job that archives events older than 30 days to S3 and deletes them from Postgres.
  3. Or, move `events` entirely out of Postgres into an OLAP database like ClickHouse designed for high-throughput immutable logging.

### 5.2 External Payload Storage
- **Future Production:** If the `input_payload` and `output_payload` JSONB columns in `step_executions` exceed ~500KB frequently, they will cause TOAST table bloat in Postgres, slowing down sequential scans. We will need to implement a transparent "Payload Offloading" mechanism where the Orchestrator streams large JSON to S3 and only stores `{"s3_uri": "..."}` in Postgres.
