import { PrismaClient } from '@flowpilot/database';
import { getVerifier, VerificationPolicyContext } from '@aether/verification-registry';

const prisma = new PrismaClient();

export async function processVerificationJob(job: any) {
  const { commitmentId } = job.data;
  console.log(`Processing verification for commitment: ${commitmentId}`);

  const commitment = await prisma.commitment.findUnique({
    where: { id: commitmentId },
    include: { verificationPolicy: true, user: true, community: true }
  });

  if (!commitment || !commitment.verificationPolicy) {
    throw new Error(`Commitment or policy not found for ${commitmentId}`);
  }

  // Already verified or cancelled?
  if (commitment.status !== 'AWAITING_VERIFICATION' && commitment.status !== 'PENDING') {
    console.log(`Commitment ${commitmentId} is already in status ${commitment.status}`);
    return;
  }

  const policy = commitment.verificationPolicy;
  const verifier = getVerifier(policy.verifierType);

  const context: VerificationPolicyContext = {
    commitmentId: commitment.id,
    target: policy.target,
    successCondition: policy.successCondition,
    configuration: policy.configuration
  };

  const result = await verifier.verify(context);

  // Write Evidence
  const evidence = await prisma.evidence.create({
    data: {
      commitmentId: commitment.id,
      source: verifier.id,
      observedState: result.observedState,
      payload: result.payload
    }
  });

  // Write Resolution
  const resolution = await prisma.resolution.create({
    data: {
      commitmentId: commitment.id,
      status: result.status,
      result: result.status,
      explanation: `Verified via ${verifier.id}. State: ${result.observedState}`,
      evidenceRefs: [evidence.id]
    }
  });

  // Update Commitment
  let finalStatus: any = 'UNRESOLVED';
  if (result.status === 'FULFILLED') finalStatus = 'VERIFIED_FULFILLED';
  if (result.status === 'MISSED') finalStatus = 'VERIFIED_MISSED';
  
  await prisma.commitment.update({
    where: { id: commitment.id },
    data: { status: finalStatus }
  });

  // Log Event
  await prisma.event.create({
    data: {
      commitmentId: commitment.id,
      eventType: `COMMITMENT_${result.status}`,
      payload: { evidenceId: evidence.id, resolutionId: resolution.id }
    }
  });

  // Handle Reputation if FULFILLED or MISSED
  if ((result.status === 'FULFILLED' || result.status === 'MISSED') && commitment.communityId) {
    const policy = commitment.rewardPenaltyPolicy as any;
    let amount = 0;
    let type: any = 'COMMITMENT_MISSED';

    if (result.status === 'FULFILLED' && policy?.reward) {
      amount = policy.reward;
      type = 'COMMITMENT_FULFILLED';
    } else if (result.status === 'MISSED' && policy?.penalty) {
      amount = -Math.abs(policy.penalty); // ensure penalty is negative
      type = 'COMMITMENT_MISSED';
    }

    if (amount !== 0) {
      const referenceKey = `commitment:${commitment.id}:${result.status.toLowerCase()}`;
      
      // Ensure the reputation account exists
      let account = await prisma.reputationAccount.findUnique({
        where: {
          userId_communityId: {
            userId: commitment.userId,
            communityId: commitment.communityId
          }
        }
      });

      if (!account) {
        account = await prisma.reputationAccount.create({
          data: {
            userId: commitment.userId,
            communityId: commitment.communityId,
            balance: 0
          }
        });
      }

      try {
        await prisma.$transaction(async (tx: any) => {
          await tx.reputationTransaction.create({
            data: {
              reputationAccountId: account!.id,
              amount,
              transactionType: type,
              reason: `Commitment ${result.status}`,
              commitmentId: commitment.id,
              referenceKey
            }
          });

          await tx.reputationAccount.update({
            where: { id: account!.id },
            data: { balance: { increment: amount } }
          });
        });
        console.log(`Reputation transaction applied: ${amount}`);
      } catch (e: any) {
        if (e.code === 'P2002') {
          console.log(`Idempotency constraint hit: ${referenceKey} already processed.`);
        } else {
          throw e;
        }
      }
    }
  }

  return { success: true, result: result.status };
}
