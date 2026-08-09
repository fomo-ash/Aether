import { Request, Response } from 'express';
import { ParseMessageSchema } from '../schemas/message.schema';
import { enqueueMessage } from '../queue/producer';

export class MessageController {
  static async parse(req: Request, res: Response) {
    try {
      // 1. Validate the incoming payload from Caspian
      const parseResult = ParseMessageSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          details: parseResult.error.format()
        });
      }

      const validData = parseResult.data;

      // 2. Enqueue the message to BullMQ for async LLM extraction
      await enqueueMessage(validData);

      // 3. Construct the deterministic job ID for the response
    const jobId = `message_${validData.channel}_${validData.communityId}_${validData.messageId}`;

      // 4. Return 202 Accepted instantly
      return res.status(202).json({
        status: 'accepted',
        jobId
      });

    } catch (error) {
      console.error('Error handling message parsing request:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
