# services/worker
**Purpose:** Executes tasks. Workers are intentionally dumb.
**Responsibilities:** Receive Task -> Execute -> Return Result.
**What it should NEVER do:** Workers never plan, never schedule, never modify workflow state.
