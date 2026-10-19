import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { DateTracker } from './DateTracker';
import { QuickNote } from './QuickNote';
import { ScreenshotTool } from './ScreenshotTool';
import { TimeTools } from './TimeTools';
import { TodoList } from './TodoList';
import type { DockTab } from './TaskbarDock';
import { useLanguage } from '../i18n';
import type { DateEventItem } from '../types/app';
import { storageService } from '../services/storage';

const DOCK_TABS: readonly DockTab[] = ['notes', 'tasks', 'dateTracker', 'timeTools', 'screenshot'];

function isDockTab(value: unknown): value is DockTab {
  return typeof value === 'string' && (DOCK_TABS as readonly string[]).includes(value);
}

/** Görev çubuğu şeridinden açılan, taşınabilir gadget penceresi (?view=panel). */
export function PanelView() {
  const { t } = useLanguage();
  const [active, setActive] = useState<DockTab>('tasks');
  const [dateEvents, setDateEvents] = useState<readonly DateEventItem[]>([]);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; frame: number | null } | null>(null);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('theme');
    document.documentElement.dataset.theme = storedTheme === 'light' ? 'light' : 'dark';
    void storageService.init();
  }, []);

  useEffect(() => {
    // Hatırlatıcılar ana pencerede çalışır; bu pencere yalnız kartları gösterir.
    const stop = listen<unknown>('dock-tab', (event) => {
      if (isDockTab(event.payload)) setActive(event.payload);
    });
    // Pencere ilk açılışta yeni oluşturulur; dinleyici hazır olunca bekleyen sekmeyi iste.
    void stop.then(() => invoke('panel_ready')).catch(() => undefined);
    return () => {
      void stop.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return undefined;
    let frame: number | null = null;
    const fit = () => {
      frame = null;
      void invoke('fit_panel', { height: element.offsetHeight }).catch(() => undefined);
    };
    const observer = new ResizeObserver(() => {
      if (frame === null) frame = window.requestAnimationFrame(fit);
    });
    observer.observe(element);
    fit();
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  const close = () => {
    void invoke('close_panel').catch(() => undefined);
    void emit('dock-closed');
  };

  return (
    <div className="fixed inset-0 flex flex-col justify-end overflow-y-auto bg-transparent font-sans text-body antialiased">
      <div ref={contentRef} className="flex flex-col gap-2">
        <div
          className="flex h-9 shrink-0 cursor-move select-none items-center justify-between rounded-xl border border-theme-border bg-card px-3 text-xs font-semibold text-info"
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target !== event.currentTarget) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.screenX, y: event.screenY, frame: null };
            void invoke('begin_panel_drag').catch(() => undefined);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.frame !== null) return;
            const { screenX, screenY } = event;
            drag.frame = window.requestAnimationFrame(() => {
              drag.frame = null;
              const ratio = window.devicePixelRatio || 1;
              void invoke('drag_panel', { dx: (screenX - drag.x) * ratio, dy: (screenY - drag.y) * ratio }).catch(() => undefined);
            });
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          title={t('window.moveTitle')}
        >
          <span className="pointer-events-none">{t('window.move')}</span>
          <button
            type="button"
            className="grid size-7 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-heading hover:bg-red-600 hover:text-white focus-visible:outline-2 focus-visible:outline-theme-accent"
            aria-label={t('window.hideToTray')}
            title={t('taskbar.collapse')}
            onClick={close}
          >
            ×
          </button>
        </div>
        {/* Kartlar bağlı kalır: kronometre ve yazılmakta olan not sekme değişince kaybolmaz. */}
        <div className={active === 'notes' ? 'block' : 'hidden'}><QuickNote /></div>
        <div className={active === 'tasks' ? 'block' : 'hidden'}>
          <TodoList onCountChange={() => undefined} onAutomationCountChange={() => undefined} dateEvents={dateEvents} />
        </div>
        <div className={active === 'dateTracker' ? 'block' : 'hidden'}><DateTracker onEventsChange={setDateEvents} /></div>
        <div className={active === 'timeTools' ? 'block' : 'hidden'}><TimeTools /></div>
        <div className={active === 'screenshot' ? 'block' : 'hidden'}><ScreenshotTool /></div>
      </div>
    </div>
  );
}
