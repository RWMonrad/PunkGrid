// The React bindings for the two things every screen needs: the session snapshot,
// and the user's accessibility settings. Motion and screen-reader state are read
// from the platform rather than guessed, because §5.5 promises full reduced-motion
// support and NFR-07 promises a working screen-reader path.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import type { SessionSnapshot } from '../lib/session';
import { session } from '../platform/bootstrap';

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

export { session };

function useFlag(read: () => Promise<boolean>, listen: (cb: (v: boolean) => void) => () => void): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    let alive = true;
    void read().then((v) => {
      if (alive) setValue(v);
    });
    const unsubscribe = listen((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [read, listen]);
  return value;
}

/** AccessibilityInfo's listeners hand back a subscription object, so unsubscribing
 *  is `sub.remove()` rather than calling the returned value. */
function onAccessibilityEvent(event: 'reduceMotionChanged' | 'screenReaderChanged', cb: (v: boolean) => void): () => void {
  const subscription = AccessibilityInfo.addEventListener(event, cb);
  return () => subscription.remove();
}

/** The platform's answer, and the app's own switch, ORed.
 *
 *  Measured 2026-10-12: UI10's «Reduced motion» row wrote `session.flags.reducedMotion`
 *  (`app/account.tsx:114-115`) and nothing in the app read it back — every animated
 *  element asked `AccessibilityInfo` alone, so the switch announced "On — animations
 *  replaced by static bars" while the bars kept spinning. The row's own hint says the
 *  switch covers devices that expose no setting, and Android devices without one are
 *  exactly where an in-app promise has to be kept. */
export function useReduceMotion(): boolean {
  const platform = useFlag(
    () => AccessibilityInfo.isReduceMotionEnabled(),
    (cb) => onAccessibilityEvent('reduceMotionChanged', cb),
  );
  // Read before the `||`: short-circuiting past a hook would make the hook count
  // depend on the device setting, and React stops rendering when it does.
  const snap = useSession();
  return platform || snap.flags.reducedMotion;
}

/** Android has no VoiceOver, so the reader query is spelled differently per
 *  platform — both answers mean "a reader is speaking the screen". */
export function useScreenReader(): boolean {
  return useFlag(
    () =>
      Platform.OS === 'android'
        ? AccessibilityInfo.isAccessibilityServiceEnabled()
        : AccessibilityInfo.isScreenReaderEnabled(),
    (cb) => onAccessibilityEvent('screenReaderChanged', cb),
  );
}
