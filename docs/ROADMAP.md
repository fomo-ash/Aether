# Development Roadmap: FlowPilot

## 1. Purpose
This document breaks down the development lifecycle of FlowPilot into actionable, sequential milestones. It is designed to get us to an MVP within two weeks, while setting the stage for future production hardening.

---

## Phase 1: Foundation (Current)
**Goal:** Establish the monorepo, database schema, and shared abstractions.
- **Deliverables:**
  - Initialize Turborepo, pnpm workspaces, and TypeScript configs.
  - Write all initial Architectural Documentation.
  - Implement the Prisma schema and run initial migrations (`packages/database`).
  - Build the Zod configuration and Pino logger wrappers (`packages/config`, `packages/logger`).
- **Success Criteria:** The monorepo builds successfully, the database spins up via Docker Compose, and all packages can be imported by empty services.

---

## Phase 2: Orchestrator MVP
**Goal:** Build the brain of the operation, assuming workflows are defined manually (bypassing the AI Planner for now).
- **Deliverables:**
  - Build the `packages/queue` abstraction (Redis BullMQ).
  - Implement DAG dependency resolution logic.
  - Implement state transition logic (updating `step_executions` statuses).
  - Implement the internal Event Bus and emit system events.
- **Success Criteria:** We can manually insert a Workflow Definition into Postgres, manually trigger an Execution via a script, and watch the Orchestrator successfully push steps into the Redis queue in the correct dependency order.

---

## Phase 3: Workers
**Goal:** Build the compute layer to consume the Orchestrator's queue.
- **Deliverables:**
  - Build the Worker service polling loop.
  - Implement 2 basic trusted task types (e.g., `HTTP_REQUEST`, `WAIT`).
  - Implement lock acquisition, execution timeouts, and result formatting.
  - Worker emits `step.completed` or `step.failed`.
- **Success Criteria:** Workers consume tasks from Redis, execute them, and the Orchestrator correctly marks the workflow as `COMPLETED`.

---

## Phase 4: AI Planner
**Goal:** Introduce the intelligence layer to replace manual workflow definitions.
- **Deliverables:**
  - Integrate with the Featherless API.
  - Build the System Prompt and JSON schemas mapping to our supported task types.
  - Implement the Zod validation and auto-correction loop.
  - Hook the Planner into the `apps/api` POST endpoint.
- **Success Criteria:** A user can POST "Wait 5 seconds then hit Google.com", and the API successfully triggers the Orchestrator to run that graph automatically.

---

## Phase 5: Channels & Notifications
**Goal:** Close the loop by notifying users of progress.
- **Deliverables:**
  - Build the Notification service.
  - Subscribe to `workflow.completed` and `workflow.failed` on the event bus.
  - Integrate the Caspian SDK to send alerts to a test Slack channel.
- **Success Criteria:** When a workflow finishes, a formatted Slack message appears.

---

## Phase 6: Observability Dashboard
**Goal:** Provide visual transparency into the system.
- **Deliverables:**
  - Build the Next.js `apps/dashboard`.
  - Connect it to the Postgres database for read-only metrics.
  - Render a visual tree (DAG) of a specific workflow execution.
- **Success Criteria:** We can watch a workflow's state update visually in the browser. (This concludes the MVP).

---

## Phase 7: Production Hardening (Post-MVP)
**Goal:** Prepare FlowPilot for SaaS scalability.
- **Deliverables:**
  - Migrate Redis Queues to AWS SQS or Kafka for durability.
  - Implement OAuth2, JWTs, and tenant isolation (RBAC).
  - Dockerize all services and deploy via Kubernetes.
  - Implement Sandboxed Workers (Firecracker/Docker) for untrusted user code execution.
  - Implement Fair-Share Scheduling in the Orchestrator.
- **Success Criteria:** The platform safely supports thousands of concurrent users and untrusted workflows without degradation or cross-tenant data leaks.
