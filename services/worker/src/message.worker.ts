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
  telemetry?: any;
}

export async function processMessageJob(job: Job<MessagePayload>) {
  console.log(`\n========================================`);
  console.log(`[Message Worker] Picked up job: ${job.id}`);
  
  const { message, userId, communityId, channel, conversationId, telemetry } = job.data;
  const workerStartedAt = Date.now();
  console.log(`[Context] User: ${userId} | Community: ${communityId} | Channel: ${channel} | Conversation: ${conversationId}`);
  console.log(`[Message] "${message}"`);
  
  try {
    let finalMessage = message;
    
    // ---------------------------------------------------------
    // Check for Pending Clarification State
    // ---------------------------------------------------------
    const pendingState = await OutboundResponder.getPendingState(communityId, userId, conversationId);
    let cumulativeContext = message;
    
    if (pendingState) {
      console.log(`[Message Worker] Resuming pending interaction...`);
      cumulativeContext = `${pendingState.originalMessage}\nUser Clarification: ${message}`;
      finalMessage = `Context: ${pendingState.originalMessage}\nUser Clarification: ${message}`;
    } else if (!message.startsWith('/aether commit')) {
      console.log(`[Message Worker] Message is not a command and there's no pending state. Ignoring.`);
      return { status: 'ignored' };
    }

    // ---------------------------------------------------------
    // Step 6 - Call Featherless LLM to extract Intent
    // ---------------------------------------------------------
    console.log(`[Message Worker] Calling Featherless AI...`);
    const llmStartedAt = Date.now();
    const extraction = await AIService.extractIntent(finalMessage);
    const llmCompletedAt = Date.now();
    console.log(`[Featherless Output] Intent: ${extraction.intent}`);
    console.log(`[Featherless Output] Target: ${extraction.targetReference}`);
    console.log(`[Featherless Output] Deadline: ${extraction.deadline}`);
    console.log(`[Featherless Output] Stake: ${extraction.stake}`);
    
    // ---------------------------------------------------------
    // Step 7 - Deterministic Context Resolution
    // ---------------------------------------------------------
    console.log(`[Message Worker] Resolving context deterministically...`);
    const resolvedContext = await ContextResolver.resolve(
      communityId,
      extraction.proposedVerifier,
      extraction.targetReference,
      extraction.deadline,
      extraction.stake
    );

    if (!resolvedContext.isComplete) {
      console.log(`[Message Worker] Context incomplete. Missing: ${resolvedContext.missingRequirements.join(', ')}`);
      
      let question = `I need a little more information to finalize this commitment! 🤖\n\n`;
      question += `Please provide the following:\n`;
      for (const req of resolvedContext.missingRequirements) {
        question += `- **${req}**\n`;
      }
      
      await OutboundResponder.askClarification(communityId, userId, conversationId, question, {
        originalMessage: cumulativeContext,
        missingRequirements: resolvedContext.missingRequirements,
        extractionContext: extraction
      });
      return { status: 'clarification_requested' };
    }

    // ---------------------------------------------------------
    // Step 8 - Commitment Creation (Domain Logic)
    // ---------------------------------------------------------
    console.log(`[Message Worker] Context is complete! Creating commitment...`);
    const commitmentCreatedAt = Date.now();
    const commitment = await CommitmentService.createCommitment({
      userId,
      communityId,
      statement: message,
      deadline: resolvedContext.resolvedDeadline!.toISOString(),
      verifierType: resolvedContext.proposedVerifier,
      target: resolvedContext.resolvedTarget!,
      successCondition: { operator: 'equals', expected: 'closed' }, // Simplified for MVP
      conversationId: conversationId,
      reward: resolvedContext.resolvedStake,
      penalty: resolvedContext.resolvedStake
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
    
    const replyText = `✅ **Commitment created**\n\n` + 
      `🎯 **Target**: ${resolvedContext.resolvedTarget}\n` +
      `⏰ **Deadline**: ${deadlineDate.toUTCString()}\n` +
      `🔥 **Reputation at stake**: ${resolvedContext.resolvedStake}\n\n` +
      `🔍 **Verification**: I'll automatically verify the target before the deadline.`;
      
    await OutboundResponder.sendMessage(communityId, userId, conversationId, replyText);
    
    const outboundCompletedAt = Date.now();
    
    // Telemetry Dump
    console.log(`\n[Telemetry] messageReceivedAt: ${telemetry?.receivedAt}`);
    console.log(`[Telemetry] workerStartedAt: ${workerStartedAt}`);
    console.log(`[Telemetry] llmLatencyMs: ${llmCompletedAt - llmStartedAt}`);
    console.log(`[Telemetry] commitmentCreatedAt: ${commitmentCreatedAt}`);
    console.log(`[Telemetry] totalPipelineLatencyMs: ${outboundCompletedAt - (telemetry?.receivedAt || workerStartedAt)}`);

    console.log(`[Message Worker] Successfully processed job ${job.id} -> Commitment ${commitment.id}`);
    console.log(`========================================\n`);
    
    return { status: 'success', commitmentId: commitment.id };
  } catch (error: any) {
    console.error(`[Message Worker] Fatal error processing job ${job.id}:`, error.message);
    throw error; // Let BullMQ handle retries
  }
}
