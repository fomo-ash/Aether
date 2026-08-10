import { CommClient } from 'caspian-sdk';
import { PrismaClient } from '@flowpilot/database';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const AETHER_API_URL = process.env.AETHER_API_URL || 'http://api:3250';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

async function bootstrap() {
  console.log(`[Caspian Ingress] Starting adapter...`);

  if (!process.env.CASPIAN_API_KEY) {
    console.warn(`[Caspian Ingress] WARNING: CASPIAN_API_KEY is missing. You will not be able to connect to real Caspian webhooks.`);
    // don't exit for local testing of the HTTP route
  }

  const client = new CommClient({
    apiKey: process.env.CASPIAN_API_KEY,
    baseUrl: process.env.CASPIAN_BASE_URL || 'https://api.trycaspianai.com'
  });

  client.onMessage(async (message: any) => {
    try {
      const receivedAt = Date.now();
      if (!message.text) {
        return;
      }

      console.log(`\n[Caspian Ingress] Received Command: "${message.text}"`);

      const externalUserId = (message.sender?.id || message.sender?.address || "unknown").toString();
      const platform = message.channel; // 'discord', 'email', etc.
      const externalCommunityId = message.connectionId;

      if (!externalCommunityId) {
        console.error(`[Caspian Ingress] Message lacks connectionId. Cannot map to Aether Community.`);
        return;
      }

      // 2. Resolve Community
      const community = await prisma.community.upsert({
        where: {
          platform_externalId: {
            platform,
            externalId: externalCommunityId
          }
        },
        update: {},
        create: {
          name: `Caspian ${platform} Community`,
          platform,
          externalId: externalCommunityId,
          githubInstallationId: null // explicitly null until configured
        }
      });

      // 3. Resolve User Identity
      let identity = await prisma.userIdentity.findUnique({
        where: {
          platform_externalId: {
            platform,
            externalId: externalUserId
          }
        },
        include: { user: true }
      });

      if (!identity) {
        console.log(`[Caspian Ingress] New identity observed (${platform}/${externalUserId}). Provisioning Aether User...`);
        try {
          const user = await prisma.user.create({
            data: { email: null }
          });
          identity = await prisma.userIdentity.create({
            data: {
              userId: user.id,
              platform,
              externalId: externalUserId
            },
            include: { user: true }
          });
        } catch (e: any) {
          if (e.code === 'P2002') {
             // Handled concurrent creation
             identity = await prisma.userIdentity.findUniqueOrThrow({
                where: { platform_externalId: { platform, externalId: externalUserId } },
                include: { user: true }
             });
          } else {
             throw e;
          }
        }
      }

      const userId = identity.userId;

      // Message Filtering
      const isCommand = message.text.startsWith('/aether commit');
      const pendingKey = `clarify:${community.id}:${userId}:${message.conversationId}`;
      const hasPending = await redis.exists(pendingKey);
      
      if (!isCommand && !hasPending) {
         console.log(`[Caspian Ingress] Message ignored (Not a command and no pending interaction).`);
         return;
      }

      // 4. Normalize and send to Aether API
      const payload = {
        platform,
        messageId: message.id,
        userId: userId,
        communityId: community.id,
        channel: platform,
        conversationId: message.conversationId,
        message: message.text,
        telemetry: {
          receivedAt
        }
      };

      console.log(`[Caspian Ingress] Forwarding normalized event to Aether API...`);

      const response = await fetch(`${AETHER_API_URL}/api/messages/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Caspian Ingress] Aether API returned ${response.status}: ${errorText}`);
        return;
      }

      console.log(`[Caspian Ingress] Successfully handed off to Aether message-queue.`);

    } catch (error: any) {
      console.error(`[Caspian Ingress] Error processing message: ${error.message}`);
    }
  });

  console.log(`[Caspian Ingress] Listening for events...`);
  await client.listen();
}

bootstrap().catch(console.error);
