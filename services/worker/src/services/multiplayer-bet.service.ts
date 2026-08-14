import { PrismaClient, TransactionType, MultiplayerBetType, MultiplayerBetStatus } from '@flowpilot/database';

const prisma = new PrismaClient();

export interface CreateChallengeInput {
  communityId: string;
  creatorId: string;
  targetUserId?: string | null;
  claim: string;
  normalizedClaim: string;
  deadline: Date;
  stake: number;
  feeBps?: number;
  commitmentId?: string | null;
}

export interface AcceptChallengeInput {
  multiplayerBetId: string;
  userId: string;
  communityId: string;
}

export interface CancelChallengeInput {
  multiplayerBetId: string;
  userId: string;
  communityId: string;
}

export interface CreatePredictionMarketInput {
  communityId: string;
  creatorId: string;
  claim: string;
  normalizedClaim: string;
  deadline: Date;
  feeBps?: number;
  commitmentId?: string | null;
}

export interface JoinPredictionMarketInput {
  multiplayerBetId: string;
  userId: string;
  communityId: string;
  side: 'YES' | 'NO';
  stake: number;
}

export class MultiplayerBetService {
  /**
   * Creates a 1v1 Head-to-Head Challenge and atomically locks the creator's stake.
   */
  static async createChallenge(input: CreateChallengeInput) {
    const { communityId, creatorId, targetUserId, claim, normalizedClaim, deadline, stake, feeBps = 0, commitmentId } = input;

    if (!stake || stake <= 0) {
      throw new Error('INVALID_STAKE: Stake must be greater than 0.');
    }

    if (!deadline || new Date(deadline) <= new Date()) {
      throw new Error('INVALID_DEADLINE: Deadline must be in the future.');
    }

    if (targetUserId && targetUserId === creatorId) {
      throw new Error('INVALID_OPPONENT: Cannot challenge yourself.');
    }

    return await prisma.$transaction(async (tx: any) => {
      // 1. Verify creator reputation account & lock stake
      const account = await tx.reputationAccount.findUnique({
        where: { userId_communityId: { userId: creatorId, communityId } }
      });

      if (!account || account.balance < stake) {
        throw new Error('INSUFFICIENT_REP: You do not have enough available REP to create this challenge.');
      }

      await tx.reputationAccount.update({
        where: { id: account.id },
        data: {
          balance: { decrement: stake },
          lockedBalance: { increment: stake }
        }
      });

      // 2. Create the MultiplayerBet record
      const bet = await tx.multiplayerBet.create({
        data: {
          communityId,
          creatorId,
          targetUserId: targetUserId || null,
          betType: MultiplayerBetType.HEAD_TO_HEAD,
          status: MultiplayerBetStatus.OFFERED,
          claim,
          normalizedClaim,
          deadline: new Date(deadline),
          targetStake: stake,
          totalPot: stake,
          feeBps,
          commitmentId: commitmentId || null
        }
      });

      // 3. Create participant for Creator
      await tx.multiplayerBetParticipant.create({
        data: {
          multiplayerBetId: bet.id,
          userId: creatorId,
          side: 'CREATOR',
          stake,
          status: 'ACTIVE'
        }
      });

      // 4. Ledger transaction for stake lock
      await tx.reputationTransaction.create({
        data: {
          reputationAccountId: account.id,
          amount: -stake,
          transactionType: TransactionType.BET_STAKE_LOCK,
          reason: `Challenge created: staked ${stake} REP`,
          referenceKey: `mp_lock_${bet.id}_${creatorId}`
        }
      });

      return bet;
    });
  }

  /**
   * Accepts a 1v1 Challenge atomically.
   */
  static async acceptChallenge(input: AcceptChallengeInput) {
    const { multiplayerBetId, userId, communityId } = input;

    return await prisma.$transaction(async (tx: any) => {
      // 1. Atomically attempt to transition status from OFFERED to ACTIVE
      const bet = await tx.multiplayerBet.findUnique({
        where: { id: multiplayerBetId }
      });

      if (!bet) {
        throw new Error('BET_NOT_FOUND: Challenge does not exist.');
      }

      if (bet.communityId !== communityId) {
        throw new Error('CROSS_COMMUNITY_FORBIDDEN: Challenge belongs to a different community.');
      }

      if (bet.status !== MultiplayerBetStatus.OFFERED) {
        throw new Error(`INVALID_STATUS: Challenge is not open for acceptance (current status: ${bet.status}).`);
      }

      if (new Date() >= new Date(bet.deadline)) {
        throw new Error('EXPIRED: Challenge deadline has already passed.');
      }

      if (bet.creatorId === userId) {
        throw new Error('SELF_ACCEPT_FORBIDDEN: You cannot accept your own challenge.');
      }

      if (bet.targetUserId && bet.targetUserId !== userId) {
        throw new Error('UNAUTHORIZED_ACCEPTOR: This challenge was issued to a specific user.');
      }

      // Concurrency protection: Atomic conditional update
      const updateResult = await tx.$executeRaw`
        UPDATE multiplayer_bets
        SET status = 'ACTIVE'::"MultiplayerBetStatus",
            total_pot = total_pot + target_stake,
            updated_at = NOW()
        WHERE id = ${multiplayerBetId} AND status = 'OFFERED'::"MultiplayerBetStatus"
      `;

      if (updateResult === 0) {
        throw new Error('CONCURRENCY_LOCKED: Challenge was already accepted by another user.');
      }

      // 2. Lock opponent stake
      const account = await tx.reputationAccount.findUnique({
        where: { userId_communityId: { userId, communityId } }
      });

      if (!account || account.balance < bet.targetStake) {
        throw new Error('INSUFFICIENT_REP: You do not have enough available REP to accept this challenge.');
      }

      await tx.reputationAccount.update({
        where: { id: account.id },
        data: {
          balance: { decrement: bet.targetStake },
          lockedBalance: { increment: bet.targetStake }
        }
      });

      // 3. Create participant for Opponent
      await tx.multiplayerBetParticipant.create({
        data: {
          multiplayerBetId: bet.id,
          userId,
          side: 'OPPONENT',
          stake: bet.targetStake,
          status: 'ACTIVE'
        }
      });

      // 4. Ledger transaction for opponent stake lock
      await tx.reputationTransaction.create({
        data: {
          reputationAccountId: account.id,
          amount: -bet.targetStake,
          transactionType: TransactionType.BET_STAKE_LOCK,
          reason: `Challenge accepted: staked ${bet.targetStake} REP`,
          referenceKey: `mp_lock_${bet.id}_${userId}`
        }
      });

      return await tx.multiplayerBet.findUniqueOrThrow({ where: { id: multiplayerBetId }, include: { participants: true } });
    });
  }

  /**
   * Cancels an unaccepted challenge and refunds creator stake.
   */
  static async cancelChallenge(input: CancelChallengeInput) {
    const { multiplayerBetId, userId, communityId } = input;

    return await prisma.$transaction(async (tx: any) => {
      const bet = await tx.multiplayerBet.findUnique({
        where: { id: multiplayerBetId }
      });

      if (!bet) {
        throw new Error('BET_NOT_FOUND: Challenge does not exist.');
      }

      if (bet.communityId !== communityId) {
        throw new Error('CROSS_COMMUNITY_FORBIDDEN: Challenge belongs to a different community.');
      }

      if (bet.creatorId !== userId) {
        throw new Error('UNAUTHORIZED: Only the challenge creator can cancel an unaccepted challenge.');
      }

      // Atomic conditional update
      const updateResult = await tx.$executeRaw`
        UPDATE multiplayer_bets
        SET status = 'CANCELLED'::"MultiplayerBetStatus",
            updated_at = NOW()
        WHERE id = ${multiplayerBetId} AND status = 'OFFERED'::"MultiplayerBetStatus"
      `;

      if (updateResult === 0) {
        throw new Error('CANNOT_CANCEL: Challenge is no longer in OFFERED status.');
      }

      // Refund creator stake
      const account = await tx.reputationAccount.findUniqueOrThrow({
        where: { userId_communityId: { userId, communityId } }
      });

      await tx.reputationAccount.update({
        where: { id: account.id },
        data: {
          balance: { increment: bet.targetStake },
          lockedBalance: { decrement: bet.targetStake }
        }
      });

      await tx.reputationTransaction.create({
        data: {
          reputationAccountId: account.id,
          amount: bet.targetStake,
          transactionType: TransactionType.BET_REFUND,
          reason: `Challenge cancelled: refunded ${bet.targetStake} REP`,
          referenceKey: `mp_cancel_refund_${bet.id}_${userId}`
        }
      });

      return await tx.multiplayerBet.findUniqueOrThrow({ where: { id: multiplayerBetId } });
    });
  }

  /**
   * Creates a Prediction Market pool.
   */
  static async createPredictionMarket(input: CreatePredictionMarketInput) {
    const { communityId, creatorId, claim, normalizedClaim, deadline, feeBps = 0, commitmentId } = input;

    if (!deadline || new Date(deadline) <= new Date()) {
      throw new Error('INVALID_DEADLINE: Market close deadline must be in the future.');
    }

    return await prisma.multiplayerBet.create({
      data: {
        communityId,
        creatorId,
        betType: MultiplayerBetType.PREDICTION_POOL,
        status: MultiplayerBetStatus.OPEN,
        claim,
        normalizedClaim,
        deadline: new Date(deadline),
        targetStake: 0,
        totalPot: 0,
        yesPool: 0,
        noPool: 0,
        feeBps,
        commitmentId: commitmentId || null
      }
    });
  }

  /**
   * Joins a Prediction Market on YES or NO side.
   */
  static async joinPredictionMarket(input: JoinPredictionMarketInput) {
    const { multiplayerBetId, userId, communityId, side, stake } = input;

    if (!stake || stake <= 0) {
      throw new Error('INVALID_STAKE: Stake must be greater than 0.');
    }

    if (side !== 'YES' && side !== 'NO') {
      throw new Error('INVALID_SIDE: Must bet on YES or NO.');
    }

    return await prisma.$transaction(async (tx: any) => {
      const bet = await tx.multiplayerBet.findUnique({
        where: { id: multiplayerBetId }
      });

      if (!bet) {
        throw new Error('BET_NOT_FOUND: Market does not exist.');
      }

      if (bet.communityId !== communityId) {
        throw new Error('CROSS_COMMUNITY_FORBIDDEN: Market belongs to a different community.');
      }

      if (bet.status !== MultiplayerBetStatus.OPEN) {
        throw new Error(`MARKET_CLOSED: Market is not open for betting (current status: ${bet.status}).`);
      }

      if (new Date() >= new Date(bet.deadline)) {
        throw new Error('DEADLINE_PASSED: Market has closed.');
      }

      // Check for existing position
      const existing = await tx.multiplayerBetParticipant.findUnique({
        where: { multiplayerBetId_userId: { multiplayerBetId, userId } }
      });

      if (existing) {
        throw new Error('DUPLICATE_POSITION: You already hold a position in this market.');
      }

      // Check balance and lock stake
      const account = await tx.reputationAccount.findUnique({
        where: { userId_communityId: { userId, communityId } }
      });

      if (!account || account.balance < stake) {
        throw new Error('INSUFFICIENT_REP: You do not have enough available REP to place this bet.');
      }

      await tx.reputationAccount.update({
        where: { id: account.id },
        data: {
          balance: { decrement: stake },
          lockedBalance: { increment: stake }
        }
      });

      // Update market pools atomically
      const poolField = side === 'YES' ? 'yesPool' : 'noPool';
      await tx.multiplayerBet.update({
        where: { id: multiplayerBetId },
        data: {
          totalPot: { increment: stake },
          [poolField]: { increment: stake }
        }
      });

      // Create participant
      const participant = await tx.multiplayerBetParticipant.create({
        data: {
          multiplayerBetId,
          userId,
          side,
          stake,
          status: 'ACTIVE'
        }
      });

      // Ledger transaction
      await tx.reputationTransaction.create({
        data: {
          reputationAccountId: account.id,
          amount: -stake,
          transactionType: TransactionType.BET_STAKE_LOCK,
          reason: `Prediction Market joined on ${side}: staked ${stake} REP`,
          referenceKey: `mp_lock_${multiplayerBetId}_${userId}`
        }
      });

      return participant;
    });
  }

  /**
   * Cancels a Prediction Market and refunds all participants.
   */
  static async cancelPredictionMarket(multiplayerBetId: string, userId: string, communityId: string) {
    return await prisma.$transaction(async (tx: any) => {
      const bet = await tx.multiplayerBet.findUnique({
        where: { id: multiplayerBetId },
        include: { participants: true }
      });

      if (!bet) throw new Error('BET_NOT_FOUND: Market does not exist.');
      if (bet.communityId !== communityId) throw new Error('CROSS_COMMUNITY_FORBIDDEN: Market belongs to a different community.');
      if (bet.creatorId !== userId) throw new Error('UNAUTHORIZED: Only the market creator can cancel.');
      if (bet.status !== MultiplayerBetStatus.OPEN) throw new Error('CANNOT_CANCEL: Market is no longer OPEN.');

      await tx.multiplayerBet.update({
        where: { id: multiplayerBetId },
        data: { status: MultiplayerBetStatus.CANCELLED, resolvedAt: new Date() }
      });

      // Refund all participants
      for (const p of bet.participants) {
        const account = await tx.reputationAccount.findUniqueOrThrow({
          where: { userId_communityId: { userId: p.userId, communityId } }
        });

        await tx.reputationAccount.update({
          where: { id: account.id },
          data: {
            balance: { increment: p.stake },
            lockedBalance: { decrement: p.stake }
          }
        });

        await tx.reputationTransaction.create({
          data: {
            reputationAccountId: account.id,
            amount: p.stake,
            transactionType: TransactionType.BET_REFUND,
            reason: `Market cancelled: refunded ${p.stake} REP`,
            referenceKey: `mp_cancel_refund_${bet.id}_${p.userId}`
          }
        });
      }

      return bet;
    });
  }
}
