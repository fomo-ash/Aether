# Notifications (Caspian): Aether

## 1. Single Agent Identity
Caspian is the core communication dependency. Aether uses ONE message handling architecture for Discord, Telegram, and Slack. 
We do NOT create separate `discordAgent` or `telegramAgent` implementations.

## 2. Routing
The same Commitment, Verification, and Reputation engines operate regardless of channel. When a resolution is reached, Caspian ensures the response is delivered to the originating channel and thread.
