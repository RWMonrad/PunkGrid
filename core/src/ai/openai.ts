// A real narrative provider over an OpenAI-compatible chat-completions endpoint
// (contract 10, ADR-008). The engine treats this class as it treats every
// provider: untrusted output that must pass validateNarrative before it is
// published, and a failure it retries and then covers with fallback copy.
//
// Two rules make that safe from the outside:
//   - `narrate` never throws. Transport trouble becomes `{ failure }`, so the
//     engine's retry budget and fallback path are the only failure handling.
//   - Only 429 and 5xx are retried here. A 4xx is a request we got wrong, and
//     repeating it spends money on the same answer.

import { buildMessages, narrativeResponseFormat, PROMPT_VERSION } from './prompt.js';
import type { NarrativeProvider, NarrativeRequest, NarrativeResponse } from '../narrative.js';

export interface GatewayOptions {
  /** Root of the API, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Per-request deadline. Default 20000 ms. */
  timeoutMs?: number;
  /** Extra HTTP attempts after the first one, for 429/5xx only. Default 1. */
  maxRetries?: number;
  temperature?: number;
  /** Cap on a `retry-after` wait. Default 5000 ms. */
  maxRetryDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const timer = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class OpenAiCompatibleProvider implements NarrativeProvider {
  readonly promptVersion = PROMPT_VERSION;
  /** Counts `narrate` calls, not HTTP attempts — the suite asserts on it. */
  calls = 0;

  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number;
  private readonly maxRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;

  constructor(opts: GatewayOptions) {
    this.url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxRetries = opts.maxRetries ?? 1;
    this.temperature = opts.temperature ?? 0.7;
    this.maxRetryDelayMs = opts.maxRetryDelayMs ?? 5_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? timer;
    this.log = opts.log ?? (() => {});
  }

  async narrate(req: NarrativeRequest): Promise<NarrativeResponse> {
    this.calls += 1;
    const body = JSON.stringify({
      model: this.model,
      messages: buildMessages(req),
      temperature: this.temperature,
      max_tokens: outputTokenCap(req.tokenBudget),
      response_format: narrativeResponseFormat(),
    });

    let failure: 'timeout' | 'error' = 'error';
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (res.status === 429 || res.status >= 500) {
          failure = 'error';
          if (attempt < this.maxRetries) {
            await this.sleep(retryDelayMs(res.headers.get('retry-after'), this.maxRetryDelayMs));
            continue;
          }
          return { failure, modelId: this.model };
        }
        if (!res.ok) {
          this.log(`gateway rejected the request with ${res.status}`);
          return { failure: 'error', modelId: this.model };
        }
        return this.readResponse(await res.text());
      } catch (error) {
        failure = isTimeout(error) ? 'timeout' : 'error';
        this.log(`gateway attempt ${attempt + 1} failed: ${String(error)}`);
      }
    }
    return { failure, modelId: this.model };
  }

  private readResponse(raw: string): NarrativeResponse {
    let envelope: GatewayReply;
    try {
      envelope = JSON.parse(raw) as GatewayReply;
    } catch {
      return { failure: 'error', modelId: this.model };
    }
    const modelId = envelope.model ?? this.model;
    const usage = envelope.usage;
    const meta = {
      modelId,
      ...(usage?.prompt_tokens === undefined ? {} : { inputTokens: usage.prompt_tokens }),
      ...(usage?.completion_tokens === undefined ? {} : { outputTokens: usage.completion_tokens }),
    };
    const content = envelope.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) return { failure: 'error', modelId };

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(content));
    } catch {
      // Prose that is not JSON is still untrusted output, so it goes to the
      // validator instead of being reported as a transport failure. It cannot
      // pass (no event references, no choice copy), which means the audit
      // records a schema rejection and the fallback publishes — and the rejected
      // text never reaches a reader.
      return { episode_text: content, content_flags: [], ...meta };
    }
    return { ...toNarrativeResponse(parsed), ...meta };
  }
}

interface GatewayReply {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toNarrativeResponse(value: unknown): NarrativeResponse {
  const obj = (value ?? {}) as Record<string, unknown>;
  const copy: Record<string, string> = {};
  for (const item of array(obj.choice_copy)) {
    const pair = (item ?? {}) as Record<string, unknown>;
    if (typeof pair.choice_id === 'string' && typeof pair.copy === 'string') copy[pair.choice_id] = pair.copy;
  }
  const refs = Array.isArray(obj.referenced_event_ids) ? obj.referenced_event_ids.filter(isString) : undefined;
  return {
    ...(typeof obj.episode_text === 'string' ? { episode_text: obj.episode_text } : {}),
    ...(refs ? { referenced_event_ids: refs } : {}),
    choice_copy_by_id: copy,
    ...(Array.isArray(obj.content_flags) ? { content_flags: obj.content_flags.filter(isString) } : {}),
  };
}

const isString = (v: unknown): v is string => typeof v === 'string';
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Section 10 hands the request a context budget, not a completion length. Half
 *  of it is kept for prose, clamped to what a chat endpoint will accept. */
export function outputTokenCap(tokenBudget: number): number {
  return Math.min(1024, Math.max(128, Math.floor(tokenBudget / 2)));
}

function retryDelayMs(header: string | null, cap: number): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(seconds * 1000, cap);
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name ?? '';
  return name === 'TimeoutError' || name === 'AbortError' || /timeout/i.test(String(error));
}

/** A gateway that ignores `response_format` and wraps the object in a fence. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fence?.[1] ?? trimmed;
}
