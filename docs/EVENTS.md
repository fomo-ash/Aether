# System Events: Aether

## 1. Append-Only Audit Log
Aether records important lifecycle transitions into an immutable `events` table. Events cannot be silently modified.

## 2. Core Events
- `COMMITMENT_CREATED`
- `COMMITMENT_UPDATED`
- `VERIFICATION_SCHEDULED`
- `VERIFICATION_STARTED`
- `EVIDENCE_COLLECTED`
- `COMMITMENT_FULFILLED`
- `COMMITMENT_MISSED`
- `COMMITMENT_CANCELLED`
- `REPUTATION_REWARDED`
- `REPUTATION_PENALIZED`
- `BET_CREATED`
- `BET_ACCEPTED`
- `BET_RESOLUTION_STARTED`
- `BET_RESOLVED`
