import { Request, Response } from 'express';
import { scheduleVerification } from '../queue/producer';
import { CommitmentCreateSchema, CommitmentService } from '@aether/commitments';

export class CommitmentController {
  static async create(req: Request, res: Response) {
    try {
      // 1. Validate the incoming payload from the AI/Webhook
      const parseResult = CommitmentCreateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          details: parseResult.error.format()
        });
      }

      const validData = parseResult.data;

      // 2. Persist the commitment to the database
      const commitment = await CommitmentService.createCommitment(validData);

      // 3. Schedule the background verification job in BullMQ
      await scheduleVerification(commitment.id, commitment.deadline!);

      // 4. Return success
      return res.status(201).json({
        message: 'Commitment successfully created and scheduled',
        data: commitment
      });

    } catch (error) {
      console.error('Error creating commitment:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  /**
   * Manually trigger verification for a specific commitment
   */
  static async verify(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      const commitment = await CommitmentService.getCommitmentById(id);
      if (!commitment) {
        return res.status(404).json({ error: 'Commitment not found' });
      }

      if (commitment.status !== 'AWAITING_VERIFICATION') {
        return res.status(400).json({ 
          error: 'Commitment is not in AWAITING_VERIFICATION state',
          currentStatus: commitment.status 
        });
      }

      // Schedule for immediate execution by passing the current time
      // The BullMQ producer checks if the deadline is in the past/now and schedules it immediately
      await scheduleVerification(commitment.id, new Date());

      return res.status(200).json({
        message: 'Verification job successfully triggered',
        commitmentId: commitment.id
      });
      
    } catch (error) {
      console.error('Error triggering manual verification:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
