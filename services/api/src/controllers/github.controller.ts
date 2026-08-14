import { Request, Response } from 'express';
import { PrismaClient } from '@flowpilot/database';
import crypto from 'crypto';
import { App } from '@octokit/app';

const prisma = new PrismaClient();

// Note: Ensure GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET are in .env
const appId = process.env.GITHUB_APP_ID!;
const privateKeyRaw = process.env.GITHUB_PRIVATE_KEY!;
const clientId = process.env.GITHUB_CLIENT_ID!;
const clientSecret = process.env.GITHUB_CLIENT_SECRET!;

let privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, '\n') : '';
if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
  privateKey = privateKey.slice(1, -1);
} else if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
  privateKey = privateKey.slice(1, -1);
}

export class GithubController {
  /**
   * Generates a secure OAuth state and redirects to the GitHub App Setup URL.
   */
  static async startOAuthFlow(req: Request, res: Response) {
    try {
      const { userId, communityId, targetRepo, stateKey } = req.query;

      if (!userId || typeof userId !== 'string') {
        return res.status(400).send('Missing userId');
      }

      // Generate a cryptographically random, opaque token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      // 15 minute expiration
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await prisma.oauthState.create({
        data: {
          tokenHash,
          userId,
          communityId: typeof communityId === 'string' ? communityId : null,
          pendingCommitmentStateKey: typeof stateKey === 'string' ? stateKey : null,
          expiresAt,
        },
      });

      const appSlug = process.env.GITHUB_APP_SLUG || 'aether-agent'; // Should be provided
      const setupUrl = `https://github.com/apps/${appSlug}/installations/new?state=${rawToken}`;
      
      // Ideally redirect, but we can also just return the URL for the frontend
      return res.redirect(setupUrl);
    } catch (error) {
      console.error('[GithubController] Error starting OAuth flow:', error);
      return res.status(500).send('Internal Server Error');
    }
  }

  /**
   * Handles the OAuth callback from GitHub after installation.
   */
  static async oauthCallback(req: Request, res: Response) {
    try {
      const { code, installation_id, setup_action, state } = req.query;

      if (!state || typeof state !== 'string') {
        return res.status(400).send('Missing state parameter');
      }

      if (!code || typeof code !== 'string') {
        return res.status(400).send('Missing OAuth code');
      }

      if (setup_action === 'install' && (!installation_id || typeof installation_id !== 'string')) {
        return res.status(400).send('Missing installation_id');
      }

      // 1. Validate State
      const tokenHash = crypto.createHash('sha256').update(state).digest('hex');
      
      // Use transaction to ensure atomic consumption
      const oauthState = await prisma.$transaction(async (tx) => {
        const record = await tx.oauthState.findUnique({ where: { tokenHash } });
        
        if (!record) {
          throw new Error('Invalid state');
        }
        if (record.consumedAt) {
          throw new Error('State already consumed (Replay attack)');
        }
        if (record.expiresAt < new Date()) {
          throw new Error('State expired');
        }

        return tx.oauthState.update({
          where: { tokenHash },
          data: { consumedAt: new Date() },
        });
      });

      // 2. Exchange Code for User Access Token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const tokenData = await tokenResponse.json();
      const userAccessToken = tokenData.access_token;

      if (!userAccessToken) {
        return res.status(401).send('Failed to exchange OAuth code for access token');
      }

      // 3. Identify User
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${userAccessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      const githubUser = await userResponse.json();
      
      // Save the user's GitHub identity so we can map webhook events to them
      await prisma.userIdentity.upsert({
        where: {
          platform_externalId: {
            platform: 'github',
            externalId: githubUser.id.toString()
          }
        },
        update: { userId: oauthState.userId },
        create: {
          userId: oauthState.userId,
          platform: 'github',
          externalId: githubUser.id.toString()
        }
      });

      
      // 4. Retrieve Accessible Installations for this User
      const installationsResponse = await fetch('https://api.github.com/user/installations', {
        headers: {
          'Authorization': `token ${userAccessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      const installationsData = await installationsResponse.json();
      
      const requestedInstallationIdNum = parseInt(installation_id as string, 10);
      
      // 5. Validate Link: Check if the user is authorized for this installation
      const isAuthorized = installationsData.installations?.some(
        (inst: any) => inst.id === requestedInstallationIdNum
      );

      if (!isAuthorized && setup_action === 'install') {
        return res.status(403).send('Authenticated GitHub user does not have access to this installation');
      }

      // 6. Retrieve Metadata directly via App JWT to get the installation record safely
      const app = new App({ appId, privateKey });

      // Link ALL installations this user has access to, not just a newly installed one
      for (const inst of installationsData.installations || []) {
        const currentInstallationId = inst.id;

        try {
          const { data: installationData } = await app.octokit.request('GET /app/installations/{installation_id}', {
            installation_id: currentInstallationId,
          });

          const accountLogin = (installationData as any).account?.login || 'unknown';
          const accountType = (installationData as any).account?.type || 'unknown';
          const githubAccountId = (installationData as any).account?.id || 0;

          // Upsert Installation Record
          const githubInstallation = await prisma.githubInstallation.upsert({
            where: { installationId: currentInstallationId.toString() },
            update: {
              accountLogin,
              accountType,
              githubAccountId: BigInt(githubAccountId),
            },
            create: {
              installationId: currentInstallationId.toString(),
              accountLogin,
              accountType,
              githubAccountId: BigInt(githubAccountId),
            },
          });

          // Link to User
          await prisma.userGithubInstallation.upsert({
            where: {
              userId_githubInstallationId: {
                userId: oauthState.userId,
                githubInstallationId: githubInstallation.id,
              },
            },
            update: {},
            create: {
              userId: oauthState.userId,
              githubInstallationId: githubInstallation.id,
            },
          });

          // Link to Community (if applicable)
          if (oauthState.communityId) {
            await prisma.communityGithubInstallation.upsert({
              where: {
                communityId_githubInstallationId: {
                  communityId: oauthState.communityId,
                  githubInstallationId: githubInstallation.id,
                },
              },
              update: {},
              create: {
                communityId: oauthState.communityId,
                githubInstallationId: githubInstallation.id,
              },
            });
          }
        } catch (e) {
          console.error(`[GithubController] Failed to sync installation ${currentInstallationId}`, e);
        }
      }

      // 7. Conversational Resume (Trigger Worker Job)
      if (oauthState.pendingCommitmentStateKey) {
        // Enqueue a bullmq job to resume the conversation
        // The worker will read the stateKey, see if it has missing requirements, and re-process
        const { Queue } = require('bullmq');
        const IORedis = require('ioredis');
        const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
        const messageQueue = new Queue('message-queue', { connection });
        
        await messageQueue.add('resume-commitment', {
          stateKey: oauthState.pendingCommitmentStateKey,
          communityId: oauthState.communityId,
          userId: oauthState.userId,
        });
      }

      // Output Success
      return res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f3f4f6;">
            <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
              <h1 style="color: #10b981; font-size: 24px; margin-bottom: 16px;">✅ GitHub Connected Successfully!</h1>
              <p style="color: #4b5563;">Aether has been securely linked to your account.</p>
              <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">You can close this window and return to Discord.</p>
            </div>
          </body>
        </html>
      `);

    } catch (error: any) {
      console.error('[GithubController] OAuth Callback Error:', error);
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #fef2f2;">
            <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
              <h1 style="color: #ef4444; font-size: 24px; margin-bottom: 16px;">❌ Connection Failed</h1>
              <p style="color: #7f1d1d;">${error.message}</p>
            </div>
          </body>
        </html>
      `);
    }
  }
}
