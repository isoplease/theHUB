import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type MediaAction = 'previous' | 'toggle' | 'next';

export interface MediaSessionSnapshot {
  supported: boolean;
  hasSession: boolean;
  title: string;
  artist: string;
  playing: boolean;
  canPrevious: boolean;
  canToggle: boolean;
  canNext: boolean;
}

export interface MediaController {
  readonly session: MediaSessionSnapshot;
  readonly busy: MediaAction | null;
  readonly control: (action: MediaAction) => Promise<void>;
}

const EMPTY_SESSION: MediaSessionSnapshot = {
  supported: true,
  hasSession: false,
  title: '',
  artist: '',
  playing: false,
  canPrevious: false,
  canToggle: false,
  canNext: false,
};

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export function useMediaController(enabled: boolean, windowReady: boolean): MediaController {
  const [session, setSession] = useState<MediaSessionSnapshot>(EMPTY_SESSION);
  const [busy, setBusy] = useState<MediaAction | null>(null);
  const queryInFlightRef = useRef(false);
  const controlInFlightRef = useRef(false);
  const activeRef = useRef(false);
  const refreshTimersRef = useRef<number[]>([]);

  const refresh = useCallback(async () => {
    if (!enabled || !windowReady || !activeRef.current || queryInFlightRef.current
      || controlInFlightRef.current
      || document.visibilityState !== 'visible') return;
    if (!isTauri()) {
      setSession(EMPTY_SESSION);
      return;
    }
    queryInFlightRef.current = true;
    try {
      const allowed = await invoke<boolean>('should_poll_media');
      if (!allowed || !activeRef.current) return;
      const nextSession = await invoke<MediaSessionSnapshot>('get_media_session');
      if (activeRef.current) setSession(nextSession);
    } catch {
      if (activeRef.current) setSession({ ...EMPTY_SESSION, supported: false });
    } finally {
      queryInFlightRef.current = false;
    }
  }, [enabled, windowReady]);

  useEffect(() => {
    activeRef.current = enabled && windowReady;
    if (!activeRef.current) {
      setBusy(null);
      return undefined;
    }
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 2_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      activeRef.current = false;
      window.clearInterval(intervalId);
      refreshTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      refreshTimersRef.current = [];
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [enabled, refresh, windowReady]);

  const control = async (action: MediaAction) => {
    if (!isTauri() || !activeRef.current || controlInFlightRef.current || queryInFlightRef.current) return;
    controlInFlightRef.current = true;
    setBusy(action);
    try {
      await invoke<boolean>('control_media', { action });
      for (const delay of [180, 700]) {
        const timer = window.setTimeout(() => {
          refreshTimersRef.current = refreshTimersRef.current.filter((item) => item !== timer);
          void refresh();
        }, delay);
        refreshTimersRef.current.push(timer);
      }
    } finally {
      controlInFlightRef.current = false;
      setBusy(null);
    }
  };

  return { session, busy, control };
}
