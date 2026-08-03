import { useEffect, useMemo, useState } from 'react';
import type { TodoItem } from '../types/app';
import { MAX_TODO_TITLE_LENGTH, storageService } from '../services/storage';
import { refreshReminders, TODO_REMINDER_OPEN_EVENT } from '../services/reminders';

interface TodoListProps {
  readonly onCountChange?: (count: number) => void;
  readonly onAutomationCountChange?: (count: number) => void;
}

interface CalendarAutomation {
  id: string;
  startDate: string;
  day: number;
  color: string;
  frequency: 'monthly' | 'yearly';
  name?: string;
}

const CALENDAR_AUTOMATIONS_KEY = 'calendar-automations-v1';
const WEEK_DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const monthFormatter = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const todoDateFormatter = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' });
const selectedDayFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todoDate(todo: TodoItem): string {
  return todo.dueDate ?? todo.createdAt.slice(0, 10);
}

function automationOccursOn(automation: CalendarAutomation, targetKey: string): boolean {
  if (targetKey < automation.startDate) return false;
  const start = new Date(`${automation.startDate}T12:00:00`);
  const target = new Date(`${targetKey}T12:00:00`);
  if (automation.frequency === 'yearly' && target.getMonth() !== start.getMonth()) return false;
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return target.getDate() === Math.min(automation.day, lastDay);
}

function loadCalendarAutomations(): CalendarAutomation[] {
  try {
    const stored = JSON.parse(localStorage.getItem(CALENDAR_AUTOMATIONS_KEY) ?? '[]') as CalendarAutomation[];
    return Array.isArray(stored)
      ? stored.map((automation) => ({ ...automation, frequency: automation.frequency ?? 'monthly' }))
      : [];
  } catch {
    return [];
  }
}

export function TodoList({ onCountChange, onAutomationCountChange }: TodoListProps) {
  const today = useMemo(() => new Date(), []);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [draft, setDraft] = useState('');
  const [draftDate, setDraftDate] = useState(dateKey(today));
  const [draftTime, setDraftTime] = useState('09:00');
  const [view, setView] = useState<'todos' | 'calendar'>('todos');
  const [monthCursor, setMonthCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(dateKey(today));
  const [calendarAutomations, setCalendarAutomations] = useState(loadCalendarAutomations);
  const [automationEditorOpen, setAutomationEditorOpen] = useState(false);
  const [automationColor, setAutomationColor] = useState('#ef4444');
  const [automationName, setAutomationName] = useState('');

  useEffect(() => {
    const loadTodos = async () => {
      const items = await storageService.getTodos();
      setTodos(items);
      onCountChange?.(items.length);
    };
    void loadTodos();
  }, [onCountChange]);

  useEffect(() => {
    onAutomationCountChange?.(calendarAutomations.length);
  }, [calendarAutomations.length, onAutomationCountChange]);

  useEffect(() => {
    const openReminder = (event: Event) => {
      const detail = (event as CustomEvent<{ dueDate?: string }>).detail;
      if (!detail?.dueDate) return;
      const date = new Date(`${detail.dueDate}T12:00:00`);
      setView('calendar');
      setSelectedDate(detail.dueDate);
      setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    };
    window.addEventListener(TODO_REMINDER_OPEN_EVENT, openReminder);
    return () => window.removeEventListener(TODO_REMINDER_OPEN_EVENT, openReminder);
  }, []);

  const handleAdd = async () => {
    const title = draft.trim();
    if (!title) return;

    const created = await storageService.addTodo(title, draftDate, draftTime);
    setTodos((current) => [created, ...current]);
    setDraft('');
    onCountChange?.(todos.length + 1);
    refreshReminders();
  };

  const handleToggle = async (todo: TodoItem) => {
    const updated = await storageService.toggleTodo(todo.id, !todo.completed);
    if (updated) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)));
    }
    refreshReminders();
  };

  const handleDelete = async (id: number) => {
    await storageService.deleteTodo(id);
    setTodos((current) => current.filter((item) => item.id !== id));
    onCountChange?.(todos.length - 1);
    refreshReminders();
  };

  const calendarDays = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const dayCount = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstDayOffset + 1;
      return day >= 1 && day <= dayCount ? new Date(year, month, day) : null;
    });
  }, [monthCursor]);

  const selectedTodos = todos.filter((todo) => todoDate(todo) === selectedDate);
  const selectedAutomations = calendarAutomations.filter((automation) =>
    automationOccursOn(automation, selectedDate),
  );
  const selectedMonthlyAutomation = selectedAutomations.find(
    (automation) => automation.frequency === 'monthly',
  );
  const selectedYearlyAutomation = selectedAutomations.find(
    (automation) => automation.frequency === 'yearly',
  );

  const saveCalendarAutomations = (automations: CalendarAutomation[]) => {
    setCalendarAutomations(automations);
    localStorage.setItem(CALENDAR_AUTOMATIONS_KEY, JSON.stringify(automations));
  };

  const handleAutomationSave = (frequency: CalendarAutomation['frequency']) => {
    const selectedDay = new Date(`${selectedDate}T12:00:00`).getDate();
    const existing = selectedAutomations.find((automation) => automation.frequency === frequency);
    const name = automationName.trim() || (frequency === 'monthly' ? 'Aylık Döngü' : 'Yıllık Döngü');
    if (existing) {
      saveCalendarAutomations(calendarAutomations.map((automation) =>
        automation.id === existing.id ? { ...automation, color: automationColor, name } : automation,
      ));
    } else {
      saveCalendarAutomations([
        ...calendarAutomations,
        {
          id: `${Date.now()}-${selectedDate}`,
          startDate: selectedDate,
          day: selectedDay,
          color: automationColor,
          frequency,
          name,
        },
      ]);
    }
    setAutomationEditorOpen(false);
  };

  const handleAutomationRemove = (frequency: CalendarAutomation['frequency']) => {
    const existing = selectedAutomations.find((automation) => automation.frequency === frequency);
    if (!existing) return;
    saveCalendarAutomations(calendarAutomations.filter(
      (automation) => automation.id !== existing.id,
    ));
    setAutomationEditorOpen(false);
  };

  const changeMonth = (offset: number) => {
    const next = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + offset, 1);
    setMonthCursor(next);
    setSelectedDate(dateKey(next));
  };

  return (
    <section className="min-h-[430px] rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <p className="hidden">Plan</p>
          <h2 className="text-[1.1rem] font-bold text-heading">
            {view === 'todos' ? 'Todo listesi' : 'Takvim'}
          </h2>
          <button
            type="button"
            className="cursor-pointer rounded-xl border border-theme-border bg-panel px-3 py-2 text-sm font-semibold text-heading transition-transform hover:-translate-y-px"
            onClick={() => setView((current) => (current === 'todos' ? 'calendar' : 'todos'))}
          >
            {view === 'todos' ? 'Takvim' : 'Todo listesi'}
          </button>
        </div>
      </div>

      {view === 'todos' ? (
        <>
          <div className="mb-3.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2.5">
            <input
              value={draft}
              maxLength={MAX_TODO_TITLE_LENGTH}
              className="w-full rounded-xl border border-theme-border bg-transparent px-3 py-2.5 text-heading outline-none focus:ring-2 focus:ring-theme-accent/30"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Yeni görev ekle"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAdd();
              }}
            />
            <button
              type="button"
              className="cursor-pointer rounded-xl border border-theme-accent bg-theme-accent px-4 py-2.5 font-semibold text-white shadow-[0_8px_20px_rgba(14,26,69,0.12)] transition-colors duration-150 hover:brightness-110"
              onClick={() => void handleAdd()}
            >
              Ekle
            </button>
            <div className="col-span-2 flex items-center gap-2.5">
              <input
                type="date"
                value={draftDate}
                aria-label="Görev tarihi"
                className="w-fit rounded-lg border border-theme-border bg-panel px-2 py-1.5 text-sm text-heading outline-none"
                onChange={(event) => setDraftDate(event.target.value)}
              />
              <input
                type="time"
                value={draftTime}
                aria-label="Hatırlatma saati"
                className="w-fit rounded-lg border border-theme-border bg-panel px-2 py-1.5 text-sm text-heading outline-none"
                onChange={(event) => setDraftTime(event.target.value)}
              />
            </div>
          </div>
          <ul className="m-0 flex max-h-[285px] list-none flex-col gap-2.5 overflow-y-auto p-0">
            {todos.map((todo) => (
              <li key={todo.id} className="flex items-center justify-between rounded-[14px] bg-panel px-3 py-2.5">
                <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => void handleToggle(todo)}
                  />
                  <span className={`truncate ${todo.completed ? 'opacity-65 line-through' : ''}`}>
                    {todo.title}
                  </span>
                </label>
                <div className="ml-2 flex shrink-0 items-center gap-2">
                  <time className="text-xs text-info" dateTime={todoDate(todo)}>
                    {todoDateFormatter.format(new Date(`${todoDate(todo)}T12:00:00`))}
                  </time>
                  <button
                    type="button"
                    className="cursor-pointer rounded-full border-0 bg-transparent px-2.5 py-1.5 font-semibold text-white transition-transform duration-150 hover:-translate-y-px"
                    onClick={() => void handleDelete(todo.id)}
                  >
                    Sil
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              className="grid size-9 cursor-pointer place-items-center rounded-xl bg-panel text-heading"
              aria-label="Önceki ay"
              onClick={() => changeMonth(-1)}
            >
              ‹
            </button>
            <strong className="text-heading capitalize">{monthFormatter.format(monthCursor)}</strong>
            <button
              type="button"
              className="grid size-9 cursor-pointer place-items-center rounded-xl bg-panel text-heading"
              aria-label="Sonraki ay"
              onClick={() => changeMonth(1)}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEK_DAYS.map((day) => (
              <span key={day} className="py-1 text-xs font-semibold text-info">{day}</span>
            ))}
            {calendarDays.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} className="h-12" />;
              const key = dateKey(day);
              const taskCount = todos.filter((todo) => todoDate(todo) === key).length;
              const dayAutomations = calendarAutomations.filter(
                (automation) => automationOccursOn(automation, key),
              );
              const yearlyAutomation = dayAutomations.find(
                (automation) => automation.frequency === 'yearly',
              );
              const monthlyAutomation = dayAutomations.find(
                (automation) => automation.frequency === 'monthly',
              );
              const displayAutomation = yearlyAutomation ?? monthlyAutomation;
              const isSelected = key === selectedDate;
              const isToday = key === dateKey(today);
              return (
                <button
                  key={key}
                  type="button"
                  className={`relative h-12 cursor-pointer rounded-xl text-sm transition-colors ${
                    isSelected
                      ? 'bg-theme-accent text-white'
                      : 'bg-panel text-heading hover:bg-theme-accent-bg'
                  } ${isToday ? 'ring-1 ring-white/70' : ''}`}
                  style={displayAutomation ? {
                    backgroundColor: isSelected ? displayAutomation.color : `${displayAutomation.color}24`,
                    boxShadow: yearlyAutomation
                      ? `inset 0 0 0 2px #d4af37${monthlyAutomation ? `, 0 0 0 2px ${monthlyAutomation.color}` : ''}`
                      : `inset 0 0 0 2px ${displayAutomation.color}`,
                    color: isSelected ? '#fff' : displayAutomation.color,
                    fontWeight: 700,
                  } : undefined}
                  onClick={() => {
                    setSelectedDate(key);
                    const automation = calendarAutomations.find((item) => automationOccursOn(item, key));
                    setAutomationColor(automation?.color ?? '#ef4444');
                    setAutomationName(automation?.name ?? '');
                    setAutomationEditorOpen(false);
                  }}
                >
                  <span className={displayAutomation ? 'relative -top-1' : ''}>{day.getDate()}</span>
                  {displayAutomation && (
                    <span
                      className="absolute right-1 bottom-1 left-1 truncate text-[0.58rem] leading-none"
                      title={displayAutomation.name}
                    >
                      {displayAutomation.name ?? (
                        displayAutomation.frequency === 'monthly' ? 'Aylık Döngü' : 'Yıllık Döngü'
                      )}
                    </span>
                  )}
                  {taskCount > 0 && (
                    <span className="absolute top-0.5 right-1 min-w-4 rounded-full bg-white px-1 text-[0.6rem] font-bold text-slate-900">
                      {taskCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t border-theme-border pt-3">
            <p className="mb-2 text-sm font-semibold text-heading">
              {selectedDayFormatter.format(new Date(`${selectedDate}T12:00:00`))}
            </p>
            {selectedTodos.length > 0 || selectedAutomations.length > 0 ? (
              <ul className="flex max-h-20 list-none flex-col gap-1 overflow-y-auto p-0">
                {selectedTodos.map((todo) => (
                  <li key={todo.id} className={`text-sm text-info ${todo.completed ? 'line-through opacity-60' : ''}`}>
                    • {todo.title}
                  </li>
                ))}
                {selectedAutomations.map((automation) => (
                  <li key={automation.id} className="flex items-center gap-2 text-sm text-info">
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${
                        automation.frequency === 'yearly' ? 'ring-2 ring-[#d4af37]' : ''
                      }`}
                      style={{ backgroundColor: automation.color }}
                    />
                    <span>{automation.name ?? (
                      automation.frequency === 'monthly' ? 'Aylık Döngü' : 'Yıllık Döngü'
                    )}</span>
                    <span className="text-[0.65rem] opacity-70">
                      {automation.frequency === 'monthly' ? 'Aylık' : 'Yıllık'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-info">Bu tarih için görev yok.</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="cursor-pointer rounded-lg border border-theme-border bg-panel px-3 py-2 text-sm font-semibold text-heading"
                onClick={() => {
                  setAutomationColor(
                    selectedMonthlyAutomation?.color ?? selectedYearlyAutomation?.color ?? '#ef4444',
                  );
                  setAutomationName(
                    selectedMonthlyAutomation?.name ?? selectedYearlyAutomation?.name ?? '',
                  );
                  setAutomationEditorOpen((current) => !current);
                }}
              >
                Otomasyon
              </button>
              {automationEditorOpen && (
                <>
                  <input
                    type="text"
                    value={automationName}
                    maxLength={80}
                    placeholder="Otomasyon Adı"
                    aria-label="Otomasyon Adı"
                    className="min-w-40 rounded-lg border border-theme-border bg-panel px-3 py-2 text-sm text-heading outline-none"
                    onChange={(event) => setAutomationName(event.target.value)}
                  />
                  <input
                    type="color"
                    value={automationColor}
                    aria-label="Otomasyon rengi"
                    className="size-9 cursor-pointer rounded-lg border border-theme-border bg-panel p-1"
                    onChange={(event) => setAutomationColor(event.target.value)}
                  />
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg bg-theme-accent px-3 py-2 text-sm font-semibold text-white"
                    onClick={() => handleAutomationSave('monthly')}
                  >
                    {selectedMonthlyAutomation ? 'Güncelle' : 'Aylık Döngü Oluştur'}
                  </button>
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg border-2 border-[#d4af37] bg-panel px-3 py-2 text-sm font-semibold text-heading"
                    onClick={() => handleAutomationSave('yearly')}
                  >
                    {selectedYearlyAutomation ? 'Yıllık Rengi Güncelle' : 'Yıllık Döngü Oluştur'}
                  </button>
                  {selectedMonthlyAutomation && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-lg border border-theme-border bg-panel px-3 py-2 text-sm font-semibold text-heading"
                      onClick={() => handleAutomationRemove('monthly')}
                    >
                      Aylık Döngüyü Kaldır
                    </button>
                  )}
                  {selectedYearlyAutomation && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-lg border border-[#d4af37] bg-panel px-3 py-2 text-sm font-semibold text-heading"
                      onClick={() => handleAutomationRemove('yearly')}
                    >
                      Yıllık Döngüyü Kaldır
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
