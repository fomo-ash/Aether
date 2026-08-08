# Phase 2: Commitment API & Next Steps

This document summarizes the technical implementation completed for Phase 2 of the Aether Commitment Engine, as well as the overarching roadmap for the upcoming phases.

## 1. What We Built in Phase 2
We successfully created the ingress API layer to act as the bridge between external text/AI payloads and the core Postgres/BullMQ backend. 

The following components were implemented:
- **Validation:** Implemented strict `zod` schemas (`commitment.schema.ts`) to ensure incoming commitments (userId, communityId, deadline, verifierType, etc.) are perfectly formed before they touch the database.
- **Commitment Service & Verification Policy Creation:** Created a Prisma transaction-based service (`commitment.service.ts`) that idempotently creates the `VerificationPolicy` and links it to the newly created `Commitment`, while applying the correct reward/penalty rules.
- **BullMQ Scheduling:** Initialized the `verification-queue` producer (`producer.ts`). It dynamically calculates the delay between the current time and the commitment's deadline, safely queuing the job for future execution.
- **Commitment API:** Wired these layers together in an Express controller and mounted it at `POST /api/commitments`.

---

## 2. What Needs To Be Done Majorly (The Roadmap)

Following the successful scaffolding of the API, here are the major upcoming phases to complete the Aether vision:

### PHASE 3: Featherless Commitment Extraction
- **Goal:** Connect the AI layer.
- **Details:** When raw text is received, pass it to the Featherless LLM to extract structured JSON (target, policy, deadline, stakes) that seamlessly feeds into the Phase 2 Commitment API.

### PHASE 4: Caspian + Discord
- **Goal:** Real-world ingress.
- **Details:** Integrate the Caspian SDK to receive live messages from Discord channels, routing them into the Phase 3 extraction pipeline.

### PHASE 5: Community Leaderboard
- **Goal:** Social visibility.
- **Details:** Build out the leaderboard queries and API endpoints to dynamically rank users based on their `ReputationAccount` balances within specific communities.

### PHASE 6: The Bet
- **Goal:** Complex orchestration.
- **Details:** Implement the logic for multi-user disputes. Formalize claims into Bets, deduct reputation stakes upfront, resolve via evidence collection, and distribute the staked reputation to the winner.

### PHASE 7: Telegram + Slack
- **Goal:** Multi-channel expansion.
- **Details:** Expand the Caspian integration to support incoming and outgoing messages for Telegram and Slack, using the unified event architecture.

### PHASE 8: Production Hardening
- **Goal:** Scale and resilience.
- **Details:** Finalize rate limiting, idempotency edge cases, security protocols, robust error recovery, and Kubernetes/cloud deployment strategies.
