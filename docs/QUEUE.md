# Queue: Aether

## 1. Architecture
Aether uses **BullMQ** running on **Redis**.

## 2. Usage
- **Verification**: Scheduled execution of external API checks.
- **Notifications**: Outbound messaging via Caspian.
- **Reputation**: Processing ledger transactions asynchronously to prevent race conditions.
