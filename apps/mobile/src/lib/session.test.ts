// Session rules that a device cannot be trusted for: what survives a restart,
// which address wins, and what sign-out actually clears. The store is injected
// (memory here, SecureStore on the device) and fetch is stubbed, so this runs in
// the root vitest worker with no Expo runtime.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Session, type KvStore } from './session';

class MemoryStore implements KvStore {
  map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
  async del(key: string) {
    this.map.delete(key);
  }
}

const android = { platform: 'android' as const, devHost: null };

type Recorded = { url: string; headers: Record<string, string> };

const last: Recorded = { url: '', headers: {} };

function stubFetch(record: Recorded, handler: (url: string) => { status: number; body: Record<string, unknown> }) {
  vi.stubGlobal(
    'fetch',
    async (url: string, init: RequestInit) => {
      Object.assign(record, { url, headers: init.headers as Record<string, string> });
      const res = handler(url);
      return new Response(JSON.stringify(res.body), { status: res.status });
    },
  );
}

beforeEach(() => {
  last.url = '';
  last.headers = {};
  stubFetch(last, () => ({ status: 200, body: {} }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Session.hydrate', () => {
  it('starts signed out and guesses the emulator address', async () => {
    const s = new Session(new MemoryStore(), android);
    await s.hydrate();
    const snap = s.getSnapshot();
    expect(snap.status).toBe('signedOut');
    expect(snap.hasToken).toBe(false);
    expect(snap.baseUrl).toBe('http://10.0.2.2:3000');
    expect(snap.baseUrlOverride).toBeNull();
  });

  it('comes back signed in after a restart, from stored token and user', async () => {
    const store = new MemoryStore();
    store.map.set('punkgrid.token', 'tok_saved');
    store.map.set('punkgrid.userId', 'user_demo');
    const s = new Session(store, android);
    await s.hydrate();
    expect(s.getSnapshot()).toMatchObject({ status: 'signedIn', userId: 'user_demo', hasToken: true });
  });

  it('treats a token without a user as signed out', async () => {
    const store = new MemoryStore();
    store.map.set('punkgrid.token', 'tok_orphan');
    const s = new Session(store, android);
    await s.hydrate();
    expect(s.getSnapshot().status).toBe('signedOut');
  });

  it('lets the saved server address beat the platform guess', async () => {
    const store = new MemoryStore();
    store.map.set('punkgrid.baseUrl', 'https://engine.example.com/');
    const s = new Session(store, android);
    await s.hydrate();
    expect(s.getSnapshot().baseUrl).toBe('https://engine.example.com');
    expect(s.getSnapshot().baseUrlOverride).toBe('https://engine.example.com/');
  });

  it('ignores a corrupt flag row instead of failing start-up', async () => {
    const store = new MemoryStore();
    store.map.set('punkgrid.flags', '{not json');
    const s = new Session(store, android);
    await s.hydrate();
    expect(s.getSnapshot().flags).toEqual({ premium: false, surpriseButton: true, reducedMotion: false });
  });

  it('merges a partial flag row over the defaults', async () => {
    const store = new MemoryStore();
    store.map.set('punkgrid.flags', JSON.stringify({ premium: true }));
    const s = new Session(store, android);
    await s.hydrate();
    expect(s.getSnapshot().flags).toEqual({ premium: true, surpriseButton: true, reducedMotion: false });
  });
});

describe('Session.signInDev', () => {
  it('stores the token the dev port returns and rebuilds the client', async () => {
    const store = new MemoryStore();
    const s = new Session(store, android);
    await s.hydrate();
    stubFetch(last, () => ({ status: 200, body: { requestId: 'r', userId: 'user_demo', token: 'tok_new' } }));
    const res = await s.signInDev('user_demo');
    expect(res).toEqual({ ok: true });
    expect(last.url).toBe('http://10.0.2.2:3000/dev/token');
    expect(store.map.get('punkgrid.token')).toBe('tok_new');
    expect(store.map.get('punkgrid.userId')).toBe('user_demo');
    expect(s.getSnapshot()).toMatchObject({ status: 'signedIn', userId: 'user_demo', error: null });

    const client = s.client();
    stubFetch(last, () => ({ status: 200, body: { items: [], nextCursor: null } }));
    await client.listWorlds();
    expect(last.headers.authorization).toBe('Bearer tok_new');
  });

  it('keeps the session signed out and surfaces the reason when the allowlist rejects', async () => {
    const store = new MemoryStore();
    const s = new Session(store, android);
    await s.hydrate();
    stubFetch(last, () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'user is not on the dev allowlist' } } }));
    const res = await s.signInDev('intruder');
    expect(res.ok).toBe(false);
    expect(res.message).toBe('user is not on the dev allowlist');
    expect(s.getSnapshot().status).toBe('signedOut');
    expect(s.getSnapshot().error).toBe('user is not on the dev allowlist');
    expect(store.map.has('punkgrid.token')).toBe(false);
  });

  it('clears the error once the player tries again successfully', async () => {
    const s = new Session(new MemoryStore(), android);
    await s.hydrate();
    stubFetch(last, () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'no dev port here' } } }));
    await s.signInDev('user_demo');
    expect(s.getSnapshot().error).toBe('no dev port here');
    stubFetch(last, () => ({ status: 200, body: { userId: 'user_demo', token: 't' } }));
    await s.signInDev('user_demo');
    expect(s.getSnapshot().error).toBeNull();
  });
});

describe('Session.signOut', () => {
  it('removes both credentials from storage and from the snapshot', async () => {
    const store = new MemoryStore();
    const s = new Session(store, android);
    await s.hydrate();
    stubFetch(last, () => ({ status: 200, body: { userId: 'user_demo', token: 'tok_new' } }));
    await s.signInDev('user_demo');
    await s.signOut();
    expect(store.map.has('punkgrid.token')).toBe(false);
    expect(store.map.has('punkgrid.userId')).toBe(false);
    expect(s.getSnapshot()).toMatchObject({ status: 'signedOut', userId: null, hasToken: false });

    stubFetch(last, () => ({ status: 200, body: { items: [], nextCursor: null } }));
    await s.client().listWorlds();
    expect(last.headers.authorization).toBeUndefined();
  });
});

describe('Session.setBaseUrlOverride', () => {
  it('rebuilds the client so the next request goes to the new server', async () => {
    const store = new MemoryStore();
    const s = new Session(store, android);
    await s.hydrate();
    const before = s.client();
    stubFetch(last, () => ({ status: 200, body: { items: [], nextCursor: null } }));
    await before.listWorlds();
    expect(last.url).toBe('http://10.0.2.2:3000/v1/worlds');

    await s.setBaseUrlOverride('http://192.168.1.9:3000');
    const after = s.client();
    expect(after).not.toBe(before);
    await after.listWorlds();
    expect(last.url).toBe('http://192.168.1.9:3000/v1/worlds');
    expect(store.map.get('punkgrid.baseUrl')).toBe('http://192.168.1.9:3000');

    await s.setBaseUrlOverride(null);
    expect(store.map.has('punkgrid.baseUrl')).toBe(false);
    expect(s.getSnapshot().baseUrl).toBe('http://10.0.2.2:3000');
  });
});

describe('Session listeners', () => {
  it('notifies subscribers on every state change and stops after unsubscribe', async () => {
    const s = new Session(new MemoryStore(), android);
    let hits = 0;
    const off = s.subscribe(() => (hits += 1));
    await s.hydrate();
    expect(hits).toBe(1);
    off();
    await s.setFlags({ premium: true });
    expect(hits).toBe(1);
    expect(s.getSnapshot().flags.premium).toBe(true);
  });
});
