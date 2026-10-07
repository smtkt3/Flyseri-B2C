import type { AppConfig } from '@flyseri/config';

export interface AiFunctionDeclaration { name: string; description: string; parameters: Record<string, unknown> }
export interface AiFunctionCall { name: string; args: Record<string, unknown> }
export interface AiGenerationInput { model: string; system: string; contents: Array<Record<string, unknown>>; tools: AiFunctionDeclaration[]; maxOutputTokens?: number }
export interface AiGenerationResult { text: string; calls: AiFunctionCall[]; modelContent?: Record<string, unknown>; inputTokens: number | null; outputTokens: number | null }
export interface AiProvider { readonly name: 'GEMINI'; generate(input: AiGenerationInput): Promise<AiGenerationResult> }

export class ProviderUnavailableError extends Error {}

export class GeminiProvider implements AiProvider {
  readonly name = 'GEMINI' as const;
  constructor(private readonly apiKey: string, private readonly timeoutMs: number, private readonly send: typeof fetch = fetch) {}

  async generate(input: AiGenerationInput): Promise<AiGenerationResult> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const request = () => this.send(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: input.system }] }, contents: input.contents,
        generationConfig: { maxOutputTokens: input.maxOutputTokens ?? 900, temperature: 0.3,
          ...(/^gemini-3(?:\.|-)/.test(input.model) && !/image|tts|robotics/.test(input.model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
        ...(input.tools.length ? { tools: [{ functionDeclarations: input.tools }] } : {}) }),
      signal,
    });
    let response = await request();
    // Retry only generation, before any returned tool call is executed. Never replay supplier writes.
    if ([429, 500, 502, 503, 504].includes(response.status)) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      const delay = Math.min(2000, Math.max(500, Number.isFinite(retryAfter) ? retryAfter * 1000 : 500));
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const aborted = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, delay);
        signal.addEventListener('abort', aborted, { once: true });
      });
      response = await request();
    }
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const body = await response.json() as GeminiResponse;
    const candidate = body.candidates?.[0];
    const content = candidate?.content;
    const parts = content?.parts ?? [];
    const text = parts.filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('\n').trim();
    const calls = parts.flatMap((part) => part.functionCall && typeof part.functionCall.name === 'string' ? [{
      name: part.functionCall.name, args: isRecord(part.functionCall.args) ? part.functionCall.args : {},
    }] : []);
    if (!text && !calls.length) throw new Error('AI provider returned an empty response');
    return { text, calls, ...(content ? { modelContent: content as unknown as Record<string, unknown> } : {}),
      inputTokens: safeTokenCount(body.usageMetadata?.promptTokenCount), outputTokens: safeTokenCount(body.usageMetadata?.candidatesTokenCount) };
  }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { role?: string; parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name?: string; args?: unknown } }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
function safeTokenCount(value: unknown): number | null { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function createAiProvider(config: AppConfig): AiProvider | undefined {
  if (config.AI_PRIMARY_PROVIDER === 'GEMINI' && config.GEMINI_API_KEY) return new GeminiProvider(config.GEMINI_API_KEY, config.AI_PROVIDER_TIMEOUT_MS);
  return undefined;
}
