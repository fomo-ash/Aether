/*
  Warnings:

  - You are about to drop the column `execution_id` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `step_execution_id` on the `events` table. All the data in the column will be lost.
  - You are about to drop the `step_definitions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `step_executions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workflow_executions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workflows` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `commitment_id` to the `events` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('PENDING', 'AWAITING_VERIFICATION', 'VERIFIED_FULFILLED', 'VERIFIED_MISSED', 'UNRESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('FULFILLED', 'MISSED', 'UNRESOLVED');

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_execution_id_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_step_execution_id_fkey";

-- DropForeignKey
ALTER TABLE "step_definitions" DROP CONSTRAINT "step_definitions_workflow_id_fkey";

-- DropForeignKey
ALTER TABLE "step_executions" DROP CONSTRAINT "step_executions_execution_id_fkey";

-- DropForeignKey
ALTER TABLE "step_executions" DROP CONSTRAINT "step_executions_step_definition_id_fkey";

-- DropForeignKey
ALTER TABLE "workflow_executions" DROP CONSTRAINT "workflow_executions_workflow_id_fkey";

-- DropForeignKey
ALTER TABLE "workflows" DROP CONSTRAINT "workflows_user_id_fkey";

-- DropIndex
DROP INDEX "events_execution_id_created_at_idx";

-- AlterTable
ALTER TABLE "events" DROP COLUMN "execution_id",
DROP COLUMN "step_execution_id",
ADD COLUMN     "commitment_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "step_definitions";

-- DropTable
DROP TABLE "step_executions";

-- DropTable
DROP TABLE "workflow_executions";

-- DropTable
DROP TABLE "workflows";

-- DropEnum
DROP TYPE "StepStatus";

-- DropEnum
DROP TYPE "TriggerType";

-- DropEnum
DROP TYPE "WorkflowStatus";

-- CreateTable
CREATE TABLE "bets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'PENDING',
    "resolution_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "final_verdict" TEXT,

    CONSTRAINT "bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "normalized_claim" TEXT NOT NULL,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3),
    "resolution_at" TIMESTAMP(3),
    "source_channel" TEXT NOT NULL,
    "source_conversation_id" TEXT NOT NULL,
    "source_message_id" TEXT NOT NULL,
    "bet_id" TEXT,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_policies" (
    "id" TEXT NOT NULL,
    "commitment_id" TEXT NOT NULL,
    "verifier_type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "success_condition" JSONB NOT NULL,
    "schedule" TEXT,
    "configuration" JSONB,

    CONSTRAINT "verification_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "commitment_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_identifier" TEXT,
    "payload" JSONB NOT NULL,
    "observed_state" TEXT NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolutions" (
    "id" TEXT NOT NULL,
    "commitment_id" TEXT NOT NULL,
    "status" "ResolutionStatus" NOT NULL,
    "result" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence_refs" JSONB NOT NULL,

    CONSTRAINT "resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commitments_user_id_idx" ON "commitments"("user_id");

-- CreateIndex
CREATE INDEX "commitments_status_idx" ON "commitments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "verification_policies_commitment_id_key" ON "verification_policies"("commitment_id");

-- CreateIndex
CREATE INDEX "evidence_commitment_id_idx" ON "evidence"("commitment_id");

-- CreateIndex
CREATE UNIQUE INDEX "resolutions_commitment_id_key" ON "resolutions"("commitment_id");

-- CreateIndex
CREATE INDEX "events_commitment_id_created_at_idx" ON "events"("commitment_id", "created_at");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_policies" ADD CONSTRAINT "verification_policies_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
