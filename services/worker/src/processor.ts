import { PrismaClient } from '@flowpilot/database';
import { getVerifier, VerificationPolicyContext } from '@aether/verification-registry';
import { OutboundResponder } from './services/outbound-responder';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

export async function processVerificationJob(job: any) {
  const { commitmentId } = job.data;
  console.log(`[Verification] Processing verification for commitment: ${commitmentId}`);

  const commitment = await prisma.commitment.findUnique({
    where: { id: commitmentId },
    include: { verificationPolicy: true, user: true, community: true }
  });

  if (!commitment || !commitment.verificationPolicy) {
    throw new Error(`Commitment or policy not found for ${commitmentId}`);
  }

  // Idempotency: Quick in-memory check to save external API call if clearly already done.
  if (commitment.status !== 'AWAITING_VERIFICATION') {
    console.log(`[Verification] Commitment ${commitmentId} is already in status ${commitment.status}. No-op.`);
    return { success: true, reason: 'already_resolved' };
  }

  const policy = commitment.verificationPolicy;
  const verifier = getVerifier(policy.verifierType);

  const context: VerificationPolicyContext = {
    commitmentId: commitment.id,
    target: policy.target,
    successCondition: policy.successCondition as any,
    configuration: policy.configuration as any,
    githubInstallationId: commitment.community?.githubInstallationId || undefined,
    createdAt: commitment.createdAt,
    deadline: commitment.deadline || undefined
  };

  // 1. External API Call OUTSIDE the transaction
  console.log(`[Verification] Calling verifier ${verifier.id}...`);
  const result = await verifier.verify(context);
  console.log(`[Verification] Result: ${result.status}`);

  let finalStatus: any = 'UNRESOLVED';
  if (result.status === 'FULFILLED') finalStatus = 'VERIFIED_FULFILLED';
  if (result.status === 'MISSED') finalStatus = 'VERIFIED_MISSED';

  // 2. The Atomic Prisma Transaction
  try {
    await prisma.$transaction(async (tx: any) => {
      // Step A: Optimistic concurrency lock
      const updateResult = await tx.commitment.updateMany({
        where: { 
          id: commitment.id, 
          status: 'AWAITING_VERIFICATION' // Only transition if it's STILL awaiting
        },
        data: { status: finalStatus }
      });

      if (updateResult.count === 0) {
        throw new Error('CONCURRENCY_LOCKED');
      }

      // Step B: Write Evidence
      const evidence = await tx.evidence.create({
        data: {
          commitmentId: commitment.id,
          source: verifier.id,
          observedState: result.observedState,
          payload: result.payload
        }
      });

      // Step C: Write Resolution
      const resolution = await tx.resolution.create({
        data: {
          commitmentId: commitment.id,
          status: result.status,
          result: result.status,
          explanation: `Verified via ${verifier.id}. State: ${result.observedState}`,
          evidenceRefs: [evidence.id]
        }
      });

      // Step D: Write Event
      await tx.event.create({
        data: {
          commitmentId: commitment.id,
          eventType: `COMMITMENT_${result.status}`,
          payload: { evidenceId: evidence.id, resolutionId: resolution.id }
        }
      });

      // Step E: Reputation
      if ((result.status === 'FULFILLED' || result.status === 'MISSED') && commitment.communityId) {
        const policy = commitment.rewardPenaltyPolicy as any;
        let amount = 0;
        let type: any = 'COMMITMENT_MISSED';

        if (result.status === 'FULFILLED' && policy?.reward) {
          amount = policy.reward;
          type = 'COMMITMENT_FULFILLED';
        } else if (result.status === 'MISSED' && policy?.penalty) {
          amount = -Math.abs(policy.penalty);
          type = 'COMMITMENT_MISSED';
        }

        if (amount !== 0) {
          const referenceKey = `commitment:${commitment.id}:${result.status.toLowerCase()}`;
          
          const accountId = crypto.randomUUID();
          
          await tx.$executeRaw`
            INSERT INTO reputation_accounts (id, community_id, user_id, balance, created_at, updated_at)
            VALUES (${accountId}, ${commitment.communityId}, ${commitment.userId}, 0, NOW(), NOW())
            ON CONFLICT (user_id, community_id) DO NOTHING;
          `;

          const account = await tx.reputationAccount.findUniqueOrThrow({
            where: {
              userId_communityId: {
                userId: commitment.userId,
                communityId: commitment.communityId
              }
            }
          });

          // Write Reputation Transaction
          await tx.reputationTransaction.create({
            data: {
              reputationAccountId: account.id,
              amount,
              transactionType: type,
              reason: `Commitment ${result.status}`,
              commitmentId: commitment.id,
              referenceKey
            }
          });

          // Update Balance
          await tx.reputationAccount.update({
            where: { id: account.id },
            data: { balance: { increment: amount } }
          });
          
          console.log(`[Verification] Reputation transaction applied: ${amount}`);
        }
      }
    });
  } catch (err: any) {
    if (err.message === 'CONCURRENCY_LOCKED') {
      console.log(`[Verification] Commitment ${commitmentId} was already resolved by another worker concurrently. Safe no-op.`);
      return { success: true, reason: 'already_resolved_concurrently' };
    }
    // Only swallow P2002 if it's the exact idempotency constraint we expect
    if (err.code === 'P2002') {
      // The unique constraint on ReputationTransaction is reference_key.
      // err.meta?.target is usually an array of field names that violated the constraint.
      const target = err.meta?.target;
      if (Array.isArray(target) && target.includes('reference_key')) {
        console.log(`[Verification] Idempotency P2002 hit for reference_key on ${commitmentId}. Safe no-op.`);
        return { success: true, reason: 'p2002_idempotency_hit' };
      }
    }
    throw err;
  }

  // 3. Outbound Notification (OUTSIDE transaction)
  if (finalStatus === 'VERIFIED_FULFILLED' || finalStatus === 'VERIFIED_MISSED') {
    try {
      const rewardPolicy = commitment.rewardPenaltyPolicy as any;
      const amount = rewardPolicy?.reward || rewardPolicy?.penalty || 0;
      let replyText = '';
      if (finalStatus === 'VERIFIED_FULFILLED') {
        replyText = `🎉 **Commitment fulfilled!**\n\n` +
          `🎯 **${policy.target}**\n` +
          `✅ Completed before the deadline\n\n` +
          `**Reputation**: +${amount}`;
      } else {
        replyText = `❌ **Commitment missed**\n\n` +
          `🎯 **${policy.target}**\n` +
          `⏰ **Deadline**: ${commitment.deadline?.toUTCString() || 'Unknown'}\n\n` +
          `📌 **State at deadline**: ${result.observedState}\n` +
          `**Reputation**: -${amount}`;
      }
      
      await OutboundResponder.sendMessage(
        commitment.communityId || '',
        commitment.userId,
        commitment.sourceConversationId,
        replyText
      );
      console.log(`[Verification] Outbound notification sent for ${commitmentId}`);
    } catch (notifErr) {
      console.error(`[Verification] Failed to send outbound notification:`, notifErr);
      // Do NOT throw here, because DB transaction was successful
    }
  }

  return { success: true, result: result.status };
}
