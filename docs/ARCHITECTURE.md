# Architecture Overview: Aether

## 1. Purpose
Aether is a **multi-channel AI Commitment Engine**.

Core product statement:
*"Aether remembers what people say they will do, determines how that commitment can be verified, waits until the appropriate condition or deadline, checks the evidence, updates reputation, and comes back with the result."*

Aether is NOT a generic AI assistant, a general-purpose software orchestrator, an AI tutor, or a collection of unrelated specialized agents.

## 2. The Three Layers
The core system is strictly separated into three layers:

1. **COMMITMENT ENGINE**: Turns natural-language statements into structured commitments. Formalizes who, what, and when. Scoped to a Community.
2. **VERIFICATION ENGINE**: Uses deterministic code (not LLMs) to query external sources of truth (e.g., GitHub, HTTP) to collect evidence and evaluate success conditions.
3. **REPUTATION / REWARDS ENGINE**: An immutable, transaction-based ledger that rewards or penalizes users when commitments are resolved. Reputation is scoped to a Community.

## 3. The Bet
"The Bet" is the flagship social/hackathon experience built on top of these three layers. It identifies verifiable disagreements and formalizes them, using Reputation points as stakes. It does not introduce new infrastructure; it orchestrates the existing engines.

## 4. End-to-End Flow & Architecture

```text
                    Discord
                    Telegram
                    Slack
                       │
                       ▼
                    Caspian
                       │
                       ▼
                 Aether Handler
                       │
                       ▼
              Commitment Engine
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   Verification     Scheduler    Reputation
      Engine                       Engine
          │            │            │
          └────────────┼────────────┘
                       ▼
                    BullMQ
                       │
                       ▼
                Verification Workers
                       │
                ┌──────┴──────┐
                ▼             ▼
             GitHub          HTTP
                │             │
                └──────┬──────┘
                       ▼
                    Evidence
                       │
                       ▼
                   Resolver
                       │
                       ▼
                Reputation Ledger
                       │
                       ▼
                    Caspian
                       │
                       ▼
                   User
```

## 5. Tech Stack
- **Language**: TypeScript
- **Runtime**: Node.js
- **API**: Express
- **AI**: Featherless
- **Communication**: Caspian SDK
- **Database**: PostgreSQL (via Prisma ORM)
- **Queue**: BullMQ (backed by Redis)
- **Frontend**: Next.js + React (Tailwind CSS)
- **Infrastructure**: Docker / Docker Compose

### Managed Database
Supabase may be used as the managed PostgreSQL provider for deployment. However, Prisma continues to interact with PostgreSQL through standard `DATABASE_URL` connection strings. There is no Supabase-specific application coupling. Local Docker PostgreSQL is used for development.
