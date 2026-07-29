import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './App.css';
import { AppearanceSettings } from './components/AppearanceSettings';
import { DateTimeDisplay } from './components/DateTimeDisplay';
import { ExchangeRates } from './components/ExchangeRates';
import { QuickNote } from './components/QuickNote';
import { TodoList } from './components/TodoList';
import { WeatherWidget } from './components/WeatherWidget';
import { storageService } from './services/storage';
import { startReminderService } from './services/reminders';
import type { ThemeMode } from './types/app';

const WINDOW_DECORATIONS_KEY = 'dashboard-window-decorations-v1';
const WORKSPACE_LABEL_KEY = 'dashboard-workspace-label-v1';
const WORKSPACE_LABEL_COLOR_KEY = 'dashboard-workspace-label-color-v1';

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function App() {
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
      void getCurrentWindow().setDecorations(windowDecorations);
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
        <div className="fixed top-2 right-2 z-50 flex h-10 overflow-hidden rounded-xl border border-theme-border bg-card shadow-[var(--shadow)]">
          <div
            className="flex w-24 cursor-move select-none items-center justify-center text-xs font-semibold text-info"
            title="Pencereyi taşı"
            onMouseDown={(event) => {
              if (event.button === 0 && isTauri()) void getCurrentWindow().startDragging();
            }}
          >
            Taşı
          </div>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-panel"
            aria-label="Küçült"
            title="Küçült"
            onClick={() => {
              if (isTauri()) void getCurrentWindow().minimize();
            }}
          >
            —
          </button>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-panel"
            aria-label="Büyüt veya geri al"
            title="Büyüt veya geri al"
            onClick={() => {
              if (isTauri()) void getCurrentWindow().toggleMaximize();
            }}
          >
            □
          </button>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-red-600 hover:text-white"
            aria-label="System Tray'e gizle"
            title="System Tray'e gizle"
            onClick={() => {
              if (isTauri()) void getCurrentWindow().hide();
            }}
          >
            ×
          </button>
        </div>
      )}
      <header className="mb-6 flex items-center justify-between max-[900px]:items-start">
        <div>
          <p
            className="mb-1.5 text-[0.7rem] font-bold tracking-[0.24em] uppercase"
            style={{ color: workspaceLabelColor }}
          >
            {workspaceLabel || 'Personal workspace'}
          </p>
          <h1 className="text-[1.7rem] font-bold text-heading">Dashboard</h1>
          <div className="mt-1 flex flex-col text-[0.95rem] leading-6 font-medium text-info">
            <span>{todoCount} görev</span>
            <span>{automationCount} otomasyon</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DateTimeDisplay />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="cursor-pointer rounded-full border-0 bg-theme-accent-bg px-3.5 py-2.5 font-semibold text-heading shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-transform duration-150 hover:-translate-y-px"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <AppearanceSettings
              windowDecorations={windowDecorations}
              onWindowDecorationsChange={setWindowDecorations}
              workspaceLabel={workspaceLabel}
              workspaceLabelColor={workspaceLabelColor}
              onWorkspaceLabelChange={setWorkspaceLabel}
              onWorkspaceLabelColorChange={setWorkspaceLabelColor}
            />
          </div>
        </div>
      </header>

      <main className="grid grid-cols-2 gap-5 max-[900px]:grid-cols-1">
        <TodoList
          onCountChange={setTodoCount}
          onAutomationCountChange={setAutomationCount}
        />
        <QuickNote />
        <ExchangeRates />
        <WeatherWidget />
      </main>
    </div>
  );
}

export default App;
