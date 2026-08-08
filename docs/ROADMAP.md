# Roadmap: Aether

## PHASE 1 — FOUNDATION
- Express API
- PostgreSQL
- Prisma
- Redis
- BullMQ
- repositories
- events

## PHASE 2 — COMMITMENT ENGINE
- commitment extraction
- commitment formalization
- deadline handling
- verification policy
- lifecycle

## PHASE 3 — VERIFICATION
- Verification Registry
- GitHub integration
- issue verifier
- PR verifier
- commit verifier
- CI verifier
- release verifier
- evidence storage
- deterministic resolution

## PHASE 4 — REPUTATION
- ReputationAccount
- ReputationTransaction
- reward policies
- penalty policies
- fulfillment statistics
- audit ledger

## PHASE 5 — CASPIAN
- Discord
- Telegram
- Slack
- unified message handling

## PHASE 6 — THE BET
- disagreement detection
- claim formalization
- participants
- reputation stakes
- resolution criteria
- evidence
- verdict
- reputation settlement
- receipts

## PHASE 7 — HARDENING
- idempotency
- retries
- observability
- rate limiting
- security
- failure recovery
- production deployment

## PHASE 8 — FUTURE EXPANSIONS (IDEAS)
- **Expand the Verification Registry**: Add integrations for Strava API (e.g., "I'll run 5k by Sunday"), Vercel API ("I'll ship the frontend"), and LeetCode ("I'll solve 5 mediums").
- **The "Oracle" Fallback (Community Vote)**: For bets that cannot be deterministically verified via an API (e.g., "My design will look better than yours"), introduce a \`COMMUNITY_VOTE\` verification policy where community members vote to resolve the bet, acting as a human oracle.
