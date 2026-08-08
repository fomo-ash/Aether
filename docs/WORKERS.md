# Verification Workers: Aether

## 1. Purpose
Workers execute deterministic verification code to query external sources of truth (e.g. GitHub APIs).

## 2. Verification Registry
Verification capabilities are registered using string identifiers in a code registry. 
*Example Capabilities:*
- `github.issue_status`
- `github.pull_request_status`
- `github.commit_exists`
- `github.ci_status`
- `github.release_exists`
- `http.endpoint_status`

## 3. Execution
Workers pull from BullMQ, run the explicit verification strategy, collect JSON Evidence, and determine a deterministic resolution (FULFILLED or MISSED). Workers are entirely idempotent.
