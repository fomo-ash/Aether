import { Request, Response } from 'express';
import { ReputationService } from '../services/reputation.service';

export class ReputationController {
  static async getReputation(req: Request, res: Response) {
    const { userId, communityId } = req.query;

    if (!userId || !communityId) {
      return res.status(400).json({ error: 'userId and communityId are required' });
    }

    try {
      const summary = await ReputationService.getSummary(userId as string, communityId as string);
      return res.json(summary);
    } catch (error: any) {
      console.error('Error fetching reputation summary:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
