import { Request, Response } from 'express';
import { PrismaClient, MultiplayerBetType, MultiplayerBetStatus } from '@flowpilot/database';
import { MultiplayerBetService } from '../services/multiplayer-bet.service';

const prisma = new PrismaClient();

export class MultiplayerController {
  static async createChallenge(req: Request, res: Response) {
    try {
      const { communityId, creatorId, targetUserId, claim, normalizedClaim, deadline, stake, feeBps, commitmentId } = req.body;
      
      const bet = await MultiplayerBetService.createChallenge({
        communityId,
        creatorId,
        targetUserId,
        claim,
        normalizedClaim: normalizedClaim || claim,
        deadline: new Date(deadline),
        stake: Number(stake),
        feeBps: Number(feeBps || 0),
        commitmentId
      });

      return res.status(201).json(bet);
    } catch (err: any) {
      console.error('[MultiplayerController] createChallenge error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  static async acceptChallenge(req: Request, res: Response) {
    try {
      const { multiplayerBetId, userId, communityId, conversationId } = req.body;
      
      const bet = await MultiplayerBetService.acceptChallenge({
        multiplayerBetId,
        userId,
        communityId
      });

      // Automatically enqueue immediate web verification
      try {
        const { enqueueMultiplayerVerification } = require('../queue/producer');
        await enqueueMultiplayerVerification(bet.id, conversationId);
      } catch (qErr: any) {
        console.warn(`[MultiplayerController] Failed to enqueue auto-verification:`, qErr.message);
      }

      return res.status(200).json(bet);
    } catch (err: any) {
      console.error('[MultiplayerController] acceptChallenge error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  static async cancelChallenge(req: Request, res: Response) {
    try {
      const { multiplayerBetId, userId, communityId } = req.body;
      
      const bet = await MultiplayerBetService.cancelChallenge({
        multiplayerBetId,
        userId,
        communityId
      });

      return res.status(200).json(bet);
    } catch (err: any) {
      console.error('[MultiplayerController] cancelChallenge error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  static async listChallenges(req: Request, res: Response) {
    try {
      const { communityId } = req.query;
      
      const challenges = await prisma.multiplayerBet.findMany({
        where: {
          communityId: String(communityId),
          betType: MultiplayerBetType.HEAD_TO_HEAD,
          status: { in: [MultiplayerBetStatus.OFFERED, MultiplayerBetStatus.ACTIVE] }
        },
        include: {
          creator: true,
          targetUser: true,
          participants: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      });

      return res.status(200).json(challenges);
    } catch (err: any) {
      console.error('[MultiplayerController] listChallenges error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  static async createMarket(req: Request, res: Response) {
    try {
      const { communityId, creatorId, claim, normalizedClaim, deadline, feeBps, commitmentId } = req.body;

      const market = await MultiplayerBetService.createPredictionMarket({
        communityId,
        creatorId,
        claim,
        normalizedClaim: normalizedClaim || claim,
        deadline: new Date(deadline),
        feeBps: Number(feeBps || 0),
        commitmentId
      });

      return res.status(201).json(market);
    } catch (err: any) {
      console.error('[MultiplayerController] createMarket error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  static async joinMarket(req: Request, res: Response) {
    try {
      const { multiplayerBetId, userId, communityId, side, stake } = req.body;

      const participant = await MultiplayerBetService.joinPredictionMarket({
        multiplayerBetId,
        userId,
        communityId,
        side,
        stake: Number(stake)
      });

      return res.status(201).json(participant);
    } catch (err: any) {
      console.error('[MultiplayerController] joinMarket error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  static async cancelMarket(req: Request, res: Response) {
    try {
      const { multiplayerBetId, userId, communityId } = req.body;

      const market = await MultiplayerBetService.cancelPredictionMarket(multiplayerBetId, userId, communityId);

      return res.status(200).json(market);
    } catch (err: any) {
      console.error('[MultiplayerController] cancelMarket error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  static async listMarkets(req: Request, res: Response) {
    try {
      const { communityId } = req.query;

      const markets = await prisma.multiplayerBet.findMany({
        where: {
          communityId: String(communityId),
          betType: MultiplayerBetType.PREDICTION_POOL,
          status: MultiplayerBetStatus.OPEN
        },
        include: {
          participants: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      });

      return res.status(200).json(markets);
    } catch (err: any) {
      console.error('[MultiplayerController] listMarkets error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  static async getMarket(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const market = await prisma.multiplayerBet.findUnique({
        where: { id },
        include: {
          participants: {
            include: { user: true }
          }
        }
      });

      if (!market) {
        return res.status(404).json({ error: 'Market not found' });
      }

      return res.status(200).json(market);
    } catch (err: any) {
      console.error('[MultiplayerController] getMarket error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }
}
