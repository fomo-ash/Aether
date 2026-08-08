# API: Aether

## 1. Framework
The API uses **Express**. (Fastify is explicitly out of scope).

## 2. Responsibilities
- Receives webhooks from Caspian.
- Exposes Reputation and Commitment endpoints for the Next.js Dashboard.
- Enforces strict authorization, rate limiting, and Zod validation.
