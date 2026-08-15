# 🌌 AETHER: The Autonomous AI Verifier & Reputation Engine

> **One Agent. Native Everywhere.** A high-performance, decentralized autonomous verification and prediction engine for developer communities — powered by **Caspian SDK**, **GitHub App API**, **Tavily AI Evidence Search**, **BullMQ**, and **PostgreSQL**.

---

## 🌟 Overview

**Aether** turns developer promises, technical milestones, and factual debates into verifiable, stake-backed actions. Whether in **Discord** or **Telegram**, Aether autonomously evaluates natural-language commitments, underwrites prediction markets, manages peer-to-peer 1v1 challenges, and maintains an uncheatable developer reputation ledger.

```mermaid
flowchart TD
    %% Ingress Layer
    subgraph Ingress ["Omnichannel Ingress - Caspian SDK"]
        Discord["Discord Guilds and DMs"]
        Telegram["Telegram Groups and DMs"]
        CaspianGateway["Caspian Gateway"]
        CommClient["Caspian CommClient Adapter"]
    end

    Discord -->|Events| CaspianGateway
    Telegram -->|Events| CaspianGateway
    CaspianGateway -->|Event Stream| CommClient

    %% Routing Layer
    subgraph Routing ["Identity and Context Normalization"]
        IdResolver["Platform Identity Resolver"]
        CmdParser["Slash Command Normalizer"]
    end

    CommClient --> IdResolver
    IdResolver --> CmdParser

    %% Core Application Layer
    subgraph CoreEngine ["Aether Core Engine"]
        API["REST API Router"]
        MultiplayerCtrl["Multiplayer Controller - 1v1 and Pools"]
        ReputationCtrl["Reputation and Impact Controller"]
        CheckCtrl["Stateless Fact-Check Controller"]
        CommitmentParser["NLP Commitment Parser"]
    end

    CmdParser --> API
    API --> MultiplayerCtrl
    API --> ReputationCtrl
    API --> CheckCtrl
    API --> CommitmentParser

    %% Worker and Execution Layer
    subgraph WorkerEngine ["Async Execution and Verification Engine"]
        BullMQ["BullMQ Job Queues"]
        Sweeper["5-Second Overdue Sweeper"]
        Verifier["Deterministic Verification Registry"]
        Resolver["Outcome Resolver and Evidence Scorer"]
        Settler["Multiplayer Settlement Engine"]
    end

    MultiplayerCtrl -->|Enqueue Job| BullMQ
    CommitmentParser -->|Enqueue Job| BullMQ
    BullMQ --> Verifier
    Sweeper -->|Poll Expired Markets| Verifier

    %% External Sources of Truth
    subgraph ExternalSources ["External Sources of Truth"]
        GitHub["GitHub App API - PRs, Issues, Commits"]
        Tavily["Tavily AI Multi-Source Web Search"]
        LLM["LLM Evidence Evaluator"]
    end

    Verifier -->|Query PR/Issue Status| GitHub
    Verifier -->|Scrape Web Evidence| Tavily
    CheckCtrl -->|Scrape Web Evidence| Tavily
    Tavily --> Resolver
    GitHub --> Resolver
    Resolver -->|Score Evidence| LLM
    Resolver --> Settler

    %% Data & State Store
    subgraph DataStore ["Persistence and Ledger Layer"]
        Postgres["PostgreSQL 15 - Prisma ORM<br/>Dual Rep and Impact Accounts, Bets, Pools"]
        Redis["Redis 7<br/>BullMQ State, Conversation Memory, Locks"]
    end

    Settler -->|Atomic Transaction| Postgres
    MultiplayerCtrl -->|Escrow Stake Lock| Postgres
    ReputationCtrl -->|Read Balances and Standings| Postgres
    BullMQ -.-> Redis
    Sweeper -.-> Redis

    %% Outbound Messaging
    subgraph Outbound ["Outbound Response Pipeline"]
        Responder["OutboundResponder Service"]
    end

    Settler -->|Resolution Embed| Responder
    CheckCtrl -->|Result Summary| Responder
    Responder -->|sendMessage| CommClient
    CommClient -.-> Discord
    CommClient -.-> Telegram
```

---

## 🚀 Key Capabilities & Features

### 1. 🥊 Head-to-Head 1v1 Peer Challenges
* **Open & Targeted Challenges**: Challenge a specific peer (`/aether challenge @user <stake> REP on <claim>`) or post an open challenge for anyone in the channel (`/aether challenge open <stake> REP on <claim>`).
* **Atomic Stake Escrow**: Both creator and opponent stakes are locked in PostgreSQL under serializable transactions.
* **Instant Automated Evidence Resolution**: Upon acceptance, Aether immediately queries the web/GitHub, evaluates truth probability, declares the winner, distributes the pot, and routes a 5% protocol fee to the system reward pool.

### 2. 📊 Multi-User Prediction Markets (Pools)
* **Community-Created Markets**: Create decentralized prediction pools (`/aether market create "<claim>" by <deadline>`).
* **Dynamic Odds Calculation**: Participants take YES or NO positions (`/aether bet <marketId> YES <amount>`).
* **Integer Dust & Proportional Math**: At the deadline, Aether's 5-second background sweeper settles the market, distributes the pot proportionally to winning positions, and accounts for integer rounding dust down to 0 REP precision.

### 3. 🎯 Single-Player Self-Staking & Bootstrap Bets
* **Custom Risk Multipliers**: Stake REP on personal milestones or factual claims with 2x, 3x, or 5x reward multipliers.
* **Solvency Underwriting**: Every bet checks the system `RewardPool` solvency before locking stakes.
* **Free Bootstrap Onboarding**: Brand new developers with 0 REP receive 3 free "Bootstrap Bets" to build their initial reputation.

### 4. 🤖 Autonomous GitHub Commitments
* **Continuous Tracking**: Track pull requests, issue closures, and deployments across tracked repositories.
* **Natural Language Deadlines**: Parses relative expressions (`by tomorrow`, `by 5 mins`, `by Friday 6pm`, `by August 31`).
* **Deterministic Verification**: Pulls live commits, merged PR status, and issue resolution directly via GitHub Webhooks & REST API.

### 5. 🔬 Stateless Fact-Checking (`/aether check`)
* **Zero Overhead Instant Checks**: Instantly verify factual claims using live Tavily AI multi-source evidence search without creating database records.

### 6. 🏆 Dual Reputation & Impact Economy
* **Global REP (Stakeable & Transferable)**: Currency used to stake in challenges, create prediction markets, and climb the global leaderboard.
* **Community Impact (Merit-Based & Non-Transferable)**: Proof-of-work score awarded exclusively when a developer closes issues, merges pull requests, or reviews code in a community's tracked repository.

---

## 🎮 Slash Commands Cheat Sheet

| Command | Description | Example |
| :--- | :--- | :--- |
| `/aether` or `/aether help` | Display interactive help menu | `/aether help` |
| `/aether rep` | View your REP balance, tier, and Impact score | `/aether rep` |
| `/aether leaderboard` | Global Reputation leaderboard | `/aether leaderboard` |
| `/aether impact` | View community-specific Impact score | `/aether impact` |
| `/aether impact leaderboard` | Community-specific Developer Impact rankings | `/aether impact leaderboard` |
| `/aether check <claim>` | Instant stateless fact-check | `/aether check "Python was released in 1991"` |
| `/aether bet <stake> REP on <mult>x <claim>` | Single-player self-staking bet | `/aether bet 20 REP on 2x Bitcoin is above $50k` |
| `/aether challenge open <stake> REP on <claim>` | Create open 1v1 challenge | `/aether challenge open 15 REP on Solana TPS > 50k` |
| `/aether challenge @user <stake> REP on <claim>` | Create targeted 1v1 challenge | `/aether challenge @alice 25 REP on PR #42 by Friday` |
| `/aether accept <id>` | Accept a pending 1v1 challenge | `/aether accept 43102252-e148...` |
| `/aether cancel <id>` | Cancel an open unaccepted challenge | `/aether cancel 43102252-e148...` |
| `/aether challenges` | List active challenges in current channel | `/aether challenges` |
| `/aether market create "<claim>" by <deadline>` | Create a prediction pool | `/aether market create "Bitcoin ATH in 2026" by tomorrow` |
| `/aether bet <marketId> YES/NO <stake>` | Take a position in a prediction market | `/aether bet f8a9b1... YES 50` |
| `/aether market <id>` | View market odds, pot size, and positions | `/aether market f8a9b1...` |
| `/aether markets` | List open prediction pools | `/aether markets` |

---

## 🛠️ Architecture & Tech Stack

* **Ingress & Omnichannel Gateway:** [Caspian SDK (`caspian-sdk`)](https://github.com/TryCaspian/caspian-sdk) — Unified Discord and Telegram connection with zero code duplication.
* **Core Backend & REST API:** Node.js, TypeScript, Express, Zod.
* **Asynchronous Workers & Schedulers:** BullMQ, Redis 7, 5-second polling sweepers.
* **Database & Concurrency:** PostgreSQL 15, Prisma ORM (row-level locking, atomic transactions, idempotency keys).
* **AI & Evidence Engines:** Tavily AI Multi-Source Web Search, Featherless / Groq / OpenAI LLMs.
* **Developer Integration:** GitHub App API (Webhooks, Octokit, Issue/PR continuous verification).

---

## ⚡ Quickstart & Local Setup

### 1. Prerequisites
* [Docker Desktop](https://www.docker.com/products/docker-desktop/)
* [Node.js 20+](https://nodejs.org/) & [pnpm](https://pnpm.io/)

### 2. Clone the Repository
```bash
git clone https://github.com/fomo-ash/Aether.git
cd Aether
pnpm install
```

### 3. Configure Environment Variables
Create a `.env` file in the root directory:
```env
# Database & Redis
DATABASE_URL="postgresql://user:password@localhost:5432/aether?schema=public"
REDIS_URL="redis://localhost:6379"

# Caspian Gateway
CASPIAN_API_KEY="your_caspian_api_key"
CASPIAN_BASE_URL="https://api.trycaspianai.com"

# Telegram Bot (via @BotFather)
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"

# Evidence & AI
TAVILY_API_KEY="your_tavily_api_key"
FEATHERLESS_API_KEY="your_llm_api_key"

# GitHub App (Optional for local development)
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
GITHUB_APP_SLUG="aether-accountability"
GITHUB_WEBHOOK_SECRET=""
```

### 4. Start the Entire Stack
```bash
docker-compose up --build -d
```
This boots:
* `postgres` (Port 5450 $\rightarrow$ 5432)
* `redis` (Port 6850 $\rightarrow$ 6379)
* `api` (Port 3250)
* `worker` (Background queues, settlement engine, overdue sweeper)
* `caspian` (Live Discord + Telegram gateway ingress)

---

## 🧪 Automated Testing & Validation Suites

Aether includes comprehensive end-to-end and concurrency validation suites:

```bash
# Run Phase 9: Developer Impact, Idempotency & Community Isolation Suite
npx tsx services/worker/src/test_phase9.ts

# Run Phase 10: Multiplayer 1v1, Prediction Pools & Concurrency Race Suite (15/15 Passed)
npx tsx services/worker/src/test_phase10.ts
```

---

## 📚 Detailed Documentation

For in-depth architectural and integration documentation:
* **[CASPIAN.md](file:///c:/Users/ASHUTOSH/Caspian-aether/Aether/CASPIAN.md)** — Detailed guide on Caspian SDK integration, omnichannel identity isolation, observed features, and developer suggestions.
* **[docs/aether_features_and_testing_guide.md](file:///c:/Users/ASHUTOSH/Caspian-aether/Aether/docs/aether_features_and_testing_guide.md)** — In-depth guide on betting mechanics, natural deadline parsing, and verification formulas.
* **[docs/concurrency_architecture.md](file:///c:/Users/ASHUTOSH/Caspian-aether/Aether/docs/concurrency_architecture.md)** — Race condition prevention, double-spend escrow guarantees, and integer dust accounting.
* **[docs/ARCHITECTURE.md](file:///c:/Users/ASHUTOSH/Caspian-aether/Aether/docs/ARCHITECTURE.md)** — System components, queues, and event lifecycles.
