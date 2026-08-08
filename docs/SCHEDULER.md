# Scheduler: Aether

## 1. Purpose
Aether waits until the appropriate condition or deadline to verify a commitment. The scheduler handles this temporal execution.

## 2. Implementation
When a Commitment enters `AWAITING_VERIFICATION`, a job is enqueued to **BullMQ** (Redis) with a `delay` matching the deadline.

Once the time expires, BullMQ pushes the job to the Verification Workers. PostgreSQL retains the `resolutionAt` timestamp to ensure delayed jobs can be recreated if Redis is restarted.
