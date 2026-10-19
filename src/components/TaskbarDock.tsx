import type { ReactNode } from 'react';
import { useLanguage, type TranslationKey } from '../i18n';

export type DockTab = 'notes' | 'tasks' | 'dateTracker' | 'timeTools' | 'screenshot';

interface TaskbarDockProps {
  readonly active: DockTab | null;
  readonly onActiveChange: (tab: DockTab | null) => void;
  readonly onSwitchLayout: () => void;
  readonly onNextSize: () => void;
  readonly monitorCount: number;
  readonly onNextMonitor: () => void;
}

const ICON_PROPS = {
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
} as const;

export const ICONS: Record<DockTab | 'layout' | 'size' | 'monitor' | 'hide' | 'collapse', ReactNode> = {
  notes: (
    <svg {...ICON_PROPS}><path d="M5 4h10l4 4v12H5z" /><path d="M14 4v5h5M8 13h8M8 17h5" /></svg>
  ),
  tasks: (
    <svg {...ICON_PROPS}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></svg>
  ),
  dateTracker: (
    <svg {...ICON_PROPS}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
  ),
  timeTools: (
    <svg {...ICON_PROPS}><circle cx="12" cy="13" r="7" /><path d="M12 13V9M9.5 3h5M12 3v3" /></svg>
  ),
  screenshot: (
    <svg {...ICON_PROPS}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3" /></svg>
  ),
  layout: (
    <svg {...ICON_PROPS}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></svg>
  ),
  size: (
    <svg {...ICON_PROPS}><path d="M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7" /></svg>
  ),
  monitor: (
    <svg {...ICON_PROPS}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M9 20h6M12 16v4" /></svg>
  ),
  hide: (
    <svg {...ICON_PROPS}><path d="M6 6l12 12M18 6 6 18" /></svg>
  ),
  collapse: (
    <svg {...ICON_PROPS}><path d="m6 9 6 6 6-6" /></svg>
  ),
};

const TABS: readonly { id: DockTab; labelKey: TranslationKey }[] = [
  { id: 'notes', labelKey: 'note.title' },
  { id: 'tasks', labelKey: 'tasks.title' },
  { id: 'dateTracker', labelKey: 'dateTracker.title' },
  { id: 'timeTools', labelKey: 'taskbar.stopwatch' },
  { id: 'screenshot', labelKey: 'screenshot.title' },
];

export const BUTTON = 'grid h-9 min-w-9 cursor-pointer place-items-center rounded-xl border border-transparent bg-transparent px-2 text-heading transition-colors duration-150 hover:bg-panel focus-visible:outline-2 focus-visible:outline-theme-accent motion-reduce:transition-none';

export function TaskbarDock({ active, onActiveChange, onSwitchLayout, onNextSize, monitorCount, onNextMonitor }: TaskbarDockProps) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 flex items-end justify-end bg-transparent font-sans text-body antialiased">
      <nav
        className="mb-1 flex h-10 w-[304px] shrink-0 items-center gap-0 rounded-xl border border-theme-border bg-card/90 px-1 backdrop-blur-md shadow-[var(--shadow)]"
        aria-label="theHUB"
      >
        {TABS.map((tab) => {
          const label = t(tab.labelKey);
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`${BUTTON} ${selected ? 'border-theme-border bg-panel' : ''}`}
              aria-pressed={selected}
              aria-label={label}
              title={label}
              onClick={() => onActiveChange(selected ? null : tab.id)}
            >
              {ICONS[tab.id]}
            </button>
          );
        })}
        <span className="flex-1" />
        <button type="button" className={BUTTON} aria-label={t('size.next')} title={t('size.next')} onClick={onNextSize}>
          {ICONS.size}
        </button>
        {monitorCount > 1 && (
          <button type="button" className={BUTTON} aria-label={t('monitor.next')} title={t('monitor.next')} onClick={onNextMonitor}>
            {ICONS.monitor}
          </button>
        )}
        <button type="button" className={BUTTON} aria-label={t('layout.switch')} title={t('layout.switch')} onClick={onSwitchLayout}>
          {ICONS.layout}
        </button>
      </nav>
    </div>
  );
}
