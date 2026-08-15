import { PrismaClient, TransactionType } from '@flowpilot/database';
import { CommitmentCreateDTO } from '@aether/commitments';
import { RewardPoolService } from './reward-pool.service';
import crypto from 'crypto';

const prisma = new PrismaClient();

export const BET_CONFIG = {
  VALID_MULTIPLIERS: [2, 3, 5],
  MAX_BET_STAKE: 1000,
  MAX_POTENTIAL_PAYOUT: 5000,
  MAX_BOOTSTRAP_BETS: 3,
  BOOTSTRAP_REWARD: 20
};

export interface BetCreateDTO {
  userId: string;
  communityId: string;
  statement: string;
  stake: number;
  multiplier: number;
  deadline: string;
  verifierType: string;
  target: string;
  successCondition: any;
  configuration?: any;
  conversationId?: string;
}

export class BetService {
  /**
   * Creates a new Bet atomically with its Commitment, Escrow locking, and VerificationPolicy.
   */
  static async createBet(data: BetCreateDTO) {
    if (data.stake < 0) {
      throw new Error('Stake cannot be negative.');
    }
    
    const isBootstrap = data.stake === 0;

    if (!isBootstrap) {
      if (data.stake > BET_CONFIG.MAX_BET_STAKE) {
        throw new Error(`Stake exceeds maximum allowed (${BET_CONFIG.MAX_BET_STAKE}).`);
      }
      if (!BET_CONFIG.VALID_MULTIPLIERS.includes(data.multiplier)) {
        throw new Error(`Invalid multiplier. Allowed values: ${BET_CONFIG.VALID_MULTIPLIERS.join(', ')}`);
      }
    }

    const multiplier = isBootstrap ? null : data.multiplier;
    const potentialPayout = isBootstrap ? 0 : data.stake * data.multiplier;

    if (!isBootstrap && potentialPayout > BET_CONFIG.MAX_POTENTIAL_PAYOUT) {
      throw new Error(`Potential payout exceeds maximum allowed (${BET_CONFIG.MAX_POTENTIAL_PAYOUT}).`);
    }

    // Check RewardPool solvency
    const netPayoutRequired = isBootstrap ? BET_CONFIG.BOOTSTRAP_REWARD : potentialPayout - data.stake;
    const isSolvent = await RewardPoolService.checkSolvency(netPayoutRequired);
    if (!isSolvent) {
      throw new Error('System reward pool has insufficient funds to underwrite this bet.');
    }

    return await prisma.$transaction(async (tx: any) => {
      // Setup/upsert User and Community
      await tx.user.upsert({
        where: { id: data.userId },
        update: {},
        create: { id: data.userId, email: `${data.userId}@example.com` }
      });
      await tx.community.upsert({
        where: { id: data.communityId },
        update: {},
        create: { id: data.communityId, name: 'Community', platform: 'api', externalId: data.communityId }
      });

      let account = await tx.reputationAccount.findUnique({
        where: { userId_communityId: { userId: data.userId, communityId: data.communityId } }
      });

      if (!account) {
        account = await tx.reputationAccount.create({
          data: { userId: data.userId, communityId: data.communityId, balance: 100, lockedBalance: 0 }
        });

        // Add a ledger entry for the airdrop
        await tx.reputationTransaction.create({
          data: {
            reputationAccountId: account.id,
            amount: 100,
            transactionType: TransactionType.MANUAL_ADJUSTMENT,
            reason: 'Initial joining airdrop (Test Phase)',
            referenceKey: `airdrop_${data.userId}_${data.communityId}`
          }
        });
      }

      if (isBootstrap) {
        // Bootstrap concurrency check
        const res = await tx.$executeRaw`
          UPDATE users 
          SET bootstrap_bets_used = bootstrap_bets_used + 1 
          WHERE id = ${data.userId} AND bootstrap_bets_used < ${BET_CONFIG.MAX_BOOTSTRAP_BETS}
        `;
        if (res === 0) {
          throw new Error('Bootstrap bet limit reached or user not found.');
        }
      } else {
        if (account.balance < data.stake) {
          throw new Error(`Insufficient REP. Required: ${data.stake}, Available: ${account.balance}. If you have reached 0 credits, you can appeal for more by mailing at mysrealm@gmail.com.`);
        }

        // Lock stake
        account = await tx.reputationAccount.update({
          where: { id: account.id },
          data: { 
            balance: { decrement: data.stake },
            lockedBalance: { increment: data.stake }
          }
        });

        // Add ledger entry for lock
        await tx.reputationTransaction.create({
          data: {
            reputationAccountId: account.id,
            amount: -data.stake,
            transactionType: TransactionType.BET_STAKE_LOCK,
            reason: 'Bet stake locked',
            referenceKey: `lock_${crypto.randomUUID()}`
          }
        });
      }

      // Create Commitment and Bet
      const commitment = await tx.commitment.create({
        data: {
          userId: data.userId,
          communityId: data.communityId,
          statement: data.statement,
          normalizedClaim: data.statement,
          sourceChannel: 'api',
          sourceConversationId: data.conversationId || 'bet_command',
          sourceMessageId: 'bet_command',
          deadline: new Date(data.deadline),
          status: 'AWAITING_VERIFICATION',
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

      const bet = await tx.bet.create({
        data: {
          creatorId: data.userId,
          communityId: data.communityId,
          stake: data.stake,
          multiplier,
          potentialPayout,
          isBootstrap,
          commitmentId: commitment.id,
          deadline: new Date(data.deadline),
          status: 'ACTIVE'
        }
      });

      await tx.event.create({
        data: {
          betId: bet.id,
          eventType: 'BET_CREATED',
          payload: { stake: data.stake, multiplier, potentialPayout }
        }
      });

      // Tie transaction references if not bootstrap
      if (!isBootstrap) {
        await tx.reputationTransaction.updateMany({
          where: { reputationAccountId: account.id, transactionType: TransactionType.BET_STAKE_LOCK, betId: null },
          data: { betId: bet.id }
        });
      }

      return bet;
    });
  }

  /**
   * Cancels a Bet atomically. Must be ACTIVE and before deadline.
   */
  static async cancelBet(betId: string, userId: string) {
    return await prisma.$transaction(async (tx: any) => {
      const now = new Date();
      // Ensure the user owns it, it's ACTIVE, and before deadline
      const res = await tx.$executeRaw`
        UPDATE bets
        SET status = 'CANCELLED', updated_at = NOW()
        WHERE id = ${betId} AND creator_id = ${userId} AND status = 'ACTIVE' AND deadline > ${now}
      `;

      if (res === 0) {
        throw new Error('Bet cannot be cancelled. It must be ACTIVE and before its deadline.');
      }

      const bet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });
      const account = await tx.reputationAccount.findUniqueOrThrow({
        where: { userId_communityId: { userId: bet.creatorId, communityId: bet.communityId } }
      });

      if (!bet.isBootstrap && bet.stake > 0) {
        // Refund
        await tx.reputationAccount.update({
          where: { id: account.id },
          data: {
            balance: { increment: bet.stake },
            lockedBalance: { decrement: bet.stake }
          }
        });

        await tx.reputationTransaction.create({
          data: {
            reputationAccountId: account.id,
            amount: bet.stake,
            transactionType: TransactionType.BET_REFUND,
            reason: 'Bet cancelled and refunded',
            betId: bet.id,
            referenceKey: `cancel_refund_${bet.id}`
          }
        });
      }
      
      // Update Commitment status
      await tx.commitment.update({
        where: { id: bet.commitmentId },
        data: { status: 'CANCELLED' }
      });

      return bet;
    });
  }
}
