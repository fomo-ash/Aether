# Database Design: Aether

## 1. Schema Overview
Aether uses PostgreSQL and Prisma. Supabase may be used as the managed provider in production.

### 1.1 Community Models
- `communities`: Logical workspaces mapping a `platform` + `external_id` (e.g., a Discord server).
- `community_members`: Join table associating `users` to `communities`.

### 1.2 Reputation Models
- `reputation_accounts`: Tracks the aggregated balance of a user **within a specific community**. Contains a compound unique constraint on `[user_id, community_id]` and an index on `[community_id, balance]` optimized for Leaderboard queries.
- `reputation_transactions`: Immutable ledger. Includes `transaction_type`, `amount`, references to the `Commitment` or `Bet`, and an idempotency `reference_key` to prevent duplicate processing.

### 1.3 Core Commitment Models
- `commitments`: Contains `reward_penalty_policy` and core formalization data. Optionally linked to a `community_id`.
- `verification_policies`: Flexible configuration for verification sources. Uses string identifiers, not enums, for `verifier_type`.

### 1.4 Verification Models
- `evidence`: Point-in-time snapshots of external queries.
- `resolutions`: Explicit deterministic outcomes mapping evidence to `FULFILLED` or `MISSED`.

### 1.5 Bet Models
- `bets`: The overarching dispute entity linked to a `community_id`.
- `bet_participants`: Join table between Bets and Users, explicitly storing the `stake` (Reputation amount).

### 1.6 Events
- `events`: Append-only audit log for lifecycle state changes. Links to both Commitments and Bets.

## 2. Integrity and Deletions
Aether favors preserving historical auditability:
- Deleting a User or Community will Cascade into Memberships.
- However, `reputation_transactions`, `commitments`, and `evidence` use `Restrict` or `SetNull` foreign key policies where appropriate to prevent catastrophic blind cascades from destroying audit logs or the system's ledger history.
