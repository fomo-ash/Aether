-- CreateEnum
CREATE TYPE "MultiplayerBetType" AS ENUM ('HEAD_TO_HEAD', 'PREDICTION_POOL');

-- CreateEnum
CREATE TYPE "MultiplayerBetStatus" AS ENUM ('OFFERED', 'OPEN', 'ACTIVE', 'LOCKED', 'RESOLVING', 'RESOLVED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "multiplayer_bets" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "bet_type" "MultiplayerBetType" NOT NULL,
    "status" "MultiplayerBetStatus" NOT NULL DEFAULT 'OFFERED',
    "claim" TEXT NOT NULL,
    "normalized_claim" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "target_stake" INTEGER NOT NULL,
    "total_pot" INTEGER NOT NULL DEFAULT 0,
    "yes_pool" INTEGER NOT NULL DEFAULT 0,
    "no_pool" INTEGER NOT NULL DEFAULT 0,
    "fee_bps" INTEGER NOT NULL DEFAULT 0,
    "target_user_id" TEXT,
    "winner_user_id" TEXT,
    "winning_side" TEXT,
    "commitment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "multiplayer_bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multiplayer_bet_participants" (
    "id" TEXT NOT NULL,
    "multiplayer_bet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "payout" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "multiplayer_bet_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "multiplayer_bets_commitment_id_key" ON "multiplayer_bets"("commitment_id");

-- CreateIndex
CREATE INDEX "multiplayer_bets_community_id_status_idx" ON "multiplayer_bets"("community_id", "status");

-- CreateIndex
CREATE INDEX "multiplayer_bets_deadline_idx" ON "multiplayer_bets"("deadline");

-- CreateIndex
CREATE INDEX "multiplayer_bet_participants_multiplayer_bet_id_idx" ON "multiplayer_bet_participants"("multiplayer_bet_id");

-- CreateIndex
CREATE UNIQUE INDEX "multiplayer_bet_participants_multiplayer_bet_id_user_id_key" ON "multiplayer_bet_participants"("multiplayer_bet_id", "user_id");

-- AddForeignKey
ALTER TABLE "multiplayer_bets" ADD CONSTRAINT "multiplayer_bets_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiplayer_bets" ADD CONSTRAINT "multiplayer_bets_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiplayer_bets" ADD CONSTRAINT "multiplayer_bets_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiplayer_bets" ADD CONSTRAINT "multiplayer_bets_winner_user_id_fkey" FOREIGN KEY ("winner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiplayer_bets" ADD CONSTRAINT "multiplayer_bets_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiplayer_bet_participants" ADD CONSTRAINT "multiplayer_bet_participants_multiplayer_bet_id_fkey" FOREIGN KEY ("multiplayer_bet_id") REFERENCES "multiplayer_bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiplayer_bet_participants" ADD CONSTRAINT "multiplayer_bet_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
