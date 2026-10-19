// Which server the app talks to is the one decision a developer changes most
// often (laptop, emulator, physical device), and it is a pure function — so the
// precedence is nailed down here rather than discovered on a device.

import { describe, expect, it } from 'vitest';

import { ANDROID_EMULATOR_HOST, SERVER_PORT, isHttpUrl, resolveBaseUrl } from './config';

describe('resolveBaseUrl', () => {
  it('lets the address saved in UI10 win over every guess', () => {
    expect(resolveBaseUrl({ override: 'https://engine.example.com', platform: 'android', devHost: '192.168.1.5:8081' })).toBe('https://engine.example.com');
  });

  it('trims the saved value and drops a trailing slash, so paths never double up', () => {
    expect(resolveBaseUrl({ override: '  http://127.0.0.1:3000/  ', platform: 'web', devHost: null })).toBe('http://127.0.0.1:3000');
    expect(resolveBaseUrl({ override: 'http://a.b///', platform: 'web', devHost: null })).toBe('http://a.b');
  });

  it('ignores an empty saved value instead of resolving to ""', () => {
    expect(resolveBaseUrl({ override: '   ', platform: 'ios', devHost: null })).toBe(`http://localhost:${SERVER_PORT}`);
  });

  it('uses the Metro host when the dev server runs on another machine', () => {
    expect(resolveBaseUrl({ platform: 'ios', devHost: '192.168.1.5:8081' })).toBe(`http://192.168.1.5:${SERVER_PORT}`);
    expect(resolveBaseUrl({ platform: 'android', devHost: '192.168.1.5' })).toBe(`http://192.168.1.5:${SERVER_PORT}`);
  });

  it('never sends the player to the dev server port', () => {
    expect(resolveBaseUrl({ platform: 'web', devHost: '10.1.2.3:19000' })).toBe(`http://10.1.2.3:${SERVER_PORT}`);
  });

  it('ignores a loopback dev host, which a device cannot reach', () => {
    expect(resolveBaseUrl({ platform: 'web', devHost: '127.0.0.1:8081' })).toBe(`http://localhost:${SERVER_PORT}`);
  });

  it('does not treat a localhost dev host as a reachable server address', () => {
    expect(resolveBaseUrl({ platform: 'android', devHost: 'localhost:8081' })).toBe(`http://${ANDROID_EMULATOR_HOST}:${SERVER_PORT}`);
  });

  it('falls back to the emulator gateway on Android and localhost elsewhere', () => {
    expect(resolveBaseUrl({ platform: 'android', devHost: null })).toBe(`http://${ANDROID_EMULATOR_HOST}:${SERVER_PORT}`);
    expect(resolveBaseUrl({ platform: 'ios', devHost: null })).toBe(`http://localhost:${SERVER_PORT}`);
    expect(resolveBaseUrl({ platform: 'web', devHost: null })).toBe(`http://localhost:${SERVER_PORT}`);
  });
});

describe('isHttpUrl', () => {
  it('accepts a server address and rejects everything else', () => {
    expect(isHttpUrl('http://10.0.2.2:3000')).toBe(true);
    expect(isHttpUrl('https://engine.example.com')).toBe(true);
    expect(isHttpUrl('ftp://engine.example.com')).toBe(false);
    expect(isHttpUrl('engine.example.com')).toBe(false);
    expect(isHttpUrl('http://')).toBe(false);
    expect(isHttpUrl('http://a b')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});
