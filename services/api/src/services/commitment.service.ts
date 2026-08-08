import { PrismaClient } from '@flowpilot/database';
import { CommitmentCreateDTO } from '../schemas/commitment.schema';

const prisma = new PrismaClient();

export class CommitmentService {
  /**
   * Creates a new commitment, sets up its verification policy, and returns the record.
   */
  static async createCommitment(data: CommitmentCreateDTO) {
    // We use a transaction to ensure both the commitment and its policy are created together
    return await prisma.$transaction(async (tx) => {
      // 1. Create the verification policy
      const policy = await tx.verificationPolicy.create({
        data: {
          verifierType: data.verifierType,
          target: data.target,
          successCondition: data.successCondition,
        }
      });

      // 2. Create the commitment and link the policy
      const commitment = await tx.commitment.create({
        data: {
          userId: data.userId,
          communityId: data.communityId,
          statement: data.statement,
          deadline: new Date(data.deadline),
          status: 'AWAITING_VERIFICATION',
          verificationPolicyId: policy.id,
          rewardPenaltyPolicy: {
            reward: data.reward || 0,
            penalty: data.penalty || 0,
          }
        }
      });

      // 3. Log the creation event
      await tx.event.create({
        data: {
          commitmentId: commitment.id,
          eventType: 'COMMITMENT_CREATED',
          payload: { statement: data.statement, deadline: data.deadline }
        }
      });

      return commitment;
    });
  }
}
