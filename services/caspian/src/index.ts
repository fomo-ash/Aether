import { CommClient } from 'caspian-sdk';
import { PrismaClient } from '@flowpilot/database';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const AETHER_API_URL = process.env.AETHER_API_URL || 'http://api:3250';

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
      let community = await prisma.community.findUnique({
        where: {
          platform_externalId: {
            platform,
            externalId: externalCommunityId
          }
        }
      });

      if (!community) {
        console.log(`[Caspian Ingress] New community observed (${platform}/${externalCommunityId}). Provisioning Aether Community...`);
        community = await prisma.community.create({
          data: {
            name: `Caspian ${platform} Community`,
            platform,
            externalId: externalCommunityId,
            githubInstallationId: null // explicitly null until configured
          }
        });
      }

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

      let userId = identity?.userId;

      if (!identity) {
        console.log(`[Caspian Ingress] New identity observed (${platform}/${externalUserId}). Provisioning Aether User...`);
        const user = await prisma.user.create({
          data: { email: null } // Optional email per updated schema
        });

        identity = await prisma.userIdentity.create({
          data: {
            userId: user.id,
            platform,
            externalId: externalUserId
          },
          include: { user: true }
        });
        userId = user.id;
      }

      // 4. Normalize and send to Aether API
      const payload = {
        platform,
        messageId: message.id,
        userId: userId,
        communityId: community.id,
        channel: platform,
        conversationId: message.conversationId,
        message: message.text
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
