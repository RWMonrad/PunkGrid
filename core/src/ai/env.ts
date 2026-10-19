// One place reads the gateway out of the environment, so no start script ever
// handles a key and no process can begin paid provider calls by accident.
// Without all three variables the run keeps using the deterministic fake
// provider, which is what the whole test suite exercises.
//
//   PUNKGRID_AI_BASE_URL   e.g. https://api.openai.com/v1
//   PUNKGRID_AI_API_KEY    the gateway key — environment only, never committed
//   PUNKGRID_AI_MODEL      model id to request
//   PUNKGRID_AI_TIMEOUT_MS optional per-request deadline, default 20000

import { CompliantProvider } from '../providers.js';
import type { NarrativeProvider } from '../narrative.js';
import { OpenAiCompatibleProvider } from './openai.js';

export interface AiWiring {
  provider: NarrativeProvider;
  /** One line for the start-up log: which narration the process will actually run. */
  description: string;
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): AiWiring {
  const baseUrl = env.PUNKGRID_AI_BASE_URL;
  const apiKey = env.PUNKGRID_AI_API_KEY;
  const model = env.PUNKGRID_AI_MODEL;
  const missing = [
    ...(baseUrl ? [] : ['PUNKGRID_AI_BASE_URL']),
    ...(apiKey ? [] : ['PUNKGRID_AI_API_KEY']),
    ...(model ? [] : ['PUNKGRID_AI_MODEL']),
  ];
  if (!baseUrl || !apiKey || !model) {
    return {
      provider: new CompliantProvider(),
      description: `deterministic fake provider (${missing.join(', ')} not set — no gateway calls, no spend)`,
    };
  }
  const timeout = Number(env.PUNKGRID_AI_TIMEOUT_MS ?? NaN);
  return {
    provider: new OpenAiCompatibleProvider({
      baseUrl,
      apiKey,
      model,
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
    }),
    description: `${model} via ${baseUrl}`,
  };
}
