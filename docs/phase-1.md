# Phase 1: Verification Engine & Worker Scaffolding

This document summarizes the technical implementation completed for the first vertical slice of the Aether Commitment Engine.

## 1. Goal
Prove the deterministic core of Aether. Ensure that a Commitment can be enqueued, checked against an external source of truth (GitHub), and idempotently settle a reputation transaction without relying on an LLM for truth.

## 2. Components Built

### A. Verification Registry (`packages/verification-registry`)
We created a centralized registry to hold deterministic verification plugins.

**Files Created:**
- `package.json` & `tsconfig.json`: Standard Turborepo TS setup, adding dependencies like `zod` and `@octokit/rest`.
- `src/types.ts`: Defines the strict TypeScript interfaces (`Verifier`, `VerificationPolicyContext`, `VerificationResult`) that all verification plugins must adhere to.
- `src/registry.ts`: Exports a singleton `Map` and `getVerifier()` function. This allows the database to store a simple string (e.g., `'github.issue_status'`) which maps to actual executable code without hardcoding enums.
- `src/index.ts`: The public entry point exporting the types and registry functions.
- `src/providers/github/issue-status.ts`: The actual GitHub verification plugin. It takes an issue string (e.g., `owner/repo#1`), uses `Octokit` to query the GitHub API, and evaluates whether the current issue state matches the `successCondition` specified by the user.

### B. BullMQ Worker (`services/worker`)
We repurposed the worker service into a dedicated BullMQ consumer designed for maximum reliability and idempotency.

**Files Created:**
- `package.json` & `tsconfig.json`: Configured the worker with dependencies on `@aether/database`, `@aether/verification-registry`, `bullmq`, and `ioredis`.
- `src/index.ts`: The entry point. Connects to Redis and boots the BullMQ `Worker` instance listening to the `verification-queue`.
- `src/processor.ts`: The core execution logic inside `processVerificationJob`. When a job is pulled:
  1. Fetches the `Commitment` and `VerificationPolicy` from PostgreSQL via Prisma.
  2. Dispatches the verification to the correct plugin via `getVerifier()`.
  3. Writes the raw GitHub API response to the database as immutable `Evidence`.
  4. Creates a `Resolution` record mapping to that evidence.
  5. **Idempotent Reputation**: Calculates reward/penalty and uses a `Prisma.$transaction` with a unique `referenceKey` (e.g., `commitment:123:fulfilled`) to write to `ReputationTransaction`. This guarantees that if the worker crashes and retries, a user's reputation is never accidentally credited twice.

### C. Test Script (`scripts/test-run.ts`)
Since the LLM parsing layer and Express API don't exist yet, we built a standalone test script.

**Files Created:**
- `services/worker/scripts/test-run.ts`: A script that seeds a mock `User`, `Community`, and `Commitment` directly into Postgres. It then pushes a raw job onto the BullMQ Redis queue. This allows developers to run `pnpm dev` in the worker directory and watch the entire deterministic loop execute from start to finish.

## 3. Current State
The backend foundation for verifying tasks and applying reputation safely is fully functional. The next steps will involve building the API to create these commitments, and the AI layer to extract them from natural language.

## 4. Docker Environment
To ensure a consistent development experience, we have containerized the entire backend infrastructure via `docker-compose.yml`.

### Services
- **`postgres`**: Runs the PostgreSQL database on port `5450:5432`.
- **`redis`**: Backs BullMQ queues and locks, exposed on port `6850:6379`.
- **`api`**: The Express server ingress, exposed on port `3250:3250`.
- **`worker`**: The BullMQ daemon that executes Verification Jobs.
- **`redisinsight`**: The official Redis Web GUI for inspecting queues, exposed on port `5540:5540`.

### Getting Started
Simply run:
\`\`\`bash
docker compose up --build -d
\`\`\`
This will spin up all dependencies and the Aether services locally without requiring Node or Postgres installed natively on your machine.
