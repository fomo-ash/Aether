import { VerificationProvider, VerificationCondition, VerificationContext, EvidenceData } from '../../types';

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

export class TavilyProvider implements VerificationProvider {
  readonly name = 'tavily';

  canVerify(verifierType: string): boolean {
    return verifierType === 'web.search';
  }

  async verify(
    verifierType: string,
    condition: VerificationCondition,
    context: VerificationContext
  ): Promise<Partial<EvidenceData>> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY is not configured');
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: context.target,
          search_depth: 'advanced',
          include_answer: false,
          include_images: false,
          include_raw_content: false,
          max_results: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      
      const results = data.results.map((r: TavilySearchResult) => ({
        sourceUrl: r.url,
        title: r.title,
        content: r.content,
        confidence: r.score,
        publishedAt: r.published_date,
        sourceType: this.inferSourceType(r.url)
      }));

      return {
        source: this.name,
        observedState: results.length > 0 ? 'found_results' : 'no_results',
        externalIdentifier: context.target,
        payload: { results },
        metadata: {
          searchQuery: context.target,
          collectedAt: new Date().toISOString()
        }
      };

    } catch (error: any) {
      return {
        source: this.name,
        observedState: 'ERROR',
        payload: { error: error.message },
      };
    }
  }

  private inferSourceType(url: string): string {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('github.com') || lowerUrl.includes('twitter.com') || lowerUrl.includes('reddit.com')) {
      return 'social_or_platform';
    }
    if (lowerUrl.includes('reuters.com') || lowerUrl.includes('bloomberg.com') || lowerUrl.includes('apnews.com')) {
      return 'authoritative_news';
    }
    return 'general_web';
  }
}
