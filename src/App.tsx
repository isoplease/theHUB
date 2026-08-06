import { lazy, Suspense, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './App.css';
import { AppearanceSettings } from './components/AppearanceSettings';
import { DateTimeDisplay } from './components/DateTimeDisplay';
import { QuickNote } from './components/QuickNote';
import { TimeTools } from './components/TimeTools';
import { TodoList } from './components/TodoList';
import { storageService } from './services/storage';
import { startReminderService } from './services/reminders';
import type { ThemeMode } from './types/app';
import appIcon from '../icons/khorne.png';
import { useLanguage } from './i18n';

const Calculator = lazy(() => import('./components/Calculator').then((module) => ({
  default: module.Calculator,
})));

const WINDOW_DECORATIONS_KEY = 'dashboard-window-decorations-v1';
const WORKSPACE_LABEL_KEY = 'dashboard-workspace-label-v1';
const WORKSPACE_LABEL_COLOR_KEY = 'dashboard-workspace-label-color-v1';

const FRAMELESS_RESIZE_HANDLES = [
  { direction: 'North', className: 'fixed top-0 right-3 left-3 z-[60] h-1.5 cursor-n-resize' },
  { direction: 'South', className: 'fixed right-3 bottom-0 left-3 z-[60] h-1.5 cursor-s-resize' },
  { direction: 'West', className: 'fixed top-3 bottom-3 left-0 z-[60] w-1.5 cursor-w-resize' },
  { direction: 'East', className: 'fixed top-3 right-0 bottom-3 z-[60] w-1.5 cursor-e-resize' },
  { direction: 'NorthWest', className: 'fixed top-0 left-0 z-[61] size-3 cursor-nw-resize' },
  { direction: 'NorthEast', className: 'fixed top-0 right-0 z-[61] size-3 cursor-ne-resize' },
  { direction: 'SouthWest', className: 'fixed bottom-0 left-0 z-[61] size-3 cursor-sw-resize' },
  { direction: 'SouthEast', className: 'fixed right-0 bottom-0 z-[61] size-3 cursor-se-resize' },
] as const;

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function App() {
  const { t } = useLanguage();
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [todoCount, setTodoCount] = useState(0);
  const [automationCount, setAutomationCount] = useState(0);
  const [windowDecorations, setWindowDecorations] = useState(
    () => window.localStorage.getItem(WINDOW_DECORATIONS_KEY) !== 'false',
  );
  const [workspaceLabel, setWorkspaceLabel] = useState(
    () => window.localStorage.getItem(WORKSPACE_LABEL_KEY) ?? 'Personal workspace',
  );
  const [workspaceLabelColor, setWorkspaceLabelColor] = useState(
    () => window.localStorage.getItem(WORKSPACE_LABEL_COLOR_KEY) ?? '#0e1a45',
  );

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('theme') as ThemeMode | null;
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setTheme(storedTheme);
    }
    void storageService.init();
    let stopReminders: (() => void) | undefined;
    void startReminderService().then((stop) => {
      stopReminders = stop;
    });
    return () => stopReminders?.();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(WINDOW_DECORATIONS_KEY, String(windowDecorations));
    if (isTauri()) {
      const appWindow = getCurrentWindow();
      void (async () => {
        await appWindow.setDecorations(windowDecorations);
        await appWindow.setShadow(windowDecorations);
        await appWindow.setResizable(true);
      })();
    }
  }, [windowDecorations]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_LABEL_KEY, workspaceLabel);
    window.localStorage.setItem(WORKSPACE_LABEL_COLOR_KEY, workspaceLabelColor);
  }, [workspaceLabel, workspaceLabelColor]);

  return (
    <div className={`min-h-screen [background:var(--custom-background,linear-gradient(135deg,var(--panel)_0%,var(--surface)_100%))] font-sans text-body antialiased scheme-light dark:scheme-dark ${
      windowDecorations ? 'p-6' : 'px-6 pt-16 pb-6'
    }`}>
      {!windowDecorations && (
        <>
          {FRAMELESS_RESIZE_HANDLES.map((handle) => (
            <div
              key={handle.direction}
              className={handle.className}
              aria-hidden="true"
              onMouseDown={(event) => {
                if (event.button !== 0 || !isTauri()) return;
                event.preventDefault();
                void getCurrentWindow().startResizeDragging(handle.direction);
              }}
            />
          ))}
          <div className="fixed top-2 right-2 z-50 flex h-10 overflow-hidden rounded-xl border border-theme-border bg-card shadow-[var(--shadow)]">
          <div className="pointer-events-none flex w-10 shrink-0 select-none items-center justify-center" aria-hidden="true">
            <img className="size-6 object-contain" src={appIcon} alt="" draggable={false} />
          </div>
          <div
            className="flex w-24 cursor-move select-none items-center justify-center border-l border-theme-border text-xs font-semibold text-info"
            title={t('window.moveTitle')}
            onMouseDown={(event) => {
              if (event.button === 0 && isTauri()) void getCurrentWindow().startDragging();
            }}
          >
            {t('window.move')}
          </div>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-panel"
            aria-label={t('window.minimize')}
            title={t('window.minimize')}
            onClick={() => {
              if (isTauri()) void getCurrentWindow().minimize();
            }}
          >
            —
          </button>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-panel"
            aria-label={t('window.maximize')}
            title={t('window.maximize')}
            onClick={() => {
              if (isTauri()) void getCurrentWindow().toggleMaximize();
            }}
          >
            □
          </button>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-red-600 hover:text-white"
            aria-label={t('window.hideToTray')}
            title={t('window.hideToTray')}
            onClick={() => {
              if (isTauri()) void getCurrentWindow().hide();
            }}
          >
            ×
          </button>
          </div>
        </>
      )}
      <header className="mb-6 flex items-center justify-between max-[900px]:items-start">
        <div>
          <p
            className="mb-1.5 text-[0.7rem] font-bold tracking-[0.24em] uppercase"
            style={{ color: workspaceLabelColor }}
          >
            {workspaceLabel || 'Personal workspace'}
          </p>
          <h1 className="text-[1.7rem] font-bold text-heading">{t('app.dashboard')}</h1>
          <div className="mt-1 flex flex-col text-[0.95rem] leading-6 font-medium text-info">
            <span>{t(todoCount === 1 ? 'app.taskCount' : 'app.tasksCount', { count: todoCount })}</span>
            <span>{t(automationCount === 1 ? 'app.automationCount' : 'app.automationsCount', { count: automationCount })}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="cursor-pointer rounded-full border-0 bg-theme-accent-bg px-3.5 py-2.5 font-semibold text-heading shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-transform duration-150 hover:-translate-y-px"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <AppearanceSettings
              theme={theme}
              windowDecorations={windowDecorations}
              onWindowDecorationsChange={setWindowDecorations}
              workspaceLabel={workspaceLabel}
              workspaceLabelColor={workspaceLabelColor}
              onWorkspaceLabelChange={setWorkspaceLabel}
              onWorkspaceLabelColorChange={setWorkspaceLabelColor}
            />
          </div>
          <DateTimeDisplay />
        </div>
      </header>

      <main className="grid grid-cols-2 items-start gap-5 max-[900px]:grid-cols-1">
        <TodoList
          onCountChange={setTodoCount}
          onAutomationCountChange={setAutomationCount}
        />
        <QuickNote />
        <Suspense fallback={(
          <section className="min-h-[430px] self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
            <h2 className="text-[1.1rem] font-bold text-heading">{t('calculator.title')}</h2>
            <p className="mt-2 text-sm text-info">{t('app.loading')}</p>
          </section>
        )}>
          <Calculator />
        </Suspense>
        <TimeTools />
      </main>
    </div>
  );
}

export default App;
