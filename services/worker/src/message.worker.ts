import { Job } from 'bullmq';
import { AIService } from './services/ai.service';
import { ContextResolver } from './services/context-resolver';
import { OutboundResponder } from './services/outbound-responder';
import { CommitmentService } from '@aether/commitments';

export interface MessagePayload {
  messageId: string;
  userId: string;
  communityId: string;
  channel: string;
  conversationId: string;
  message: string;
}

export async function processMessageJob(job: Job<MessagePayload>) {
  console.log(`\n========================================`);
  console.log(`[Message Worker] Picked up job: ${job.id}`);
  
  const { message, userId, communityId, channel, conversationId } = job.data;
  console.log(`[Context] User: ${userId} | Community: ${communityId} | Channel: ${channel} | Conversation: ${conversationId}`);
  console.log(`[Message] "${message}"`);
  
  try {
    let finalMessage = message;
    
    // ---------------------------------------------------------
    // Check for Pending Clarification State
    // ---------------------------------------------------------
    const pendingState = await OutboundResponder.getPendingState(communityId, userId, conversationId);
    if (pendingState) {
      console.log(`[Message Worker] Resuming pending interaction...`);
      finalMessage = `Context: ${pendingState.originalMessage}\nUser Clarification: ${message}`;
    }

    // ---------------------------------------------------------
    // Step 6 - Call Featherless LLM to extract Intent
    // ---------------------------------------------------------
    console.log(`[Message Worker] Calling Featherless AI...`);
    const extraction = await AIService.extractIntent(finalMessage);
    console.log(`[Featherless Output] Intent: ${extraction.intent}`);
    console.log(`[Featherless Output] Target: ${extraction.targetReference}`);
    console.log(`[Featherless Output] Deadline: ${extraction.deadlineText}`);
    
    // ---------------------------------------------------------
    // Step 7 - Deterministic Context Resolution
    // ---------------------------------------------------------
    console.log(`[Message Worker] Resolving context deterministically...`);
    const resolvedContext = await ContextResolver.resolve(
      communityId,
      extraction.proposedVerifier,
      extraction.targetReference,
      extraction.deadlineText
    );

    if (!resolvedContext.isComplete) {
      console.log(`[Message Worker] Context incomplete. Missing: ${resolvedContext.missingRequirements.join(', ')}`);
      
      const question = `I need a bit more info: What is the ${resolvedContext.missingRequirements.join(' and ')}?`;
      
      await OutboundResponder.askClarification(communityId, userId, conversationId, question, {
        originalMessage: message,
        missingRequirements: resolvedContext.missingRequirements,
        extractionContext: extraction
      });
      return { status: 'clarification_requested' };
    }

    // ---------------------------------------------------------
    // Step 8 - Commitment Creation (Domain Logic)
    // ---------------------------------------------------------
    console.log(`[Message Worker] Context is complete! Creating commitment...`);
    const commitment = await CommitmentService.createCommitment({
      userId,
      communityId,
      statement: message,
      deadline: resolvedContext.resolvedDeadline!.toISOString(),
      verifierType: resolvedContext.proposedVerifier,
      target: resolvedContext.resolvedTarget!,
      successCondition: 'closed' // Simplified for MVP
    });

    // ---------------------------------------------------------
    // Step 9 - Verification Queue Integration
    // ---------------------------------------------------------
    console.log(`[Message Worker] Handing off to verification queue...`);
    const { Queue } = require('bullmq');
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
    const verificationQueue = new Queue('verification-queue', { connection: redis });
    
    const deadlineDate = resolvedContext.resolvedDeadline!;
    const delay = Math.max(0, deadlineDate.getTime() - Date.now());
    await verificationQueue.add('verify', { commitmentId: commitment.id }, { delay, jobId: `verify-${commitment.id}` });

    await OutboundResponder.clearPendingState(communityId, userId, conversationId);
    await OutboundResponder.sendMessage(communityId, userId, conversationId, `✅ Commitment created. I'll verify ${resolvedContext.resolvedTarget} is closed by ${deadlineDate.toDateString()}.`);
    
    console.log(`[Message Worker] Successfully processed job ${job.id} -> Commitment ${commitment.id}`);
    console.log(`========================================\n`);
    
    return { status: 'success', commitmentId: commitment.id };
  } catch (error: any) {
    console.error(`[Message Worker] Fatal error processing job ${job.id}:`, error.message);
    throw error; // Let BullMQ handle retries
  }
}
