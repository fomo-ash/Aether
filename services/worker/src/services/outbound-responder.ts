import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

export interface ClarificationState {
  originalMessage: string;
  missingRequirements: string[];
  extractionContext: any;
}

export class OutboundResponder {
  /**
   * Asks the user a clarification question and stores the pending interaction state.
   */
  static async askClarification(
    communityId: string, 
    userId: string, 
    conversationId: string, 
    question: string,
    state: ClarificationState
  ) {
    const key = `clarify:${communityId}:${userId}:${conversationId}`;
    
    // Store transient state for 1 hour
    await redis.set(key, JSON.stringify(state), 'EX', 3600);
    
    // In a real integration, this would call the Caspian/Discord API
    console.log(`\n========================================`);
    console.log(`[OUTBOUND MESSAGE -> Caspian]`);
    console.log(`To: User ${userId} in ${conversationId}`);
    console.log(`Bot: "${question}"`);
    console.log(`========================================\n`);
  }

  /**
   * Checks if there is an active clarification state for this conversation.
   */
  static async getPendingState(
    communityId: string, 
    userId: string, 
    conversationId: string
  ): Promise<ClarificationState | null> {
    const key = `clarify:${communityId}:${userId}:${conversationId}`;
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as ClarificationState;
  }

  /**
   * Clears the clarification state once resolved.
   */
  static async clearPendingState(communityId: string, userId: string, conversationId: string) {
    const key = `clarify:${communityId}:${userId}:${conversationId}`;
    await redis.del(key);
  }

  /**
   * Sends a final success/failure message.
   */
  static async sendMessage(communityId: string, userId: string, conversationId: string, text: string) {
    console.log(`\n========================================`);
    console.log(`[OUTBOUND MESSAGE -> Caspian]`);
    console.log(`To: User ${userId} in ${conversationId}`);
    console.log(`Bot: "${text}"`);
    console.log(`========================================\n`);
  }
}
