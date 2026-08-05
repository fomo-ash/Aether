# Contributing to FlowPilot

## 1. Purpose
This document outlines the strict engineering standards and coding philosophy required to contribute to the FlowPilot codebase. Because we are building a production-grade orchestration engine, adhering to these standards is non-negotiable to maintain velocity and minimize technical debt.

## 2. Core Architectural Philosophy
Before writing code, internalize these rules:
1. **The AI only plans.** Never write code where the AI actively executes tasks.
2. **Workers only execute.** Never give a worker access to the Orchestrator's database or knowledge of the broader DAG.
3. **Controllers are dumb.** Never put business logic in an Express controller. They only parse, validate, and respond.
4. **Events over RPC.** If Service A needs to tell Service B something happened, emit an event. Do not make a synchronous HTTP call between them.

## 3. Folder Structure & Dependency Rules

We use a Turborepo monorepo.
- `apps/`: Deployable applications (API, Dashboard).
- `services/`: Independent backend modules (Planner, Orchestrator, Worker).
- `packages/`: Reusable, strictly scoped internal libraries.

### Strict Dependency Rules
- Services and Apps may import `packages/*`.
- A `package` may **never** import an `app` or a `service`.
- Services may **never** import other services directly (e.g., the `api` cannot import the `orchestrator`). They must communicate via the shared `packages/queue` or `packages/events` abstraction.

## 4. Naming Conventions

- **Files and Folders:** Use `kebab-case.ts` (e.g., `workflow-service.ts`, `dependency-resolver.ts`).
- **Interfaces/Types:** Use PascalCase. Prefix with `I` is **banned** (use `Workflow`, not `IWorkflow`).
- **Classes:** PascalCase.
- **Functions/Variables:** camelCase.
- **Constants/Enums:** UPPER_SNAKE_CASE.
- **Database Tables:** snake_case, plural (e.g., `workflow_executions`).

## 5. Testing Strategy

Code without tests is legacy code the moment it is merged. We use `Jest`.
1. **Unit Tests:** Mandatory for all business logic, particularly DAG resolution, retry calculation, and prompt generation. Mock external dependencies (DB, Redis, Featherless).
2. **Integration Tests:** Required for API endpoints. These spin up a test Postgres database and verify the entire HTTP request lifecycle (from Zod validation to database insertion).
3. **End-to-End (E2E):** (Future) Will spin up the entire Docker Compose stack and run a real workflow from the API to the Worker and back.

## 6. Commit Conventions

We strictly follow [Conventional Commits](https://www.conventionalcommits.org/). This allows us to auto-generate changelogs and determine semantic version bumps.

- `feat:` A new feature.
- `fix:` A bug fix.
- `chore:` Maintenance (e.g., updating dependencies, refactoring).
- `docs:` Documentation changes.
- `test:` Adding missing tests.

*Example:* `feat(planner): add support for conditional branching in DAG generation`

## 7. Pull Request Review Checklist

Before requesting a review from a Senior/Principal Engineer, ensure:
- [ ] Zod schemas have been created/updated for all new inputs.
- [ ] No secrets or API keys are hardcoded.
- [ ] No synchronous calls were introduced between decoupled services.
- [ ] Unit tests cover both the happy path and the error boundaries.
- [ ] The `ARCHITECTURE.md` or `DOMAIN_MODEL.md` has been updated if structural changes were made.
- [ ] Commits follow the conventional format.
