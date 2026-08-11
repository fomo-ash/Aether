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
  "proposedVerifier": "extracted verifier hint (e.g., github.issue_status) or null",
  "stake": "integer amount of reputation staked (extract naked numbers from follow-up context if provided), or null if not specified"
}

Return ONLY valid JSON. Do not include markdown formatting like \`\`\`json.
    `.trim();

    const userContent = contextMessage 
      ? `Previous Context: ${contextMessage}\n\nNew Message: ${message}`
      : `Message: ${message}`;

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
        temperature: 0,
        response_format: { type: "json_object" }
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
  }
}
