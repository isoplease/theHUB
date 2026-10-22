import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Ekrandan yazı seçme katmanı (?view=grab): bölgeyi sürükleyerek seç, yazı panoya kopyalanır. Esc iptal eder. */
export function GrabView() {
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const done = useRef(false);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !done.current) {
        done.current = true;
        void invoke('grab_cancel');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rect = start && end
    ? { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
    : null;

  const finish = () => {
    if (done.current || !rect) return;
    done.current = true;
    if (rect.width < 6 || rect.height < 6) {
      void invoke('grab_cancel');
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    void invoke('grab_finish', {
      x: Math.round(rect.left * ratio),
      y: Math.round(rect.top * ratio),
      width: Math.round(rect.width * ratio),
      height: Math.round(rect.height * ratio),
    });
  };

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none bg-black/30 font-sans"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setStart({ x: event.clientX, y: event.clientY });
        setEnd({ x: event.clientX, y: event.clientY });
      }}
      onPointerMove={(event) => {
        if (start) setEnd({ x: event.clientX, y: event.clientY });
      }}
      onPointerUp={finish}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!done.current) {
          done.current = true;
          void invoke('grab_cancel');
        }
      }}
    >
      {!rect && (
        <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-white/20 bg-black/70 px-4 py-1.5 text-xs text-white backdrop-blur-md">
          Metni seçmek için sürükle · Esc iptal
        </div>
      )}
      {rect && (
        <div
          className="pointer-events-none absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, background: 'rgba(255,255,255,0.01)' }}
        />
      )}
    </div>
  );
}
