-- CreateEnum
CREATE TYPE "RewardPoolTransactionType" AS ENUM ('INITIAL_FUNDING', 'BET_REWARD', 'BET_BOOTSTRAP_REWARD', 'BET_FORFEIT', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('COMMITMENT_FULFILLED', 'COMMITMENT_MISSED', 'BET_WON', 'BET_LOST', 'BET_STAKE_LOCK', 'BET_STAKE_RELEASE', 'BET_STAKE_FORFEIT', 'BET_REWARD', 'BET_BOOTSTRAP_REWARD', 'BET_REFUND', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('BET_PROPOSED', 'BET_FORMALIZED', 'BET_ACTIVE', 'AWAITING_RESOLUTION', 'EVIDENCE_COLLECTION', 'RESOLVED', 'REPUTATION_SETTLED', 'UNRESOLVED', 'ACTIVE', 'AWAITING_VERIFICATION', 'FULFILLED', 'MISSED', 'CANCELLED', 'EXPIRED');

-- DropForeignKey
ALTER TABLE "commitments" DROP CONSTRAINT "commitments_bet_id_fkey";

-- DropForeignKey
ALTER TABLE "commitments" DROP CONSTRAINT "commitments_user_id_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_commitment_id_fkey";

-- DropForeignKey
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_commitment_id_fkey";

-- DropForeignKey
ALTER TABLE "resolutions" DROP CONSTRAINT "resolutions_commitment_id_fkey";

-- AlterTable
ALTER TABLE "bets" DROP COLUMN "final_verdict",
DROP COLUMN "resolution_date",
DROP COLUMN "title",
ADD COLUMN     "commitment_id" TEXT NOT NULL,
ADD COLUMN     "community_id" TEXT NOT NULL,
ADD COLUMN     "creator_id" TEXT NOT NULL,
ADD COLUMN     "deadline" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "is_bootstrap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "multiplier" INTEGER,
ADD COLUMN     "potential_payout" INTEGER NOT NULL,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "settlement_reference" TEXT,
ADD COLUMN     "stake" INTEGER NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "BetStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "commitments" DROP COLUMN "bet_id",
ADD COLUMN     "community_id" TEXT,
ADD COLUMN     "reward_penalty_policy" JSONB;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "bet_id" TEXT,
ALTER COLUMN "commitment_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "evidence" ADD COLUMN     "bet_id" TEXT,
ADD COLUMN     "metadata" JSONB,
ALTER COLUMN "commitment_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "resolutions" ADD COLUMN     "bet_id" TEXT,
ALTER COLUMN "commitment_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bootstrap_bets_used" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "default_repository" TEXT,
    "github_installation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_members" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "display_name" TEXT,
    "status" TEXT,

    CONSTRAINT "community_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_accounts" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "locked_balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reputation_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_pool" (
    "id" TEXT NOT NULL,
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reward_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_pool_transactions" (
    "id" TEXT NOT NULL,
    "reward_pool_id" TEXT NOT NULL,
    "type" "RewardPoolTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "bet_id" TEXT,
    "reference_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "reward_pool_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_transactions" (
    "id" TEXT NOT NULL,
    "reputation_account_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "commitment_id" TEXT,
    "bet_id" TEXT,
    "reference_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "reputation_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "community_id" TEXT,
    "pending_commitment_state_key" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_installations" (
    "id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "github_account_id" BIGINT NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_github_installations" (
    "user_id" TEXT NOT NULL,
    "github_installation_id" TEXT NOT NULL,

    CONSTRAINT "user_github_installations_pkey" PRIMARY KEY ("user_id","github_installation_id")
);

-- CreateTable
CREATE TABLE "community_github_installations" (
    "community_id" TEXT NOT NULL,
    "github_installation_id" TEXT NOT NULL,

    CONSTRAINT "community_github_installations_pkey" PRIMARY KEY ("community_id","github_installation_id")
);

-- CreateTable
CREATE TABLE "impact_accounts" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "impact_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impact_transactions" (
    "id" TEXT NOT NULL,
    "impact_account_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reference_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "impact_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_repositories" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "repository_full_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_platform_external_id_key" ON "user_identities"("platform", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "communities_platform_external_id_key" ON "communities"("platform", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_members_community_id_user_id_key" ON "community_members"("community_id", "user_id");

-- CreateIndex
CREATE INDEX "reputation_accounts_community_id_balance_idx" ON "reputation_accounts"("community_id", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "reputation_accounts_user_id_community_id_key" ON "reputation_accounts"("user_id", "community_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_pool_isGlobal_key" ON "reward_pool"("isGlobal");

-- CreateIndex
CREATE UNIQUE INDEX "reward_pool_transactions_reference_key_key" ON "reward_pool_transactions"("reference_key");

-- CreateIndex
CREATE UNIQUE INDEX "reputation_transactions_reference_key_key" ON "reputation_transactions"("reference_key");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_token_hash_key" ON "oauth_states"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_installation_id_key" ON "github_installations"("installation_id");

-- CreateIndex
CREATE INDEX "impact_accounts_community_id_balance_idx" ON "impact_accounts"("community_id", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "impact_accounts_user_id_community_id_key" ON "impact_accounts"("user_id", "community_id");

-- CreateIndex
CREATE UNIQUE INDEX "impact_transactions_reference_key_key" ON "impact_transactions"("reference_key");

-- CreateIndex
CREATE UNIQUE INDEX "community_repositories_community_id_repository_full_name_key" ON "community_repositories"("community_id", "repository_full_name");

-- CreateIndex
CREATE UNIQUE INDEX "bets_commitment_id_key" ON "bets"("commitment_id");

-- CreateIndex
CREATE UNIQUE INDEX "bets_settlement_reference_key" ON "bets"("settlement_reference");

-- CreateIndex
CREATE INDEX "bets_community_id_idx" ON "bets"("community_id");

-- CreateIndex
CREATE INDEX "commitments_community_id_idx" ON "commitments"("community_id");

-- CreateIndex
CREATE INDEX "events_bet_id_created_at_idx" ON "events"("bet_id", "created_at");

-- CreateIndex
CREATE INDEX "evidence_bet_id_idx" ON "evidence"("bet_id");

-- CreateIndex
CREATE UNIQUE INDEX "resolutions_bet_id_key" ON "resolutions"("bet_id");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_accounts" ADD CONSTRAINT "reputation_accounts_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_accounts" ADD CONSTRAINT "reputation_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_pool_transactions" ADD CONSTRAINT "reward_pool_transactions_reward_pool_id_fkey" FOREIGN KEY ("reward_pool_id") REFERENCES "reward_pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_transactions" ADD CONSTRAINT "reputation_transactions_reputation_account_id_fkey" FOREIGN KEY ("reputation_account_id") REFERENCES "reputation_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_transactions" ADD CONSTRAINT "reputation_transactions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_transactions" ADD CONSTRAINT "reputation_transactions_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_github_installations" ADD CONSTRAINT "user_github_installations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_github_installations" ADD CONSTRAINT "user_github_installations_github_installation_id_fkey" FOREIGN KEY ("github_installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_github_installations" ADD CONSTRAINT "community_github_installations_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_github_installations" ADD CONSTRAINT "community_github_installations_github_installation_id_fkey" FOREIGN KEY ("github_installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impact_accounts" ADD CONSTRAINT "impact_accounts_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impact_accounts" ADD CONSTRAINT "impact_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impact_transactions" ADD CONSTRAINT "impact_transactions_impact_account_id_fkey" FOREIGN KEY ("impact_account_id") REFERENCES "impact_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_repositories" ADD CONSTRAINT "community_repositories_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

