import { ExtractionResult, ExtractionResultSchema } from '@aether/shared';

// For V1, we use fetch to call Featherless directly.
// In production, we might use the official OpenAI SDK configured with the Featherless base URL.
const FEATHERLESS_API_KEY = process.env.FEATHERLESS_API_KEY;
const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';
const MODEL = 'Qwen/Qwen2.5-72B-Instruct'; // Upgraded to a powerful 72B parameter model!

export class AIService {
  /**
   * Calls Featherless to extract structured intent and parameters from a raw message.
   */
  static async extractIntent(message: string, contextMessage?: string): Promise<ExtractionResult> {
    if (!FEATHERLESS_API_KEY) {
      throw new Error('FEATHERLESS_API_KEY is not set in the environment.');
    }

    const systemPrompt = `
You are Aether, a highly precise AI assistant that extracts commitments from user messages.
Your task is to analyze the user's message and output a strict JSON object.
The current UTC date and time is: ${new Date().toISOString()}.

Definitions:
- COMMITMENT: The user explicitly states they will do something specific by a certain time.
- BET: The user is challenging someone else or putting reputation on an outcome.
- NOT_COMMITMENT: General chatter, questions, or statements without a future pledge.
- AMBIGUOUS: The user might be making a commitment, but the intent is too vague to be sure.

Your JSON output MUST exactly match this structure:
{
  "intent": "COMMITMENT" | "NOT_COMMITMENT" | "BET" | "AMBIGUOUS",
  "targetReference": "extracted target or null. If resolving a missing issue/PR number from previous context, merge it with the original repository (e.g., 'owner/repo#123')",
  "deadline": "absolute ISO-8601 UTC timestamp (e.g. '2026-08-12T18:00:00Z') or null. If ambiguous, ask for clarification by returning AMBIGUOUS.",
  "proposedVerifier": "extracted verifier hint (e.g., github.issue, github.pull_request, github.deployment, github.commit_status, github.check_run, web.search) or null",
  "stake": "integer amount of reputation staked (extract naked numbers from follow-up context if provided), or null if not specified"
}

GitHub Targets Guide:
- Issue: owner/repo#123 -> github.issue
- Pull Request: owner/repo#123 -> github.pull_request (if they mention PR/merge)
- Deployment: owner/repo#environment (e.g. owner/repo#production) -> github.deployment
- Commit Status/Check: owner/repo@sha -> github.commit_status or github.check_run

Web Search Guide:
- Use web.search for factual claims or generic goals that don't map to GitHub (e.g., 'I will publish a blog post', 'The sun will shine').

Return ONLY valid JSON. Do not include markdown formatting like \`\`\`json.
    `.trim();

    const userContent = contextMessage 
      ? `Previous Context:\n${contextMessage}\n\nNew Message:\n${message}` 
      : `Message:\n${message}`;

    try {
      const response = await fetch(`${FEATHERLESS_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FEATHERLESS_API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          temperature: 0.1, // Low temperature for deterministic JSON output
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Featherless API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const rawContent = data.choices[0]?.message?.content;

      if (!rawContent) {
        throw new Error('Featherless returned an empty response.');
      }

      // Parse the JSON string from the LLM
      const parsedJson = JSON.parse(rawContent);

      // Validate structure with Zod
      const result = ExtractionResultSchema.parse(parsedJson);

      return result;
    } catch (error) {
      console.error('[AIService] Featherless extraction failed:', error);
      throw error;
    }
  }

  /**
   * Evaluates if a factual claim is supported or contradicted by the provided search evidence.
   */
  static async evaluateFactCheck(claim: string, evidenceText: string): Promise<'VERIFIED' | 'NOT_VERIFIED' | 'INSUFFICIENT_EVIDENCE'> {
    if (!FEATHERLESS_API_KEY) {
      throw new Error('FEATHERLESS_API_KEY is not set in the environment.');
    }

    const systemPrompt = `
You are Aether, an expert fact-checking AI. 
Your job is to evaluate a specific claim against a set of provided evidence sources.

You must output exactly one of the following three words and NOTHING ELSE:
VERIFIED
NOT_VERIFIED
INSUFFICIENT_EVIDENCE

Rules:
- Output VERIFIED if the evidence strongly and clearly SUPPORTS the claim.
- Output NOT_VERIFIED if the evidence strongly and clearly CONTRADICTS the claim (i.e., proves it false).
- Output INSUFFICIENT_EVIDENCE if the evidence is weak, conflicting, stale, unrelated, or does not provide enough information to definitively prove or disprove the claim.
- NEVER convert uncertainty into NOT_VERIFIED. If you are not absolutely sure, use INSUFFICIENT_EVIDENCE.
`.trim();

    const userContent = `Claim: "${claim}"\n\nEvidence:\n${evidenceText}`;

    try {
      const response = await fetch(`${FEATHERLESS_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FEATHERLESS_API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          temperature: 0.1,
          max_tokens: 10
        })
      });

      if (!response.ok) {
        throw new Error(`Featherless API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content.trim().toUpperCase();

      if (content.includes('VERIFIED') && !content.includes('NOT_VERIFIED')) return 'VERIFIED';
      if (content.includes('NOT_VERIFIED')) return 'NOT_VERIFIED';
      return 'INSUFFICIENT_EVIDENCE';
    } catch (error) {
      console.error('[AIService] Featherless fact check failed:', error);
      return 'INSUFFICIENT_EVIDENCE'; // Fail safe
    }
  }
}
