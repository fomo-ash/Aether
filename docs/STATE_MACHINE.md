# State Machines: Aether

## 1. Commitment Lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> AWAITING_VERIFICATION : Formalized
    
    AWAITING_VERIFICATION --> VERIFIED_FULFILLED
    AWAITING_VERIFICATION --> VERIFIED_MISSED
    AWAITING_VERIFICATION --> UNRESOLVED
    
    PENDING --> CANCELLED
    AWAITING_VERIFICATION --> CANCELLED
```
**Note on Cancellation**: If a user cancels a commitment (and policy permits), it enters `CANCELLED`. It does *not* count as `MISSED` and does not apply penalties.

## 2. Bet Lifecycle

```mermaid
stateDiagram-v2
    [*] --> BET_PROPOSED
    BET_PROPOSED --> BET_FORMALIZED
    BET_FORMALIZED --> BET_ACTIVE
    
    BET_ACTIVE --> AWAITING_RESOLUTION
    AWAITING_RESOLUTION --> EVIDENCE_COLLECTION
    EVIDENCE_COLLECTION --> RESOLVED
    RESOLVED --> REPUTATION_SETTLED
    
    BET_ACTIVE --> CANCELLED
    BET_ACTIVE --> UNRESOLVED
```
