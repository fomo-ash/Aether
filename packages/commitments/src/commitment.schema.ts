import { z } from 'zod';

export const CommitmentCreateSchema = z.object({
  userId: z.string(),
  communityId: z.string(),
  statement: z.string(),
  deadline: z.string().datetime(), // ISO 8601 string
  verifierType: z.string(),
  target: z.string(),
  successCondition: z.any(),
  configuration: z.any().optional(),
  conversationId: z.string().optional(),
  reward: z.number().optional(),
  penalty: z.number().optional()
});

export type CommitmentCreateDTO = z.infer<typeof CommitmentCreateSchema>;
