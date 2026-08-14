import { z } from 'zod';

export const ExtractionResultSchema = z.object({
  intent: z.enum(["COMMITMENT", "NOT_COMMITMENT", "BET", "AMBIGUOUS"]),
  statement: z.string().optional(),
  targetReference: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  proposedVerifier: z.string().nullable().optional(),
  stake: z.coerce.number().nullable().optional(),
  multiplier: z.coerce.number().nullable().optional(),
  reward: z.number().nullable().optional(),
  penalty: z.number().nullable().optional(),
  missingInformation: z.array(z.string()).nullable().optional()
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
