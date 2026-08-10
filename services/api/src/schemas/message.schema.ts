import { z } from 'zod';

export const ParseMessageSchema = z.object({
  platform: z.string(),
  messageId: z.string(),
  userId: z.string(),
  communityId: z.string(),
  channel: z.string(),
  conversationId: z.string(),
  message: z.string().min(1)
});

export type ParseMessageData = z.infer<typeof ParseMessageSchema>;
