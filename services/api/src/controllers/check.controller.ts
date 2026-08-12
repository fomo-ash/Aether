import { Request, Response } from 'express';
import { enqueueCheck } from '../queue/producer';

export class CheckController {
  static async check(req: Request, res: Response) {
    try {
      const { userId, communityId, conversationId, claim } = req.body;
      if (!userId || !communityId || !conversationId || !claim) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const jobId = `check_${communityId}_${userId}_${Date.now()}`;
      await enqueueCheck({
        userId,
        communityId,
        conversationId,
        claim
      }, jobId);

      return res.status(202).json({
        status: 'accepted',
        jobId
      });
    } catch (error) {
      console.error('Error enqueuing check request:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
