import { z } from 'zod';

export const ExtractionResultSchema = z.object({
  intent: z.enum(["COMMITMENT", "NOT_COMMITMENT", "BET", "AMBIGUOUS"]),
  statement: z.string().optional(),
  targetReference: z.string().optional(),
  deadlineText: z.string().optional(),
  proposedVerifier: z.string().optional(),
  reward: z.number().optional(),
  penalty: z.number().optional(),
  missingInformation: z.array(z.string()).optional()
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
