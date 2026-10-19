// Where the Reality Engine lives. §11 is an HTTP API, so the app never imports
// `core` — it talks to a server, which is also how the emulator reaches a
// developer machine. The resolution rule is a pure function so the guesswork is
// testable without a device.

export const SERVER_PORT = 3000;

/** 10.0.2.2 is the host machine as seen from an Android emulator; a simulator and
 *  a plain Node run both reach the host on localhost. */
export const ANDROID_EMULATOR_HOST = '10.0.2.2';

export interface BaseUrlInputs {
  /** A value saved in UI10, which wins over every guess. */
  override?: string | null;
  platform: 'android' | 'ios' | 'web' | 'other';
  /** The Metro/dev server host, when the app knows it (Expo passes one). Either
   *  `host` or `host:port` — the dev server's own port is never the engine's. */
  devHost?: string | null;
}

export function resolveBaseUrl(inputs: BaseUrlInputs): string {
  const trimmed = inputs.override?.trim().replace(/\/+$/, '');
  if (trimmed) return trimmed;
  const host = inputs.devHost?.split(':')[0]?.trim();
  if (host && !/^localhost$|^127\./.test(host)) return `http://${host}:${SERVER_PORT}`;
  if (inputs.platform === 'android') return `http://${ANDROID_EMULATOR_HOST}:${SERVER_PORT}`;
  return `http://localhost:${SERVER_PORT}`;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/.test(value.trim());
}
