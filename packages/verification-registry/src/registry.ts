import { VerificationProvider } from './types';
import { GithubProvider } from './providers/github/github.provider';
import { TavilyProvider } from './providers/search/tavily.provider';

export class VerificationRegistry {
  private static providers: VerificationProvider[] = [];

  static register(provider: VerificationProvider) {
    this.providers.push(provider);
  }

  static getProvider(verifierType: string): VerificationProvider {
    const provider = this.providers.find(p => p.canVerify(verifierType));
    if (!provider) {
      throw new Error(`No provider found capable of verifying: ${verifierType}`);
    }
    return provider;
  }
}

// Register default providers
VerificationRegistry.register(new GithubProvider());
VerificationRegistry.register(new TavilyProvider());
