import { useEffect, useMemo, useState } from 'react';
import type { TodoHistoryItem, TodoItem } from '../types/app';
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
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  name?: string;
}

interface TodoHistoryViewItem {
  key: string;
  todo: TodoItem;
  status: 'Silindi' | 'Tarihi geçti' | 'Tamamlandı';
  timestamp: string;
  source: 'archive' | 'todo';
}

const CALENDAR_AUTOMATIONS_KEY = 'calendar-automations-v1';
const AUTOMATION_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const AUTOMATION_LABELS: Record<CalendarAutomation['frequency'], string> = {
  daily: 'Günlük',
  weekly: 'Haftalık',
  monthly: 'Aylık',
  yearly: 'Yıllık',
};
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

function todoTime(todo: TodoItem): string {
  return todo.reminderTime ?? new Date(todo.createdAt).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function todoDueTimestamp(todo: TodoItem): number | null {
  if (!todo.dueDate) return null;
  const timestamp = new Date(`${todo.dueDate}T${todo.reminderTime ?? '23:59'}:00`).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function automationOccursOn(automation: CalendarAutomation, targetKey: string): boolean {
  if (targetKey < automation.startDate) return false;
  const start = new Date(`${automation.startDate}T12:00:00`);
  const target = new Date(`${targetKey}T12:00:00`);
  const isStartMonth = target.getFullYear() === start.getFullYear()
    && target.getMonth() === start.getMonth();
  if ((automation.frequency === 'daily' || automation.frequency === 'weekly') && !isStartMonth) {
    return false;
  }
  if (automation.frequency === 'daily') return true;
  if (automation.frequency === 'weekly') {
    const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const targetDay = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    return Math.round((targetDay - startDay) / 86_400_000) % 7 === 0;
  }
  if (automation.frequency === 'yearly' && target.getMonth() !== start.getMonth()) return false;
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return target.getDate() === Math.min(automation.day, lastDay);
}

function automationDefaultName(frequency: CalendarAutomation['frequency']): string {
  return `${AUTOMATION_LABELS[frequency]} Döngü`;
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
  const [deletedTodos, setDeletedTodos] = useState<TodoHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const [automationFrequency, setAutomationFrequency] = useState<CalendarAutomation['frequency'] | null>(null);

  useEffect(() => {
    const loadTodos = async () => {
      const [items, historyItems] = await Promise.all([
        storageService.getTodos(),
        storageService.getTodoHistory(),
      ]);
      setTodos(items);
      setDeletedTodos(historyItems);
    };
    void loadTodos();
  }, []);

  useEffect(() => {
    onCountChange?.(todos.length);
  }, [todos.length, onCountChange]);

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
    refreshReminders();
  };

  const handleToggle = async (todo: TodoItem) => {
    const updated = await storageService.toggleTodo(todo.id, !todo.completed);
    if (updated) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)));
    }
    refreshReminders();
  };

  const handleDelete = async (todo: TodoItem) => {
    const archived = await storageService.deleteTodo(todo.id);
    if (!archived) return;
    setDeletedTodos((current) => [archived, ...current]);
    setTodos((current) => current.filter((item) => item.id !== todo.id));
    refreshReminders();
  };

  const historyItems: TodoHistoryViewItem[] = [
    ...deletedTodos.map((todo) => ({
      key: todo.archiveId,
      todo,
      status: 'Silindi' as const,
      timestamp: todo.archivedAt,
      source: 'archive' as const,
    })),
    ...todos.flatMap<TodoHistoryViewItem>((todo) => {
      const dueTimestamp = todoDueTimestamp(todo);
      if (todo.completed) {
        return [{
          key: `completed-${todo.id}`,
          todo,
          status: 'Tamamlandı' as const,
          timestamp: todo.completedAt ?? todo.createdAt,
          source: 'todo' as const,
        }];
      }
      return dueTimestamp !== null && dueTimestamp < Date.now()
        ? [{
            key: `expired-${todo.id}`,
            todo,
            status: 'Tarihi geçti' as const,
            timestamp: new Date(dueTimestamp).toISOString(),
            source: 'todo' as const,
          }]
        : [];
    }),
  ].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));

  const handleHistoryItemDelete = async (item: TodoHistoryViewItem) => {
    if (item.source === 'archive') {
      await storageService.deleteTodoHistoryItem(item.key);
      setDeletedTodos((current) => current.filter((todo) => todo.archiveId !== item.key));
      return;
    }

    await storageService.deleteTodoPermanently(item.todo.id);
    setTodos((current) => current.filter((todo) => todo.id !== item.todo.id));
    refreshReminders();
  };

  const handleHistoryClear = async () => {
    const todoIds = historyItems
      .filter((item) => item.source === 'todo')
      .map((item) => item.todo.id);
    await storageService.clearTodoHistory(todoIds);
    const todoIdSet = new Set(todoIds);
    setDeletedTodos([]);
    setTodos((current) => current.filter((todo) => !todoIdSet.has(todo.id)));
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
  const selectedDailyAutomation = selectedAutomations.find(
    (automation) => automation.frequency === 'daily',
  );
  const selectedWeeklyAutomation = selectedAutomations.find(
    (automation) => automation.frequency === 'weekly',
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
    const name = automationName.trim() || automationDefaultName(frequency);
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
    setAutomationFrequency(null);
  };

  const handleSelectedAutomationsRemove = () => {
    if (selectedAutomations.length === 0) return;
    const selectedIds = new Set(selectedAutomations.map((automation) => automation.id));
    saveCalendarAutomations(calendarAutomations.filter(
      (automation) => !selectedIds.has(automation.id),
    ));
    setAutomationEditorOpen(false);
    setAutomationFrequency(null);
  };

  const changeMonth = (offset: number) => {
    const next = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + offset, 1);
    setMonthCursor(next);
    setSelectedDate(dateKey(next));
  };

  return (
    <section className="relative min-h-[430px] rounded-3xl border border-theme-border bg-card p-5 pb-16 shadow-[var(--shadow)]">
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <p className="hidden">Plan</p>
          <h2 className="text-[1.1rem] font-bold text-heading">
            {view === 'todos' ? 'Görevler' : 'Takvim'}
          </h2>
          <button
            type="button"
            className="cursor-pointer rounded-xl border border-theme-border bg-panel px-3 py-2 text-sm font-semibold text-heading transition-transform hover:-translate-y-px"
            onClick={() => setView((current) => (current === 'todos' ? 'calendar' : 'todos'))}
          >
            {view === 'todos' ? 'Takvim' : 'Görevler'}
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
                className="w-fit cursor-pointer rounded-lg border border-theme-border bg-panel px-2 py-1.5 text-sm text-heading outline-none transition-all duration-150 hover:-translate-y-px hover:border-theme-accent hover:shadow-[0_0_0_3px_var(--accent-bg)] focus:border-theme-accent focus:ring-2 focus:ring-theme-accent/30"
                onChange={(event) => setDraftDate(event.target.value)}
                onClick={(event) => event.currentTarget.showPicker?.()}
              />
              <input
                type="time"
                value={draftTime}
                aria-label="Hatırlatma saati"
                className="w-fit cursor-pointer rounded-lg border border-theme-border bg-panel px-2 py-1.5 text-sm text-heading outline-none transition-all duration-150 hover:-translate-y-px hover:border-theme-accent hover:shadow-[0_0_0_3px_var(--accent-bg)] focus:border-theme-accent focus:ring-2 focus:ring-theme-accent/30"
                onChange={(event) => setDraftTime(event.target.value)}
                onClick={(event) => event.currentTarget.showPicker?.()}
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
                  <time className="text-xs text-info" dateTime={`${todoDate(todo)}T${todoTime(todo)}`}>
                    {todoDateFormatter.format(new Date(`${todoDate(todo)}T12:00:00`))} · {todoTime(todo)}
                  </time>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[0.68rem] font-semibold text-white transition-transform duration-150 hover:-translate-y-px"
                    aria-label={`Görevi sil: ${todo.title}`}
                    title="Görevi sil"
                    onClick={() => void handleDelete(todo)}
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
              const weeklyAutomation = dayAutomations.find(
                (automation) => automation.frequency === 'weekly',
              );
              const dailyAutomation = dayAutomations.find(
                (automation) => automation.frequency === 'daily',
              );
              const displayAutomation = yearlyAutomation
                ?? monthlyAutomation
                ?? weeklyAutomation
                ?? dailyAutomation;
              const automationLabel = dayAutomations
                .map((automation) => automation.name ?? automationDefaultName(automation.frequency))
                .join(' · ');
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
                    setAutomationFrequency(null);
                    setAutomationEditorOpen(false);
                  }}
                >
                  <span className={displayAutomation ? 'relative -top-1' : ''}>{day.getDate()}</span>
                  {displayAutomation && (
                    <span
                      className="absolute right-1 bottom-1 left-1 truncate text-[0.58rem] leading-none"
                      title={automationLabel}
                    >
                      {automationLabel}
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
                    <span>{automation.name ?? automationDefaultName(automation.frequency)}</span>
                    <span className="text-[0.65rem] opacity-70">
                      {AUTOMATION_LABELS[automation.frequency]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-info">Bu tarih için görev yok.</p>
            )}
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-lg border border-theme-border bg-panel px-3 py-2 text-sm font-semibold text-heading"
                  onClick={() => {
                    const selectedAutomation = selectedDailyAutomation
                      ?? selectedWeeklyAutomation
                      ?? selectedMonthlyAutomation
                      ?? selectedYearlyAutomation;
                    setAutomationColor(
                      selectedAutomation?.color ?? '#ef4444',
                    );
                    setAutomationName(
                      selectedAutomation?.name ?? '',
                    );
                    setAutomationFrequency(selectedAutomation?.frequency ?? null);
                    setAutomationEditorOpen((current) => !current);
                  }}
                >
                  Otomasyon
                </button>
                {selectedAutomations.length > 0 && (
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/20"
                    onClick={handleSelectedAutomationsRemove}
                  >
                    {selectedAutomations.length > 1 ? 'Otomasyonları Kaldır' : 'Otomasyonu Kaldır'}
                  </button>
                )}
              </div>
              {automationEditorOpen && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={automationName}
                      maxLength={80}
                      placeholder="Otomasyon Adı"
                      aria-label="Otomasyon Adı"
                      className="min-w-0 flex-1 rounded-lg border border-theme-border bg-panel px-3 py-2 text-sm text-heading outline-none"
                      onChange={(event) => setAutomationName(event.target.value)}
                    />
                    <input
                      type="color"
                      value={automationColor}
                      aria-label="Otomasyon rengi"
                      className="size-9 shrink-0 cursor-pointer rounded-lg border border-theme-border bg-panel p-1"
                      onChange={(event) => setAutomationColor(event.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {AUTOMATION_FREQUENCIES.map((frequency) => {
                      const existing = selectedAutomations.find(
                        (automation) => automation.frequency === frequency,
                      );
                      const isSelectedFrequency = automationFrequency === frequency;
                      return (
                        <button
                          key={frequency}
                          type="button"
                          aria-pressed={isSelectedFrequency}
                          className={`min-w-0 cursor-pointer rounded-lg px-1 py-2 text-xs font-semibold transition-colors ${
                            isSelectedFrequency
                              ? `bg-theme-accent text-white ${frequency === 'yearly' ? 'border-2 border-[#d4af37]' : 'border border-theme-accent'}`
                              : `${frequency === 'yearly' ? 'border-2 border-[#d4af37]' : 'border border-theme-border'} bg-panel text-heading`
                          }`}
                          title={`${AUTOMATION_LABELS[frequency]} döngüyü seç${existing ? ' (mevcut)' : ''}`}
                          onClick={() => setAutomationFrequency(frequency)}
                        >
                          {AUTOMATION_LABELS[frequency]}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={!automationFrequency}
                    className="w-full cursor-pointer rounded-lg bg-theme-accent px-3 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      if (automationFrequency) handleAutomationSave(automationFrequency);
                    }}
                  >
                    Otomasyonu Oluştur
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="absolute right-5 bottom-16 left-5 z-30 flex max-h-[310px] flex-col overflow-hidden rounded-2xl border border-theme-border bg-card p-3.5 shadow-[var(--shadow)]">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h3 className="font-bold text-heading">Görev geçmişi</h3>
            <div className="flex items-center gap-2">
              {historyItems.length > 0 && (
                <button
                  type="button"
                  className="cursor-pointer rounded-lg border border-red-400/50 bg-red-500/10 px-2 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/20"
                  onClick={() => void handleHistoryClear()}
                >
                  Tümünü Sil
                </button>
              )}
              <button
                type="button"
                className="grid size-7 cursor-pointer place-items-center rounded-lg bg-panel text-sm text-heading"
                aria-label="Görev geçmişini kapat"
                onClick={() => setHistoryOpen(false)}
              >
                ×
              </button>
            </div>
          </div>
          {historyItems.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-2 overflow-y-auto p-0 pr-1">
              {historyItems.map((item) => (
                <li key={item.key} className="rounded-xl bg-panel px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-sm text-heading">{item.todo.title}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${
                        item.status === 'Silindi'
                          ? 'bg-red-500/15 text-red-300'
                          : item.status === 'Tamamlandı'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300'
                      }`}>
                        {item.status}
                      </span>
                      <button
                        type="button"
                        className="cursor-pointer rounded-md border border-red-400/40 bg-red-500/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-red-200 transition-colors hover:bg-red-500/20"
                        aria-label={`Geçmişten kalıcı olarak sil: ${item.todo.title}`}
                        onClick={() => void handleHistoryItemDelete(item)}
                      >
                        Sil
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-info">
                    {todoDateFormatter.format(new Date(`${todoDate(item.todo)}T12:00:00`))} · {todoTime(item.todo)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-info">Silinen, tamamlanan veya tarihi geçmiş görev yok.</p>
          )}
        </div>
      )}

      <button
        type="button"
        className="absolute right-5 bottom-5 cursor-pointer rounded-xl border border-theme-border bg-panel px-3 py-2 text-xs font-semibold text-heading transition-transform hover:-translate-y-px"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen((current) => !current)}
      >
        Geçmiş{historyItems.length > 0 ? ` (${historyItems.length})` : ''}
      </button>
    </section>
  );
}
