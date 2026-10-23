import Anthropic from '@anthropic-ai/sdk';
import { OUTPUT_SCHEMA } from './prompt';

export interface Completion { text: string; model: string; usage: { input: number; output: number } }
/** One model call: system prompt + user prompt in, JSON text out. Injected so tests never touch the network. */
export type Completer = (system: string, user: string) => Promise<Completion>;

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Error text that is safe to log: never includes headers, URLs or keys. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'authentication failed (check ANTHROPIC_API_KEY)';
  if (e instanceof Anthropic.RateLimitError) return 'rate limited by the Anthropic API';
  if (e instanceof Anthropic.BadRequestError) return `request rejected (${e.status})`;
  if (e instanceof Anthropic.APIConnectionError) return 'could not reach the Anthropic API';
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status ?? ''}`.trim();
  return e instanceof Error ? e.message.slice(0, 200) : 'unknown error';
}

/**
 * Calls Claude with structured outputs (JSON schema) so the reply is parseable, and with the server-side
 * `fallbacks: "default"` opt-in so a safety-classifier decline is retried on another model instead of failing.
 * Thinking is always on for this model; depth is controlled with effort. The credential comes from the
 * environment (ANTHROPIC_API_KEY in Actions) and is never read or logged here.
 */
export function anthropicCompleter(model: string = DEFAULT_MODEL, client: Anthropic = new Anthropic()): Completer {
  return async (system, user) => {
    const r = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
    });
    if (r.stop_reason === 'refusal') throw new Error(`the model declined this request${r.stop_details?.category ? ` (${r.stop_details.category})` : ''}`);
    if (r.stop_reason === 'max_tokens') throw new Error('the model ran out of output tokens');
    const text = r.content.filter((b): b is Extract<(typeof r.content)[number], { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
    if (!text.trim()) throw new Error('the model returned no text');
    return { text, model: r.model, usage: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
  };
}
