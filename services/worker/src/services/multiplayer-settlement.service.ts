import { PrismaClient, TransactionType, RewardPoolTransactionType, MultiplayerBetType, MultiplayerBetStatus } from '@flowpilot/database';

const prisma = new PrismaClient();

export class MultiplayerSettlementService {
  /**
   * Settles a MultiplayerBet (Head-to-Head or Prediction Pool) atomically and idempotently.
   */
  static async settle(multiplayerBetId: string, resolutionStatus: 'FULFILLED' | 'MISSED' | 'UNRESOLVED' | 'PROVIDER_FAILURE' | 'AMBIGUOUS' | 'EXPIRED') {
    return await prisma.$transaction(async (tx: any) => {
      // 1. Fetch bet first to verify existence and check if already terminal
      const bet = await tx.multiplayerBet.findUnique({
        where: { id: multiplayerBetId },
        include: { participants: true }
      });

      if (!bet) {
        throw new Error(`BET_NOT_FOUND: Multiplayer bet ${multiplayerBetId} does not exist.`);
      }

      if (bet.status === MultiplayerBetStatus.RESOLVED || bet.status === MultiplayerBetStatus.CANCELLED || bet.status === MultiplayerBetStatus.EXPIRED) {
        console.log(`[MultiplayerSettlement] Bet ${multiplayerBetId} already terminal (${bet.status}). Skipping.`);
        return { alreadySettled: true, status: bet.status };
      }

      // 2. Concurrency claim: Atomically mark as RESOLVING
      const updateResult = await tx.$executeRaw`
        UPDATE multiplayer_bets
        SET status = 'RESOLVING'::"MultiplayerBetStatus", updated_at = NOW()
        WHERE id = ${multiplayerBetId} AND status IN ('OFFERED'::"MultiplayerBetStatus", 'OPEN'::"MultiplayerBetStatus", 'ACTIVE'::"MultiplayerBetStatus", 'LOCKED'::"MultiplayerBetStatus")
      `;

      if (updateResult === 0) {
        throw new Error('CONCURRENCY_LOCKED: Settlement already in progress or completed.');
      }

      const rewardPool = await tx.rewardPool.findUniqueOrThrow({
        where: { isGlobal: true }
      });

      // ----------------------------------------------------------------------
      // CASE 1: HEAD_TO_HEAD
      // ----------------------------------------------------------------------
      if (bet.betType === MultiplayerBetType.HEAD_TO_HEAD) {
        // If it was never accepted by an opponent
        if (bet.participants.length < 2) {
          // Refund creator
          const creatorParticipant = bet.participants.find((p: any) => p.userId === bet.creatorId);
          if (creatorParticipant) {
            const creatorAcct = await tx.reputationAccount.findUniqueOrThrow({
              where: { userId_communityId: { userId: bet.creatorId, communityId: bet.communityId } }
            });

            await tx.reputationAccount.update({
              where: { id: creatorAcct.id },
              data: {
                balance: { increment: creatorParticipant.stake },
                lockedBalance: { decrement: creatorParticipant.stake }
              }
            });

            await tx.reputationTransaction.create({
              data: {
                reputationAccountId: creatorAcct.id,
                amount: creatorParticipant.stake,
                transactionType: TransactionType.BET_REFUND,
                reason: 'Challenge expired without acceptance: stake refunded',
                referenceKey: `mp_expire_refund_${bet.id}_${bet.creatorId}`
              }
            });
          }

          await tx.multiplayerBet.update({
            where: { id: bet.id },
            data: { status: MultiplayerBetStatus.EXPIRED, resolvedAt: new Date() }
          });

          return { settled: true, status: MultiplayerBetStatus.EXPIRED };
        }

        const creator = bet.participants.find((p: any) => p.side === 'CREATOR');
        const opponent = bet.participants.find((p: any) => p.side === 'OPPONENT');

        if (!creator || !opponent) {
          throw new Error('CORRUPTED_PARTICIPANTS: Head-to-head challenge lacks creator or opponent participant.');
        }

        // If Unresolved / Ambiguous / Error -> Refund both 1:1
        if (['UNRESOLVED', 'PROVIDER_FAILURE', 'AMBIGUOUS', 'EXPIRED'].includes(resolutionStatus)) {
          for (const p of [creator, opponent]) {
            const acct = await tx.reputationAccount.findUniqueOrThrow({
              where: { userId_communityId: { userId: p.userId, communityId: bet.communityId } }
            });

            await tx.reputationAccount.update({
              where: { id: acct.id },
              data: {
                balance: { increment: p.stake },
                lockedBalance: { decrement: p.stake }
              }
            });

            await tx.reputationTransaction.create({
              data: {
                reputationAccountId: acct.id,
                amount: p.stake,
                transactionType: TransactionType.BET_REFUND,
                reason: `Challenge unresolved (${resolutionStatus}): stake refunded`,
                referenceKey: `mp_unres_refund_${bet.id}_${p.userId}`
              }
            });
          }

          await tx.multiplayerBet.update({
            where: { id: bet.id },
            data: { status: MultiplayerBetStatus.CANCELLED, resolvedAt: new Date() }
          });

          return { settled: true, status: MultiplayerBetStatus.CANCELLED };
        }

        // Decisive resolution: FULFILLED (Creator wins) or MISSED (Opponent wins)
        const isCreatorWin = resolutionStatus === 'FULFILLED';
        const winner = isCreatorWin ? creator : opponent;
        const loser = isCreatorWin ? opponent : creator;
        const winningSide = isCreatorWin ? 'CREATOR' : 'OPPONENT';

        const totalPot = bet.totalPot || (creator.stake + opponent.stake);
        const totalFee = Math.floor((totalPot * (bet.feeBps || 0)) / 10000);
        const distributablePot = totalPot - totalFee;

        // 1. Process Winner
        const winnerAcct = await tx.reputationAccount.findUniqueOrThrow({
          where: { userId_communityId: { userId: winner.userId, communityId: bet.communityId } }
        });

        await tx.reputationAccount.update({
          where: { id: winnerAcct.id },
          data: {
            lockedBalance: { decrement: winner.stake },
            balance: { increment: distributablePot }
          }
        });

        await tx.multiplayerBetParticipant.update({
          where: { id: winner.id },
          data: { payout: distributablePot, status: 'WON' }
        });

        // Winner ledger records
        await tx.reputationTransaction.createMany({
          data: [
            {
              reputationAccountId: winnerAcct.id,
              amount: winner.stake,
              transactionType: TransactionType.BET_STAKE_RELEASE,
              reason: 'Challenge won: stake released',
              referenceKey: `mp_release_${bet.id}_${winner.userId}`
            },
            {
              reputationAccountId: winnerAcct.id,
              amount: distributablePot - winner.stake,
              transactionType: TransactionType.BET_WON,
              reason: 'Challenge won: pot winnings awarded',
              referenceKey: `mp_won_${bet.id}_${winner.userId}`
            }
          ]
        });

        // 2. Process Loser
        const loserAcct = await tx.reputationAccount.findUniqueOrThrow({
          where: { userId_communityId: { userId: loser.userId, communityId: bet.communityId } }
        });

        await tx.reputationAccount.update({
          where: { id: loserAcct.id },
          data: {
            lockedBalance: { decrement: loser.stake }
          }
        });

        await tx.multiplayerBetParticipant.update({
          where: { id: loser.id },
          data: { payout: 0, status: 'LOST' }
        });

        await tx.reputationTransaction.create({
          data: {
            reputationAccountId: loserAcct.id,
            amount: -loser.stake,
            transactionType: TransactionType.BET_LOST,
            reason: 'Challenge lost: stake forfeited to pot',
            referenceKey: `mp_lost_${bet.id}_${loser.userId}`
          }
        });

        // 3. Process Fee to RewardPool (if any)
        if (totalFee > 0) {
          await tx.rewardPool.update({
            where: { id: rewardPool.id },
            data: { balance: { increment: totalFee } }
          });

          await tx.rewardPoolTransaction.create({
            data: {
              rewardPoolId: rewardPool.id,
              type: RewardPoolTransactionType.BET_FORFEIT,
              amount: totalFee,
              referenceKey: `mp_pool_fee_${bet.id}`
            }
          });
        }

        // 4. Mark bet as RESOLVED
        await tx.multiplayerBet.update({
          where: { id: bet.id },
          data: {
            status: MultiplayerBetStatus.RESOLVED,
            winnerUserId: winner.userId,
            winningSide,
            resolvedAt: new Date()
          }
        });

        return { settled: true, status: MultiplayerBetStatus.RESOLVED, winnerUserId: winner.userId, winningSide };
      }

      // ----------------------------------------------------------------------
      // CASE 2: PREDICTION_POOL
      // ----------------------------------------------------------------------
      if (bet.betType === MultiplayerBetType.PREDICTION_POOL) {
        // If Unresolved / Ambiguous -> Refund all participants 1:1
        if (['UNRESOLVED', 'PROVIDER_FAILURE', 'AMBIGUOUS', 'EXPIRED'].includes(resolutionStatus)) {
          for (const p of bet.participants) {
            const acct = await tx.reputationAccount.findUniqueOrThrow({
              where: { userId_communityId: { userId: p.userId, communityId: bet.communityId } }
            });

            await tx.reputationAccount.update({
              where: { id: acct.id },
              data: {
                balance: { increment: p.stake },
                lockedBalance: { decrement: p.stake }
              }
            });

            await tx.reputationTransaction.create({
              data: {
                reputationAccountId: acct.id,
                amount: p.stake,
                transactionType: TransactionType.BET_REFUND,
                reason: `Prediction market unresolved (${resolutionStatus}): stake refunded`,
                referenceKey: `mp_pool_refund_${bet.id}_${p.userId}`
              }
            });
          }

          await tx.multiplayerBet.update({
            where: { id: bet.id },
            data: { status: MultiplayerBetStatus.CANCELLED, resolvedAt: new Date() }
          });

          return { settled: true, status: MultiplayerBetStatus.CANCELLED };
        }

        const winningSide = resolutionStatus === 'FULFILLED' ? 'YES' : 'NO';
        const winningParticipants = bet.participants.filter((p: any) => p.side === winningSide);
        const losingParticipants = bet.participants.filter((p: any) => p.side !== winningSide);

        const totalWinningStake = winningParticipants.reduce((sum: number, p: any) => sum + p.stake, 0);

        // Edge case: Nobody bet on the winning side -> Full refund to all participants
        if (totalWinningStake === 0) {
          for (const p of bet.participants) {
            const acct = await tx.reputationAccount.findUniqueOrThrow({
              where: { userId_communityId: { userId: p.userId, communityId: bet.communityId } }
            });

            await tx.reputationAccount.update({
              where: { id: acct.id },
              data: {
                balance: { increment: p.stake },
                lockedBalance: { decrement: p.stake }
              }
            });

            await tx.reputationTransaction.create({
              data: {
                reputationAccountId: acct.id,
                amount: p.stake,
                transactionType: TransactionType.BET_REFUND,
                reason: `No winners on side ${winningSide}: stake refunded`,
                referenceKey: `mp_pool_nowin_refund_${bet.id}_${p.userId}`
              }
            });
          }

          await tx.multiplayerBet.update({
            where: { id: bet.id },
            data: { status: MultiplayerBetStatus.RESOLVED, winningSide, resolvedAt: new Date() }
          });

          return { settled: true, status: MultiplayerBetStatus.RESOLVED, winningSide, noWinners: true };
        }

        const totalPot = bet.totalPot;
        const totalFee = Math.floor((totalPot * (bet.feeBps || 0)) / 10000);
        const distributablePot = totalPot - totalFee;

        let sumPayouts = 0;

        // 1. Process Winners
        for (const p of winningParticipants) {
          const rawPayout = Math.floor((p.stake * distributablePot) / totalWinningStake);
          sumPayouts += rawPayout;

          const acct = await tx.reputationAccount.findUniqueOrThrow({
            where: { userId_communityId: { userId: p.userId, communityId: bet.communityId } }
          });

          await tx.reputationAccount.update({
            where: { id: acct.id },
            data: {
              lockedBalance: { decrement: p.stake },
              balance: { increment: rawPayout }
            }
          });

          await tx.multiplayerBetParticipant.update({
            where: { id: p.id },
            data: { payout: rawPayout, status: 'WON' }
          });

          await tx.reputationTransaction.createMany({
            data: [
              {
                reputationAccountId: acct.id,
                amount: p.stake,
                transactionType: TransactionType.BET_STAKE_RELEASE,
                reason: `Prediction market won (${winningSide}): stake released`,
                referenceKey: `mp_pool_release_${bet.id}_${p.userId}`
              },
              {
                reputationAccountId: acct.id,
                amount: rawPayout - p.stake,
                transactionType: TransactionType.BET_WON,
                reason: `Prediction market won (${winningSide}): winnings awarded`,
                referenceKey: `mp_pool_win_${bet.id}_${p.userId}`
              }
            ]
          });
        }

        // 2. Process Losers
        for (const p of losingParticipants) {
          const acct = await tx.reputationAccount.findUniqueOrThrow({
            where: { userId_communityId: { userId: p.userId, communityId: bet.communityId } }
          });

          await tx.reputationAccount.update({
            where: { id: acct.id },
            data: {
              lockedBalance: { decrement: p.stake }
            }
          });

          await tx.multiplayerBetParticipant.update({
            where: { id: p.id },
            data: { payout: 0, status: 'LOST' }
          });

          await tx.reputationTransaction.create({
            data: {
              reputationAccountId: acct.id,
              amount: -p.stake,
              transactionType: TransactionType.BET_LOST,
              reason: `Prediction market lost: stake forfeited to pool`,
              referenceKey: `mp_pool_loss_${bet.id}_${p.userId}`
            }
          });
        }

        // 3. Dust & Fee allocation to RewardPool
        const dust = distributablePot - sumPayouts;
        const finalPoolFee = totalFee + dust;

        if (finalPoolFee > 0) {
          await tx.rewardPool.update({
            where: { id: rewardPool.id },
            data: { balance: { increment: finalPoolFee } }
          });

          await tx.rewardPoolTransaction.create({
            data: {
              rewardPoolId: rewardPool.id,
              type: RewardPoolTransactionType.BET_FORFEIT,
              amount: finalPoolFee,
              referenceKey: `mp_pool_fee_${bet.id}`
            }
          });
        }

        // 4. Mark bet as RESOLVED
        await tx.multiplayerBet.update({
          where: { id: bet.id },
          data: {
            status: MultiplayerBetStatus.RESOLVED,
            winningSide,
            resolvedAt: new Date()
          }
        });

        return { settled: true, status: MultiplayerBetStatus.RESOLVED, winningSide, sumPayouts, finalPoolFee };
      }

      throw new Error(`UNKNOWN_BET_TYPE: Unsupported bet type ${bet.betType}`);
    });
  }
}
