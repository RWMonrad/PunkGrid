// Session state: who is signed in, which server that person is talking to, and
// the client that carries both. It is a plain subscribable store rather than a
// context tree, because the rules worth testing (token persistence, base-url
// precedence, sign-out clearing) have nothing to do with React. The platform
// storage binding is injected, so the same file runs under vitest with a memory
// store and on the device with SecureStore.

import { ApiClient } from './api';
import { resolveBaseUrl } from './config';
import { DEFAULT_FLAGS, type Flags } from './flags';

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const TOKEN = 'punkgrid.token';
const USER = 'punkgrid.userId';
const BASE = 'punkgrid.baseUrl';
const FLAGS = 'punkgrid.flags';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionSnapshot {
  status: SessionStatus;
  userId: string | null;
  hasToken: boolean;
  /** The saved override, or null when the guess is being used. */
  baseUrlOverride: string | null;
  baseUrl: string;
  flags: Flags;
  error: string | null;
}

export class Session {
  private snapshot: SessionSnapshot = {
    status: 'loading',
    userId: null,
    hasToken: false,
    baseUrlOverride: null,
    baseUrl: '',
    flags: DEFAULT_FLAGS,
    error: null,
  };

  private listeners = new Set<() => void>();
  private api: ApiClient | null = null;

  constructor(
    private readonly store: KvStore,
    private readonly env: { platform: 'android' | 'ios' | 'web' | 'other'; devHost: string | null },
  ) {}

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) fn();
  }

  client(): ApiClient {
    const baseUrl = this.snapshot.baseUrl;
    if (!this.api || baseUrlChanged(this.api, baseUrl)) {
      this.api = new ApiClient({ baseUrl, token: () => this.cachedToken });
    }
    return this.api;
  }

  private cachedToken: string | null = null;

  /** Called once at start-up, before the first screen renders. */
  async hydrate(): Promise<void> {
    const [token, userId, baseUrlOverride, flagsRaw] = await Promise.all([
      this.store.get(TOKEN),
      this.store.get(USER),
      this.store.get(BASE),
      this.store.get(FLAGS),
    ]);
    this.cachedToken = token;
    let flags = DEFAULT_FLAGS;
    if (flagsRaw) {
      try {
        flags = { ...DEFAULT_FLAGS, ...(JSON.parse(flagsRaw) as Partial<Flags>) };
      } catch {
        // A corrupt flag row is not worth failing start-up over.
      }
    }
    const baseUrl = resolveBaseUrl({ override: baseUrlOverride, ...this.env });
    this.set({
      status: token && userId ? 'signedIn' : 'signedOut',
      ...(userId ? { userId } : {}),
      hasToken: Boolean(token),
      baseUrlOverride,
      baseUrl,
      flags,
    });
  }

  /** Dev sign-in (ADR-016): the only identity the server accepts until a real
   *  AuthPort exists. The name has to be on the server's allowlist. */
  async signInDev(userId: string): Promise<{ ok: boolean; message?: string }> {
    const pending = new ApiClient({ baseUrl: this.snapshot.baseUrl, token: () => null });
    try {
      const res = await pending.devToken(userId);
      this.cachedToken = res.token;
      await Promise.all([this.store.set(TOKEN, res.token), this.store.set(USER, res.userId)]);
      this.api = null;
      this.set({ status: 'signedIn', userId: res.userId, hasToken: true, error: null });
      return { ok: true };
    } catch (e) {
      const message = describe(e);
      this.set({ error: message });
      return { ok: false, message };
    }
  }

  async signOut(): Promise<void> {
    this.cachedToken = null;
    await Promise.all([this.store.del(TOKEN), this.store.del(USER)]);
    this.api = null;
    this.set({ status: 'signedOut', userId: null, hasToken: false, error: null });
  }

  /** UI10's server address, which is how a physical device reaches a laptop. */
  async setBaseUrlOverride(value: string | null): Promise<void> {
    if (value) await this.store.set(BASE, value);
    else await this.store.del(BASE);
    const baseUrl = resolveBaseUrl({ override: value, ...this.env });
    this.api = null;
    this.set({ baseUrlOverride: value, baseUrl });
  }

  async setFlags(patch: Partial<Flags>): Promise<void> {
    const flags = { ...this.snapshot.flags, ...patch };
    await this.store.set(FLAGS, JSON.stringify(flags));
    this.set({ flags });
  }

  clearError(): void {
    this.set({ error: null });
  }
}

function baseUrlChanged(api: ApiClient, baseUrl: string): boolean {
  return api.baseUrl !== baseUrl;
}

export function describe(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
