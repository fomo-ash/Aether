import { PrismaClient, Commitment } from '@flowpilot/database';
import { CommitmentCreateDTO } from './commitment.schema';

const prisma = new PrismaClient();

export class CommitmentService {
  /**
   * Creates a new commitment, sets up its verification policy, and returns the record.
   */
  static async createCommitment(data: CommitmentCreateDTO): Promise<Commitment> {
    return await prisma.$transaction(async (tx: any) => {
      // 0. Upsert User and Community for smooth testing
      await tx.user.upsert({
        where: { id: data.userId },
        update: {},
        create: { id: data.userId, email: `${data.userId}@example.com` }
      });

      if (data.communityId) {
        await tx.community.upsert({
          where: { id: data.communityId },
          update: {},
          create: { id: data.communityId, name: 'Test Community', platform: 'api', externalId: data.communityId }
        });
      }

      // 1. Create the commitment and policy in a single nested write
      const commitment = await tx.commitment.create({
        data: {
          userId: data.userId,
          communityId: data.communityId,
          statement: data.statement,
          normalizedClaim: data.statement, // Defaulting to statement for now
          sourceChannel: 'api',
          sourceConversationId: data.conversationId || 'webhook',
          sourceMessageId: 'webhook',
          deadline: new Date(data.deadline),
          status: 'AWAITING_VERIFICATION',
          rewardPenaltyPolicy: {
            reward: data.reward || 0,
            penalty: data.penalty || 0,
          },
          verificationPolicy: {
            create: {
              verifierType: data.verifierType,
              target: data.target,
              successCondition: data.successCondition,
              configuration: data.configuration || {}
            }
          }
        }
      });

      // 2. Log the creation event
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

  /**
   * Fetches a commitment by its ID
   */
  static async getCommitmentById(id: string): Promise<Commitment | null> {
    return await prisma.commitment.findUnique({
      where: { id }
    });
  }
}
