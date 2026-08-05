# FlowPilot

FlowPilot is an AI Workflow Orchestrator.
Unlike ChatGPT, which simply responds with text, FlowPilot allows an AI to PLAN, EXECUTE, MONITOR and COMPLETE real workflows.

## Architecture Principles
- Monorepo (Turborepo + pnpm)
- Every service independently deployable
- Communication via events/APIs
- Clear separation of Planner -> Orchestrator -> Workers -> Notification
