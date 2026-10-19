// Start-up wiring: one Session per process, bound to the device's storage and
// the dev server's host, with the analytics sink attached before the first screen
// renders. Kept separate from the screens so a test can build the same object with
// a memory store and a stub fetch.

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { Session } from '../lib/session';
import { telemetry } from '../lib/telemetry';
import { deviceStore } from './storage';

/** Metro tells the app which host it came from; that address is how an emulator
 *  or a phone on the same Wi-Fi finds the developer's machine. */
function devHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.linkingUri;
  if (!hostUri) return null;
  const withoutScheme = hostUri.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? '';
  const host = withoutScheme.split(':')[0] ?? '';
  return host.length > 0 ? host : null;
}

const platform = Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web' ? Platform.OS : 'other';

export const session = new Session(deviceStore, { platform, devHost: devHost() });

if (__DEV__) {
  telemetry.attach((event) => {
    console.log(`[telemetry] ${event.name}`, JSON.stringify(event));
  });
}

void session.hydrate();
