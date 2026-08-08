# ROLE

You are a senior Staff Software Engineer at a company like Temporal, Netflix, or Stripe.

Your task is NOT to write the application yet.

Your ONLY task is to scaffold a production-grade monorepo architecture for an AI Workflow Orchestration Platform.

The generated folder structure should look like something that could scale from a hackathon MVP into a production SaaS.

Do NOT generate implementation code.

Only generate:

- folders
- placeholder files
- README.md files explaining the responsibility of each module
- package.json files where appropriate
- tsconfig setup
- turbo configuration
- pnpm workspace configuration
- docker compose skeleton
- environment examples
- configuration files

Everything should follow clean architecture principles.

---

# PROJECT OVERVIEW

The project is called **FlowPilot**.

FlowPilot is an AI Workflow Orchestrator.

Unlike ChatGPT, which simply responds with text, FlowPilot allows an AI to PLAN, EXECUTE, MONITOR and COMPLETE real workflows.

Example:

User (Slack):

"Compress today's images, extract text, generate captions, upload everything to S3 and notify me."

The AI converts this request into a DAG (workflow graph).

The orchestrator schedules the execution.

Workers execute each step.

Progress is continuously reported back to the user through Caspian.

---

# MAIN GOAL

The AI should NOT execute tasks directly.

Instead it should act as a PLANNER.

Execution is delegated to workers.

Therefore the architecture must clearly separate:

Planner

↓

Orchestrator

↓

Workers

↓

Notification

Each service should have a single responsibility.

---

# ARCHITECTURE PRINCIPLES

Use a monorepo.

Use pnpm workspaces.

Use Turborepo.

Every service must be independently deployable.

Every service must communicate using events or APIs.

The architecture should be modular enough that individual services can later become microservices without major refactoring.

Do NOT tightly couple services together.

---

# TECH STACK

Monorepo:
- Turborepo
- pnpm

Backend:
- Fastify
- TypeScript

Frontend:
- Next.js
- React

Database:
- PostgreSQL
- Prisma

Cache / Queue:
- Redis

Validation:
- Zod

Logging:
- Pino

AI:
- Featherless API (OpenAI-compatible)

Messaging:
- Caspian SDK

Containerization:
- Docker

Future Orchestration:
- Kubernetes

---

# IMPORTANT DESIGN DECISION

The scheduler should NEVER know whether work is executed by:

- local worker
- docker container
- kubernetes pod
- remote executor

Instead expose a generic Executor interface.

This abstraction allows replacing Docker workers with Kubernetes later without changing scheduler logic.

---

# SERVICES TO CREATE

Create the following services.

Each should contain a README explaining WHY it exists.

---

apps/api

Purpose:

Public API.

Receives workflow requests.

Returns workflow status.

Does not contain business logic.

---

apps/dashboard

Purpose:

Visualizes workflows.

Displays DAG.

Displays worker status.

Displays logs.

Displays queue status.

Displays retries.

---

services/planner

Purpose:

Receives natural language.

Uses Featherless.

Produces structured workflow JSON.

Never executes anything.

Responsibilities:

- Prompt templates
- Providers
- Workflow compiler
- JSON validation
- Model adapters

---

services/orchestrator

Purpose:

The brain of execution.

Responsible for:

- DAG resolution
- Scheduling
- Retry logic
- Queue management
- State transitions
- Workflow lifecycle
- Dependency resolution

Never communicates directly with users.

---

services/worker

Purpose:

Executes tasks.

Workers are intentionally dumb.

They simply receive:

Task

↓

Execute

↓

Return Result

Workers never plan.

Workers never schedule.

Workers never modify workflow state.

---

services/channel

Purpose:

Communication layer.

Uses Caspian.

Supports:

Slack

Telegram

Discord

Future:

WhatsApp

Email

All channels should expose the same interface.

---

services/notification

Purpose:

Formats messages.

Sends progress updates.

Sends completion notifications.

Sends failure notifications.

Does not know anything about workflow scheduling.

---

packages/shared

Purpose:

Shared constants.

Shared utilities.

Common helpers.

---

packages/types

Purpose:

Shared TypeScript interfaces.

Workflow

Step

Worker

Planner

Queue

Events

No duplicate interfaces anywhere.

---

packages/logger

Purpose:

Central logging.

Pino setup.

Request IDs.

Trace IDs.

---

packages/config

Purpose:

Environment management.

Zod validation.

Config loading.

---

packages/database

Purpose:

Prisma.

Repositories.

Database client.

Migrations.

---

packages/queue

Purpose:

Hide Redis implementation.

Expose:

enqueue()

dequeue()

publish()

consume()

No service should directly import Redis.

---

packages/events

Purpose:

Shared event definitions.

WorkflowStarted

WorkflowCompleted

WorkerFinished

RetryRequested

etc.

---

packages/sdk

Purpose:

Internal SDK allowing services to communicate through common interfaces.

---

infrastructure

Purpose:

Contains infrastructure definitions.

Redis

Postgres

Monitoring

Docker

Future Kubernetes manifests.

---

docker

Purpose:

Dockerfiles for every service.

---

kubernetes

Purpose:

Keep empty initially.

Only scaffold manifests.

The application should still work locally without Kubernetes.

---

docs

Purpose:

System documentation.

Architecture

Execution Flow

Planner

Scheduler

Worker Lifecycle

API

Deployment

Future Roadmap

---

scripts

Purpose:

Developer tooling.

Seed.

Reset.

Dev helpers.

Benchmarks.

---

# ROOT FILES

Generate:

README.md

package.json

pnpm-workspace.yaml

turbo.json

docker-compose.yml

.env.example

.gitignore

.prettierrc

.eslintrc

tsconfig.base.json

---

# README REQUIREMENTS

Every module must contain:

Purpose

Responsibilities

What it should NEVER do

Future scalability notes

Dependencies

---

# IMPORTANT

Do NOT generate business logic.

Do NOT implement APIs.

Do NOT implement scheduler.

Do NOT implement planner.

Only scaffold the architecture.

The resulting repository should feel like a production-grade backend system built by experienced backend engineers rather than a typical hackathon project.