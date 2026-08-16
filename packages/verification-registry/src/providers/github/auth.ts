import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { VerificationContext } from '../../types';

export class GithubAuthFactory {
  static getOctokit(context: VerificationContext): Octokit {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyRaw = process.env.GITHUB_PRIVATE_KEY;

    if (!appId) {
      throw new Error('Configuration error: GITHUB_APP_ID is missing.');
    }

    if (!privateKeyRaw) {
      throw new Error('Configuration error: GITHUB_PRIVATE_KEY is missing.');
    }

    const githubInstallationId = context.config?.githubInstallationId;

    if (!githubInstallationId) {
      throw new Error('Configuration error: VerificationContext config is missing githubInstallationId.');
    }

    // Safely normalize private key: strip quotes first, then replace escaped newlines
    let privateKey = privateKeyRaw.trim();
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    } else if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, '\n').replace(/\\r/g, '');

    console.log(`[Github Auth] Using App Installation ID: ${githubInstallationId}`);

    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
        installationId: githubInstallationId,
      },
    });
  }
}
