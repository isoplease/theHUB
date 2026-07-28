import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { DateTimeDisplay } from './components/DateTimeDisplay';
import { ExchangeRates } from './components/ExchangeRates';
import { QuickNote } from './components/QuickNote';
import { TodoList } from './components/TodoList';
import { WeatherWidget } from './components/WeatherWidget';
import { storageService } from './services/storage';
import type { ThemeMode } from './types/app';

function App() {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [todoCount, setTodoCount] = useState(0);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('theme') as ThemeMode | null;
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setTheme(storedTheme);
    }
    void storageService.init();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  const title = useMemo(() => `Dashboard · ${todoCount} görev`, [todoCount]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Personal workspace</p>
          <h1>{title}</h1>
        </div>
        <div className="topbar-actions">
          <DateTimeDisplay />
          <button type="button" className="theme-toggle" onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <main className="dashboard-grid">
        <TodoList onCountChange={setTodoCount} />
        <QuickNote />
        <ExchangeRates />
        <WeatherWidget />
      </main>
    </div>
  );
}

export default App;
