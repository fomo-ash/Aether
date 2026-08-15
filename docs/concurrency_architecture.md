# Verification Concurrency Architecture

The Aether Verification Processor (`processor.ts`) is designed to handle multiple workers picking up duplicated jobs (or reconciler safety nets running concurrently with delayed jobs) without ever duplicating reputation rewards or state changes.

This is achieved through a combination of pessimistic locking (atomic state transitions) and database constraints.

## 1. The Atomic State Transition (Optimistic Concurrency Control)

When the worker retrieves a commitment, it checks the external GitHub API first, *outside* the transaction.

Once the verification result is known (e.g., `FULFILLED`), the worker begins an atomic Prisma `$transaction`. The very first query is:

```typescript
const updateResult = await tx.commitment.updateMany({
  where: { 
    id: commitment.id, 
    status: 'AWAITING_VERIFICATION' // Only transition if it's STILL awaiting
  },
  data: { status: finalStatus } // e.g., VERIFIED_FULFILLED
});

if (updateResult.count === 0) {
  throw new Error('CONCURRENCY_LOCKED');
}
```

**Why this works:**
- PostgreSQL guarantees atomicity for this `UPDATE` statement.
- If **Worker A** and **Worker B** both start the transaction at the exact same millisecond, Worker A's update will transition the status from `AWAITING_VERIFICATION` to `VERIFIED_FULFILLED`. 
- By the time Worker B's update executes, the row no longer matches `status: 'AWAITING_VERIFICATION'`. Worker B receives `count === 0` and immediately aborts the rest of the transaction.
- Worker B safely returns a no-op, preventing duplicate Evidence, Resolution, and Reputation.

## 2. Idempotency Key (Database Unique Constraint)

Even if a developer manually attempts to inject a duplicate reputation transaction (bypassing the `updateMany` check), the database provides an absolute structural guarantee.

The `ReputationTransaction` model has a strict `@unique` constraint on the `referenceKey` column:

```typescript
const referenceKey = `commitment:${commitment.id}:fulfilled`;
```

If any transaction attempts to write `commitment:abc123:fulfilled` a second time, PostgreSQL natively throws a `P2002 Unique Constraint Violation`. 
Our catch block explicitly parses this:

```typescript
const target = err.meta?.target;
if (Array.isArray(target) && target.includes('reference_key')) {
  return { success: true, reason: 'p2002_idempotency_hit' };
}
```

## 3. Atomic Reputation Upsert

When tracking the community balance, the worker uses an atomic upsert based on the composite unique key `@@unique([userId, communityId])`:

```typescript
const account = await tx.reputationAccount.upsert({
  where: { userId_communityId: { userId, communityId } },
  create: { userId, communityId, balance: 0 },
  update: {}
});
```

This strictly prevents concurrent jobs from creating duplicate reputation accounts for the same user if they resolve their first two commitments at the exact same moment.

## Conclusion
The `processor.ts` logic guarantees that regardless of how many BullMQ jobs are accidentally enqueued or how many workers scale horizontally, the outcome of a verification resolution is absolutely **Idempotent**.
