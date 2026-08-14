import { PrismaClient, TransactionType, RewardPoolTransactionType } from '@flowpilot/database';
import { BET_CONFIG } from './bet.service';
import crypto from 'crypto';

const prisma = new PrismaClient();

export class BetSettlementService {
  /**
   * Settles a Bet atomically. 
   * It relies on atomic UPDATE ... WHERE status = 'AWAITING_VERIFICATION' to prevent race conditions.
   */
  static async settle(betId: string, resolutionStatus: 'FULFILLED' | 'MISSED' | 'EXPIRED') {
    return await prisma.$transaction(async (tx: any) => {
      // 1. Atomic lock: Claim the bet
      const updateResult = await tx.$executeRaw`
        UPDATE bets
        SET status = CAST(${resolutionStatus} AS "BetStatus"), updated_at = NOW()
        WHERE id = ${betId} AND status IN ('ACTIVE', 'AWAITING_VERIFICATION')
      `;

      if (updateResult === 0) {
        throw new Error('CONCURRENCY_LOCKED');
      }

      const bet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });
      const account = await tx.reputationAccount.findUniqueOrThrow({
        where: { userId_communityId: { userId: bet.creatorId, communityId: bet.communityId } }
      });
      const rewardPool = await tx.rewardPool.findUniqueOrThrow({
        where: { isGlobal: true }
      });

      // 2. Perform Accounting
      if (bet.isBootstrap) {
        if (resolutionStatus === 'FULFILLED') {
          const updatedPool = await tx.rewardPool.update({
            where: { id: rewardPool.id },
            data: { balance: { decrement: BET_CONFIG.BOOTSTRAP_REWARD } }
          });

          if (updatedPool.balance < 0) {
            throw new Error('RewardPool insolvent at settlement');
          }

          await tx.reputationAccount.update({
            where: { id: account.id },
            data: { balance: { increment: BET_CONFIG.BOOTSTRAP_REWARD } }
          });

          await tx.reputationTransaction.create({
            data: {
              reputationAccountId: account.id,
              amount: BET_CONFIG.BOOTSTRAP_REWARD,
              transactionType: TransactionType.BET_BOOTSTRAP_REWARD,
              reason: 'Bootstrap bet fulfilled: fixed payout granted',
              betId: bet.id,
              referenceKey: `bs_reward_${bet.id}`
            }
          });

          await tx.rewardPoolTransaction.create({
            data: {
              rewardPoolId: rewardPool.id,
              type: RewardPoolTransactionType.BET_BOOTSTRAP_REWARD,
              amount: -BET_CONFIG.BOOTSTRAP_REWARD,
              betId: bet.id,
              referenceKey: `pool_bs_reward_${bet.id}`
            }
          });
        }
        // MISSED, EXPIRED, CANCELLED do nothing for bootstrap bets since stake=0
      } else if (bet.stake > 0) {
        if (resolutionStatus === 'FULFILLED') {
          const reward = bet.potentialPayout - bet.stake;
          
          await tx.reputationAccount.update({
            where: { id: account.id },
            data: {
              lockedBalance: { decrement: bet.stake },
              balance: { increment: bet.potentialPayout }
            }
          });

          const updatedPool = await tx.rewardPool.update({
            where: { id: rewardPool.id },
            data: { balance: { decrement: reward } }
          });

          if (updatedPool.balance < 0) {
            throw new Error('RewardPool insolvent at settlement');
          }

          // Ledger entries for user
          await tx.reputationTransaction.createMany({
            data: [
              {
                reputationAccountId: account.id,
                amount: bet.stake,
                transactionType: TransactionType.BET_STAKE_RELEASE,
                reason: 'Bet fulfilled: stake released',
                betId: bet.id,
                referenceKey: `release_${bet.id}`
              },
              {
                reputationAccountId: account.id,
                amount: reward,
                transactionType: TransactionType.BET_REWARD,
                reason: 'Bet fulfilled: payout granted',
                betId: bet.id,
                referenceKey: `reward_${bet.id}`
              }
            ]
          });

          // Ledger entry for pool
          await tx.rewardPoolTransaction.create({
            data: {
              rewardPoolId: rewardPool.id,
              type: RewardPoolTransactionType.BET_REWARD,
              amount: -reward,
              betId: bet.id,
              referenceKey: `pool_reward_${bet.id}`
            }
          });
        } 
        else if (resolutionStatus === 'MISSED') {
          await tx.reputationAccount.update({
            where: { id: account.id },
            data: {
              lockedBalance: { decrement: bet.stake }
            }
          });

          await tx.rewardPool.update({
            where: { id: rewardPool.id },
            data: { balance: { increment: bet.stake } }
          });

          await tx.reputationTransaction.create({
            data: {
              reputationAccountId: account.id,
              amount: 0, 
              transactionType: TransactionType.BET_STAKE_FORFEIT,
              reason: 'Bet missed: stake forfeited to pool',
              betId: bet.id,
              referenceKey: `forfeit_${bet.id}`
            }
          });

          await tx.rewardPoolTransaction.create({
            data: {
              rewardPoolId: rewardPool.id,
              type: RewardPoolTransactionType.BET_FORFEIT,
              amount: bet.stake,
              betId: bet.id,
              referenceKey: `pool_forfeit_${bet.id}`
            }
          });
        }
        else if (resolutionStatus === 'EXPIRED') {
          await tx.reputationAccount.update({
            where: { id: account.id },
            data: {
              lockedBalance: { decrement: bet.stake },
              balance: { increment: bet.stake }
            }
          });

          await tx.reputationTransaction.create({
            data: {
              reputationAccountId: account.id,
              amount: bet.stake,
              transactionType: TransactionType.BET_REFUND,
              reason: 'Bet expired/unresolved: stake refunded',
              betId: bet.id,
              referenceKey: `refund_${bet.id}`
            }
          });
        }
      }
      
      // Update the settlement reference to enforce idempotency at DB level
      await tx.$executeRaw`
        UPDATE bets
        SET settlement_reference = ${`bet_settle_${betId}`}
        WHERE id = ${betId}
      `;

      return bet;
    });
  }
}
