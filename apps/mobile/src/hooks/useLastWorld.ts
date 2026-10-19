// The world the player was last inside. The mockups' bottom bar has a LIFE STREAM
// tab that jumps straight back into the running life, and the honest version of
// that promise is the id of the world the app last opened — stored on the device
// in the same AsyncStorage the session uses, read once per mount, never guessed.
//
// Not a Session field: the session is the server's business (token, flags, base
// URL), and "which life was I living" is a device-local fact that survives
// sign-out, exactly like a browser's last-visited page.

import { useEffect, useState } from 'react';

import { deviceStore } from '../platform/storage';

const KEY = 'punkgrid.lastWorld';

/** Remembered whenever a world screen mounts. Fire-and-forget by design: the
 *  record is a convenience for the next launch, not a write any screen waits on. */
export async function rememberWorld(worldId: string): Promise<void> {
  await deviceStore.set(KEY, worldId);
}

/** The last world the player opened, or null before the storage read lands. A
 *  null answer is honest too — the LIFE STREAM tab then routes to the multiverse,
 *  where the lives that exist are listed. */
export function useLastWorld(): string | null {
  const [worldId, setWorldId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void deviceStore.get(KEY).then((v) => {
      if (alive) setWorldId(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return worldId;
}
