# Security: Aether

## 1. Trust & Authority
- Users cannot arbitrarily award themselves Reputation. Every transaction requires system-level authorization.
- The system prevents silent score manipulation through the immutable `ReputationTransaction` ledger.

## 2. Infrastructure
- No unrestricted shell execution based on user messages. Verification is strictly isolated to explicit API integrations (e.g. GitHub).
- Secrets (OAuth tokens) are managed via environment variables and never exposed in Caspian chat responses.

## 3. Worker Safety
Workers are idempotent. External API access relies on strict timeouts and robust retry behavior.
