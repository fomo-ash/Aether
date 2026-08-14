import { PrismaClient } from '@flowpilot/database';
import { VerificationRegistry, VerificationContext, NormalizedWebhookEvent, EvidenceData, VerificationCondition } from '@aether/verification-registry';
import { EvidenceEvaluator } from './resolvers/evidence.evaluator';
import { OutboundResponder } from './services/outbound-responder';
import { GithubResolver, InaccessibleRepositoryError } from './services/github-resolver';
import { OutcomeResolver } from './resolvers/outcome.resolver';
import { BetSettlementService } from './services/bet-settlement.service';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function resolveInstallation(verifierType: string, commitment: any): Promise<string | undefined> {
  if (verifierType.startsWith('github.')) {
    try {
      return await GithubResolver.resolveInstallation(
        commitment.userId,
        commitment.verificationPolicy.target,
        commitment.communityId
      );
    } catch (e: any) {
      if (e instanceof InaccessibleRepositoryError) {
        console.warn(`[Verification] ${e.message}`);
        return undefined;
      }
      throw e;
    }
  }
  return undefined;
}

export async function processVerificationJob(job: any) {
  const { commitmentId } = job.data;
  console.log(`[Verification Sweep] Processing deadline verification for commitment: ${commitmentId}`);

  const commitment = await prisma.commitment.findUnique({
    where: { id: commitmentId },
    include: { verificationPolicy: true, user: true, community: true }
  });

  if (!commitment || !commitment.verificationPolicy) {
    throw new Error(`Commitment or policy not found for ${commitmentId}`);
  }

  if (commitment.status !== 'AWAITING_VERIFICATION') {
    console.log(`[Verification Sweep] Commitment ${commitmentId} is already in status ${commitment.status}. No-op.`);
    return { success: true, reason: 'already_resolved' };
  }

  const policy = commitment.verificationPolicy;
  const provider = VerificationRegistry.getProvider(policy.verifierType);
  const githubInstallationId = await resolveInstallation(policy.verifierType, commitment);

  const context: VerificationContext = {
    userId: commitment.userId,
    communityId: commitment.communityId,
    target: policy.target,
    config: { ...((policy.configuration as any) || {}), githubInstallationId }
  };

  console.log(`[Verification Sweep] Calling provider ${provider.name} for ${policy.verifierType}...`);
  const evidencePartial = await provider.verify(policy.verifierType, policy.successCondition as unknown as VerificationCondition, context);

  // Convert partial evidence to array
  const evidences: Partial<EvidenceData>[] = [evidencePartial];

  let resolutionStatus: any;

  if (policy.verifierType === 'web.search') {
    console.log(`[Verification Sweep] AI evaluating web search evidence for "${commitment.statement}"...`);
    const aiOutcome = await EvidenceEvaluator.evaluateWebSearch(commitment.statement, evidences, policy.configuration);
    if (aiOutcome === 'VERIFIED') {
      resolutionStatus = 'FULFILLED';
    } else if (aiOutcome === 'NOT_VERIFIED') {
      resolutionStatus = 'MISSED';
    } else {
      // INSUFFICIENT_EVIDENCE -> check if deadline passed
      resolutionStatus = OutcomeResolver.resolve(
        { operator: 'equals', expected: 'found_results' } as any, // bypass condition Met if needed, or just let OutcomeResolver return MISSED if deadline passed
        evidences, 
        commitment.deadline,
        policy.configuration
      );
      if (resolutionStatus === 'UNRESOLVED' && commitment.deadline && new Date() > commitment.deadline) {
        resolutionStatus = 'MISSED';
      }
    }
  } else {
    resolutionStatus = OutcomeResolver.resolve(
      policy.successCondition as unknown as VerificationCondition, 
      evidences, 
      commitment.deadline,
      policy.configuration
    );
  }
  
  if (resolutionStatus === 'PENDING') {
    // If it's a deadline sweep, and it's PENDING, then we just waited and it didn't fulfill.
    // The OutcomeResolver logic says PENDING if before deadline, MISSED if after deadline.
    // If deadline has passed, OutcomeResolver returns MISSED. If it returned PENDING, maybe deadline isn't set?
    // We treat PENDING at sweep time as UNRESOLVED or MISSED based on strictness. The resolver handles this.
  }

  if (resolutionStatus === 'FULFILLED' || resolutionStatus === 'MISSED') {
    await applyResolution(commitment, resolutionStatus, evidences[0], provider.name);
  }

  return { success: true, result: resolutionStatus };
}

export async function processWebhookJob(job: any) {
  const event: NormalizedWebhookEvent = job.data;
  console.log(`[Webhook] Processing event ${event.eventId} for target ${event.target}`);

  // Find AWAITING_VERIFICATION commitments that care about this target
  const commitments = await prisma.commitment.findMany({
    where: {
      status: 'AWAITING_VERIFICATION',
      verificationPolicy: {
        target: {
          equals: event.target,
          mode: 'insensitive'
        }
        // Optional: filter by verifierType = event.provider.*
      }
    },
    include: { verificationPolicy: true, user: true, community: true }
  });

  for (const commitment of commitments) {
    if (!commitment.verificationPolicy) continue;

    const policy = commitment.verificationPolicy;
    const provider = VerificationRegistry.getProvider(policy.verifierType);
    const githubInstallationId = await resolveInstallation(policy.verifierType, commitment);

    const context: VerificationContext = {
      userId: commitment.userId,
      communityId: commitment.communityId,
      target: policy.target,
      config: { ...((policy.configuration as any) || {}), githubInstallationId }
    };

    console.log(`[Webhook] Generating evidence for commitment ${commitment.id} via ${provider.name}...`);
    // Pass the webhook event inside context.config for the provider to parse, or just have provider fetch current state.
    // Standard provider.verify fetches current state. We could just call verify!
    const evidencePartial = await provider.verify(policy.verifierType, policy.successCondition as unknown as VerificationCondition, context);
    
    // Instead of trusting just the webhook payload, we use it to trigger a full verify, ensuring accuracy and security.
    // The OutcomeResolver will check temporal correctness.
    const resolutionStatus = OutcomeResolver.resolve(policy.successCondition as unknown as VerificationCondition, [evidencePartial], commitment.deadline);

    if (resolutionStatus === 'FULFILLED') {
      console.log(`[Webhook] Commitment ${commitment.id} resolved EARLY as FULFILLED!`);
      await applyResolution(commitment, resolutionStatus, evidencePartial, provider.name);
    } else if (resolutionStatus === 'MISSED') {
      // Early missed, e.g. terminal failure
      console.log(`[Webhook] Commitment ${commitment.id} resolved EARLY as MISSED!`);
      await applyResolution(commitment, resolutionStatus, evidencePartial, provider.name);
    } else {
      console.log(`[Webhook] Commitment ${commitment.id} remains ${resolutionStatus}.`);
    }
  }

  return { success: true };
}

async function applyResolution(commitment: any, status: string, evidencePartial: Partial<EvidenceData>, providerName: string) {
  const finalStatus = status === 'FULFILLED' ? 'VERIFIED_FULFILLED' : (status === 'EXPIRED' ? 'EXPIRED' : 'VERIFIED_MISSED');

  try {
    const bet = await prisma.bet.findUnique({ where: { commitmentId: commitment.id } });
    
    // If it's part of a bet, delegate to BetSettlementService instead of Legacy flow
    if (bet) {
      await prisma.$transaction(async (tx: any) => {
        const updateResult = await tx.commitment.updateMany({
          where: { id: commitment.id, status: 'AWAITING_VERIFICATION' },
          data: { status: finalStatus }
        });
        if (updateResult.count === 0) throw new Error('CONCURRENCY_LOCKED');

        const evidence = await tx.evidence.create({
          data: {
            commitmentId: commitment.id,
            betId: bet.id,
            source: providerName,
            observedState: evidencePartial.observedState || 'UNKNOWN',
            payload: evidencePartial.payload || {},
            metadata: evidencePartial.metadata || {}
          }
        });

        const resolution = await tx.resolution.create({
          data: {
            commitmentId: commitment.id,
            betId: bet.id,
            status: status as any,
            result: status,
            explanation: `Verified via ${providerName}. State: ${evidencePartial.observedState}`,
            evidenceRefs: [evidence.id]
          }
        });
        
        await tx.event.create({
          data: {
            commitmentId: commitment.id,
            betId: bet.id,
            eventType: `COMMITMENT_${status}`,
            payload: { evidenceId: evidence.id, resolutionId: resolution.id }
          }
        });
      });

      // Call BetSettlementService to execute atomic Escrow transfers
      await BetSettlementService.settle(bet.id, status as 'FULFILLED' | 'MISSED' | 'EXPIRED');
    } else {
      await prisma.$transaction(async (tx: any) => {
        const updateResult = await tx.commitment.updateMany({
          where: { id: commitment.id, status: 'AWAITING_VERIFICATION' },
          data: { status: finalStatus }
        });

      if (updateResult.count === 0) throw new Error('CONCURRENCY_LOCKED');

      const evidence = await tx.evidence.create({
        data: {
          commitmentId: commitment.id,
          source: providerName,
          observedState: evidencePartial.observedState || 'UNKNOWN',
          payload: evidencePartial.payload || {},
          metadata: evidencePartial.metadata || {}
        }
      });

      const resolution = await tx.resolution.create({
        data: {
          commitmentId: commitment.id,
          status: status,
          result: status,
          explanation: `Verified via ${providerName}. State: ${evidencePartial.observedState}`,
          evidenceRefs: [evidence.id]
        }
      });

      await tx.event.create({
        data: {
          commitmentId: commitment.id,
          eventType: `COMMITMENT_${status}`,
          payload: { evidenceId: evidence.id, resolutionId: resolution.id }
        }
      });

      if (commitment.communityId) {
        const policy = commitment.rewardPenaltyPolicy as any;
        let amount = 0;
        let type: any = 'COMMITMENT_MISSED';

        if (status === 'FULFILLED' && policy?.reward) {
          amount = policy.reward;
          type = 'COMMITMENT_FULFILLED';
        } else if (status === 'MISSED' && policy?.penalty) {
          amount = -Math.abs(policy.penalty);
          type = 'COMMITMENT_MISSED';
        }

        if (amount !== 0) {
          const referenceKey = `commitment:${commitment.id}:${status.toLowerCase()}`;
          const accountId = crypto.randomUUID();
          
          await tx.$executeRaw`
            INSERT INTO reputation_accounts (id, community_id, user_id, balance, created_at, updated_at)
            VALUES (${accountId}, ${commitment.communityId}, ${commitment.userId}, 0, NOW(), NOW())
            ON CONFLICT (user_id, community_id) DO NOTHING;
          `;

          const account = await tx.reputationAccount.findUniqueOrThrow({
            where: { userId_communityId: { userId: commitment.userId, communityId: commitment.communityId } }
          });

          await tx.reputationTransaction.create({
            data: {
              reputationAccountId: account.id,
              amount,
              transactionType: type,
              reason: `Commitment ${status}`,
              commitmentId: commitment.id,
              referenceKey
            }
          });

          await tx.reputationAccount.update({
            where: { id: account.id },
            data: { balance: { increment: amount } }
          });
        }
      }
    });
    }
  } catch (err: any) {
    if (err.message === 'CONCURRENCY_LOCKED') return;
    if (err.code === 'P2002' && err.meta?.target?.includes('reference_key')) return;
    throw err;
  }

  // Outbound Notification
  try {
    let amount = 0;
    const bet = await prisma.bet.findUnique({ where: { commitmentId: commitment.id } });
    
    if (bet) {
      if (finalStatus === 'VERIFIED_FULFILLED') {
        amount = bet.isBootstrap ? 20 : bet.potentialPayout; // 20 is BOOTSTRAP_REWARD
      } else {
        amount = bet.stake;
      }
    } else {
      const rewardPolicy = commitment.rewardPenaltyPolicy as any;
      amount = rewardPolicy?.reward || rewardPolicy?.penalty || 0;
    }

    let replyText = '';
    if (finalStatus === 'VERIFIED_FULFILLED') {
      replyText = `🎉 **Commitment fulfilled!**\n\n🎯 **${commitment.verificationPolicy.target}**\n✅ Completed before the deadline\n\n**Reputation**: +${amount}`;
    } else {
      replyText = `❌ **Commitment missed**\n\n🎯 **${commitment.verificationPolicy.target}**\n⏰ **Deadline**: ${commitment.deadline?.toUTCString() || 'Unknown'}\n\n📌 **State**: ${evidencePartial.observedState}\n**Reputation**: -${amount}`;
    }
    
    await OutboundResponder.sendMessage(commitment.communityId || '', commitment.userId, commitment.sourceConversationId, replyText);
  } catch (notifErr) {
    console.error(`[Verification] Failed to send outbound notification:`, notifErr);
  }
}
