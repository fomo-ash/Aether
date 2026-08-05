# services/planner
**Purpose:** Receives natural language, uses Featherless, produces structured workflow JSON. Never executes anything.
**Responsibilities:** Prompt templates, Providers, Workflow compiler, JSON validation, Model adapters.
**What it should NEVER do:** Execute tasks or manage state.
