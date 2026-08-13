import Redis from 'ioredis';
import { CommClient } from 'caspian-sdk';

if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for production.');
const redisUrl = process.env.REDIS_URL;
const redis = new Redis(redisUrl);

let caspianClient: CommClient | null = null;
try {
  caspianClient = new CommClient({
    apiKey: process.env.CASPIAN_API_KEY,
    baseUrl: process.env.CASPIAN_BASE_URL || 'https://api.trycaspianai.com'
  });
} catch (e) {
  console.warn("[OutboundResponder] Caspian CommClient failed to initialize. Outbound messages will fallback to console.");
}

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
    
    if (caspianClient) {
      try {
        await caspianClient.sendMessage(conversationId, question);
      } catch (e: any) {
        console.error(`[OutboundResponder] Failed to send clarification via Caspian: ${e.message}`);
      }
    } else {
      console.log(`\n========================================`);
      console.log(`[OUTBOUND MESSAGE -> Caspian (MOCK)]`);
      console.log(`To: User ${userId} in ${conversationId}`);
      console.log(`Bot: "${question}"`);
      console.log(`========================================\n`);
    }
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
   * Explicitly saves the pending state (e.g. for resuming after GitHub OAuth)
   * Returns the Redis key used, so it can be passed to the OAuth flow.
   */
  static async savePendingState(
    communityId: string, 
    userId: string, 
    conversationId: string, 
    state: ClarificationState
  ): Promise<string> {
    const key = `clarify:${communityId}:${userId}:${conversationId}`;
    await redis.set(key, JSON.stringify(state), 'EX', 3600);
    return key;
  }

  /**
   * Sends a message asking the user to connect their GitHub account.
   */
  static async askGithubConnect(
    communityId: string,
    userId: string,
    conversationId: string,
    targetRepo: string,
    stateKey: string
  ) {
    if (!process.env.AETHER_API_URL) throw new Error('AETHER_API_URL is required for production.');
    const baseUrl = process.env.AETHER_API_URL;
    const connectUrl = `${baseUrl}/api/github/connect?userId=${userId}&communityId=${communityId}&targetRepo=${encodeURIComponent(targetRepo)}&stateKey=${encodeURIComponent(stateKey)}`;
    
    const text = `🔒 I don't have access to **${targetRepo}**!\n\nPlease link your GitHub account by clicking here:\n[Connect GitHub](${connectUrl})\n\nOnce linked, I'll automatically resume creating your commitment!`;
    
    await this.sendMessage(communityId, userId, conversationId, text);
  }

  /**
   * Sends a final success/failure message.
   */
  static async sendMessage(communityId: string, userId: string, conversationId: string, text: string) {
    if (caspianClient) {
      try {
        await caspianClient.sendMessage(conversationId, text);
      } catch (e: any) {
        console.error(`[OutboundResponder] Failed to send message via Caspian: ${e.message}`);
      }
    } else {
      console.log(`\n========================================`);
      console.log(`[OUTBOUND MESSAGE -> Caspian (MOCK)]`);
      console.log(`To: User ${userId} in ${conversationId}`);
      console.log(`Bot: "${text}"`);
      console.log(`========================================\n`);
    }
  }
}
