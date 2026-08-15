# 🔗 Caspian SDK Integration Guide & Architecture

> **Aether + Caspian:** Building an omnichannel AI agent with unified business logic, zero duplicate code, and strict cross-platform identity isolation.

---

## 🌟 1. Why Caspian SDK?

Traditional multi-platform bots require building and maintaining separate adapters using disparate libraries (e.g. `discord.js`, `node-telegram-bot-api`, `@slack/bolt`). This introduces:
- Fragmented command parsing logic.
- Disconnected message lifecycles.
- Inconsistent identity management.

**Aether solves this using the official [Caspian SDK (`caspian-sdk`)](https://github.com/TryCaspian/caspian-sdk)**. With Caspian, Aether operates through a single `CommClient` instance where **Discord**, **Telegram**, and future channels funnel through one unified event pipeline.

---

## 🏗️ 2. Unified Pipeline Architecture

```
                 ┌───────────────────┐    ┌────────────────────┐
                 │   Discord Guild   │    │   Telegram Group   │
                 └─────────┬─────────┘    └──────────┬─────────┘
                           │                         │
                           ▼                         ▼
                 ┌─────────────────────────────────────────────┐
                 │             Caspian Gateway                 │
                 └──────────────────────┬──────────────────────┘
                                        │ (Event Stream)
                                        ▼
                 ┌─────────────────────────────────────────────┐
                 │       CommClient.onMessage(handler)         │
                 └──────────────────────┬──────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
        ┌───────────────────────┐               ┌───────────────────────┐
        │  Community Isolation  │               │   Identity Mapping    │
        │ [platform, connId]    │               │  [platform, userId]   │
        └───────────────────────┘               └───────────────────────┘
```

### Ingress Initialization
```typescript
import { CommClient } from 'caspian-sdk';

const client = new CommClient({
  apiKey: process.env.CASPIAN_API_KEY,
  baseUrl: process.env.CASPIAN_BASE_URL || 'https://api.trycaspianai.com'
});

// Connect Telegram bot dynamically when token is present
if (process.env.TELEGRAM_BOT_TOKEN) {
  await client.connectTelegram({
    botToken: process.env.TELEGRAM_BOT_TOKEN
  });
}

// Single handler listens across all channels (Discord, Telegram, Slack, etc.)
client.onMessage(async (message) => {
  // message.channel        -> 'discord' | 'telegram'
  // message.connectionId   -> Unique server/chat connection ID
  // message.sender.id      -> Unique platform user ID
  // message.conversationId -> Unique routing conversation ID
});
```

---

## 🛡️ 3. Platform & Community Identity Isolation

Aether guarantees strict security and partition across platforms using compound database keys in PostgreSQL:

### User Identity Mapping
```prisma
model UserIdentity {
  id         String @id @default(uuid())
  userId     String @map("user_id")
  platform   String // 'discord', 'telegram'
  externalId String @map("external_id") // Unique numeric platform ID

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([platform, externalId])
}
```
* **No Username Merging:** Users are **never** mapped by display name or username alone. Even if a user has identical usernames on Discord and Telegram (e.g. `@alice`), Aether provisions separate `UserIdentity` and `ReputationAccount` records.

### Community Isolation
```prisma
model Community {
  id         String   @id @default(uuid())
  platform   String   // 'discord', 'telegram'
  externalId String   @map("external_id") // Discord Guild ID or Telegram Chat ID
  
  @@unique([platform, externalId])
}
```
* Two different Telegram groups or Discord servers never share community-specific Impact points, active challenges, or prediction pools.

---

## ⚡ 4. Telegram Group Command Normalization

In Telegram group chats, slash commands often append the bot's username (e.g. `/aether@Aether_betbot rep`). Aether cleanly normalizes this at the ingress before command dispatch:

```typescript
let cleanText = message.text.trim();
if (cleanText.startsWith('/aether@')) {
  cleanText = cleanText.replace(/^\/aether@\w+/i, '/aether');
}
message.text = cleanText;
```
This ensures 100% command parity between Telegram direct messages, Telegram group chats, and Discord channels without modifying any downstream business logic.

---

## 🔮 5. Cool Features Observed in Caspian SDK

During our deep audit of `caspian-sdk`, we observed several powerful and elegant capabilities:

1. ⚡ **`client.typing(messageId)` Indicator**:
   - Triggers native "typing…" indicators in Discord and Telegram with a single call, giving real-time feedback while Aether's AI models gather web evidence.
2. 📜 **`client.backfill(conversationId, limit)`**:
   - Allows agents with `Capability.BACKFILL` to retrieve historical conversation messages prior to the bot joining the channel, ideal for contextual summarization.
3. 🎭 **`client.updateBranding(connectionId, { displayName, iconUrl })`**:
   - Enables dynamic, programmatic updates to the agent's nickname and avatar on a per-server basis without reinstalling the bot.
4. 📡 **`client.channels()` Capability Introspection**:
   - Programmatically inspects connected transports and their supported capabilities (`SEND`, `INITIATE`, `BACKFILL`) at runtime.
5. 🪝 **Seamless Webhook & Polling Support (`setWebhook` / `listen`)**:
   - Allows developers to run via long-polling in local development and seamlessly transition to webhook delivery in production.

---

## 💡 6. Suggestions & Feedback for the Caspian Team

Based on our implementation experience, here are architectural enhancements that would make the Caspian SDK even more powerful for developers:

### 1. Unified Rich Embed / Card Builder
* **Current state:** `client.sendMessage(conversationId, text, html)` accepts plaintext or HTML strings.
* **Suggestion:** Add a cross-platform `EmbedBuilder` or JSON Card schema (similar to Adaptive Cards) that automatically compiles to Discord Rich Embeds (`embeds: [...]`) on Discord and formatted HTML with inline button keyboards on Telegram.

### 2. Interactive Component & Callback Handlers
* **Current state:** Interactions are primarily text-message driven.
* **Suggestion:** Introduce an `onInteraction` or `onButtonCallback` listener in `CommClient` so agents can handle Discord Action Rows and Telegram Inline Buttons through a single unified handler:
  ```typescript
  client.onInteraction(async (interaction) => {
    if (interaction.customId === 'accept_challenge') {
      // Handles both Discord button clicks and Telegram inline callbacks!
    }
  });
  ```

### 3. Connection Lifecycle Hooks
* **Current state:** `connectTelegram()` returns a `Promise<Connection>`.
* **Suggestion:** Expose connection status event hooks (e.g. `client.onConnectionStateChange((conn) => ...)`) to simplify health checks, heartbeat reporting, and automatic reconnection logging in enterprise deployments.

---

## 🚀 Conclusion

By pairing Aether's autonomous verification engine with Caspian's unified communication gateway, developers gain an uncheatable, multi-platform accountability partner that lives natively where they already collaborate.
