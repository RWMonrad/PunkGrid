// Binds the play controller to one screen instance. The controller owns the rules;
// this file only makes React re-render when its snapshot changes and disposes the
// in-flight poll when the screen goes away.

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { PlayController, type PlayState } from '../lib/play';
import { session, useSession } from './useApp';

export function usePlay(worldId: string): { state: PlayState; controller: PlayController } {
  useSession();
  const client = session.client();
  const controller = useMemo(() => new PlayController(client, worldId), [worldId, client]);

  useEffect(() => {
    void controller.load();
    return () => controller.dispose();
  }, [controller]);

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { state, controller };
}
