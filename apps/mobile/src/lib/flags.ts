// Master §5.3 puts Premium behind a feature flag. The flag has no service in this
// build, so it is a plain default plus an override the account screen can set —
// the point being that `premium: false` is the shipped state and no screen may
// infer that billing exists.

export interface Flags {
  premium: boolean;
  surpriseButton: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_FLAGS: Flags = { premium: false, surpriseButton: true, reducedMotion: false };

export function resolveFlags(override: Partial<Flags> | null): Flags {
  return { ...DEFAULT_FLAGS, ...(override ?? {}) };
}
