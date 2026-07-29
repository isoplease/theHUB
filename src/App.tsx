import { useEffect, useMemo, useState } from 'react';
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

function App() {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [todoCount, setTodoCount] = useState(0);
  const [automationCount, setAutomationCount] = useState(0);

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

  const title = useMemo(
    () => `Dashboard · ${todoCount} görev · ${automationCount} otomasyon`,
    [automationCount, todoCount],
  );

  return (
    <div className="min-h-screen [background:var(--custom-background,linear-gradient(135deg,var(--panel)_0%,var(--surface)_100%))] p-6 font-sans text-body antialiased scheme-light dark:scheme-dark">
      <header className="mb-6 flex items-center justify-between max-[900px]:items-start">
        <div>
          <p className="mb-1.5 text-[0.7rem] font-bold tracking-[0.24em] text-theme-accent uppercase">Personal workspace</p>
          <h1 className="text-[1.7rem] font-bold text-heading">{title}</h1>
        </div>
        <div className="flex items-center gap-3 max-[900px]:flex-col-reverse max-[900px]:items-end">
          <AppearanceSettings />
          <DateTimeDisplay />
          <button
            type="button"
            className="cursor-pointer rounded-full border-0 bg-theme-accent-bg px-3.5 py-2.5 font-semibold text-heading shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-transform duration-150 hover:-translate-y-px"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
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
