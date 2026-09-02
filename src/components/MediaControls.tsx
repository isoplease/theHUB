import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLanguage } from '../i18n';

type MediaAction = 'previous' | 'toggle' | 'next';

interface MediaControlsProps {
  readonly dragHandle?: ReactNode;
}

interface MediaSessionSnapshot {
  supported: boolean;
  hasSession: boolean;
  title: string;
  artist: string;
  playing: boolean;
  canPrevious: boolean;
  canToggle: boolean;
  canNext: boolean;
}

interface MediaControlButtonsProps {
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

function PreviousIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="currentColor" d="M6 5h2v14H6V5Zm3 7 9-7v14l-9-7Z" />
    </svg>
  );
}

function PlayPauseIcon({ playing }: { readonly playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="currentColor" d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="currentColor" d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="currentColor" d="m6 5 9 7-9 7V5Zm10 0h2v14h-2V5Z" />
    </svg>
  );
}

function useMediaSession() {
  const [session, setSession] = useState<MediaSessionSnapshot>(EMPTY_SESSION);
  const [busy, setBusy] = useState<MediaAction | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setSession(EMPTY_SESSION);
      return;
    }
    try {
      setSession(await invoke<MediaSessionSnapshot>('get_media_session'));
    } catch {
      setSession({ ...EMPTY_SESSION, supported: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 2_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  const control = async (action: MediaAction) => {
    if (!isTauri() || busy) return;
    setBusy(action);
    try {
      await invoke<boolean>('control_media', { action });
      window.setTimeout(() => void refresh(), 180);
      window.setTimeout(() => void refresh(), 700);
    } finally {
      setBusy(null);
    }
  };

  return { session, busy, control };
}

function MediaControlButtons({ session, busy, control }: MediaControlButtonsProps) {
  const { t } = useLanguage();
  const buttonClass = 'grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-lg border border-theme-border bg-panel text-heading transition-colors hover:border-theme-accent hover:bg-theme-accent-bg disabled:cursor-default disabled:opacity-35';

  return (
    <div className="flex shrink-0 gap-1.5" role="group" aria-label={t('media.controls')}>
      <button type="button" className={buttonClass} disabled={!session.hasSession || !session.canPrevious || busy !== null} aria-label={t('media.previous')} title={t('media.previous')} onClick={() => void control('previous')}>
        <PreviousIcon />
      </button>
      <button type="button" className={buttonClass} disabled={!session.hasSession || !session.canToggle || busy !== null} aria-label={session.playing ? t('media.pause') : t('media.play')} title={session.playing ? t('media.pause') : t('media.play')} onClick={() => void control('toggle')}>
        <PlayPauseIcon playing={session.playing} />
      </button>
      <button type="button" className={buttonClass} disabled={!session.hasSession || !session.canNext || busy !== null} aria-label={t('media.next')} title={t('media.next')} onClick={() => void control('next')}>
        <NextIcon />
      </button>
    </div>
  );
}

export function FloatingMediaControls() {
  const { session, busy, control } = useMediaSession();

  return (
    <div className="flex h-full shrink-0 items-center border-r border-theme-border px-1.5">
      <MediaControlButtons session={session} busy={busy} control={control} />
    </div>
  );
}

export function MediaControls({ dragHandle }: MediaControlsProps) {
  const { t } = useLanguage();
  const { session, busy, control } = useMediaSession();
  const [scrolling, setScrolling] = useState(false);
  const mediaViewportRef = useRef<HTMLDivElement>(null);
  const mediaTextRef = useRef<HTMLSpanElement>(null);

  const title = session.hasSession
    ? session.title || t('media.unknownTitle')
    : session.supported ? t('media.noMedia') : t('media.unavailable');
  const mediaText = session.hasSession && session.artist
    ? `${title} · ${session.artist}`
    : title;
  useEffect(() => {
    const viewport = mediaViewportRef.current;
    const text = mediaTextRef.current;
    if (!viewport || !text) return;
    const measure = () => setScrolling(text.scrollWidth > viewport.clientWidth + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [mediaText]);

  return (
    <section className="self-start rounded-3xl border border-theme-border bg-card p-3 shadow-[var(--shadow)]" aria-label={t('media.controls')}>
      <div className="flex min-w-0 items-center gap-3">
        <MediaControlButtons session={session} busy={busy} control={control} />
        <div ref={mediaViewportRef} className="min-w-0 flex-1 overflow-hidden border-l border-theme-border pl-3 text-sm font-semibold text-heading" title={mediaText}>
          <div className={scrolling ? 'media-marquee-track' : 'w-max max-w-full'}>
            <span ref={mediaTextRef} className="block whitespace-nowrap">{mediaText}</span>
            {scrolling && (
              <span className="whitespace-nowrap" aria-hidden="true">{mediaText}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center border-l border-theme-border pl-2">
          {dragHandle}
        </div>
      </div>
    </section>
  );
}
