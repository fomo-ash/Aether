# apps/api
**Purpose:** Public API. Receives workflow requests, returns workflow status. Does not contain business logic.
**What it should NEVER do:** Do not implement scheduling or planning.
**Future scalability notes:** Designed to scale horizontally.
**Dependencies:** @flowpilot/types, @flowpilot/queue
