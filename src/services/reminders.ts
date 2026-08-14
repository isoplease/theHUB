import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
  type Options,
} from '@tauri-apps/plugin-notification';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { TodoItem } from '../types/app';
import { storageService } from './storage';
import { translateStored } from '../i18n';
import { getUpcomingMinuteReminder } from './reminderSchedule';

const HISTORY_KEY = 'todo-reminder-history-v1';
const DAY_MS = 86_400_000;
const MILESTONES = new Set([30, 21, 14, 7, 3, 2, 1]);

export const TODO_REMINDER_OPEN_EVENT = 'todo-reminder-open';
export const TODO_REMINDER_BALLOON_EVENT = 'todo-reminder-balloon';

export interface TodoReminderBalloonDetail {
  id: string;
  title: string;
  task: string;
  dueDate: string;
}

type ReminderHistory = Record<string, string>;

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readHistory(): ReminderHistory {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as ReminderHistory;
  } catch {
    return {};
  }
}

async function openTodoFromNotification(options: Options): Promise<void> {
  const dueDate = options.extra?.dueDate;
  const todoId = options.extra?.todoId;
  if (typeof dueDate !== 'string') return;
  window.dispatchEvent(new CustomEvent(TODO_REMINDER_OPEN_EVENT, {
    detail: { dueDate, todoId: typeof todoId === 'number' ? todoId : undefined },
  }));
  const appWindow = getCurrentWindow();
  await appWindow.show();
  await appWindow.unminimize();
  await appWindow.setFocus();
}

function notificationText(todo: TodoItem, daysUntil: number): { title: string; body: string } {
  if (daysUntil < 0) {
    return {
      title: translateStored('reminder.overdueTitle'),
      body: translateStored(
        Math.abs(daysUntil) === 1 ? 'reminder.overdueBodyOne' : 'reminder.overdueBody',
        { name: todo.title, days: Math.abs(daysUntil) },
      ),
    };
  }
  if (daysUntil === 0) {
    return {
      title: translateStored('reminder.todayTitle'),
      body: translateStored('reminder.todayBody', { name: todo.title }),
    };
  }
  return {
    title: translateStored('reminder.upcomingTitle'),
    body: translateStored(daysUntil === 1 ? 'reminder.upcomingBodyOne' : 'reminder.upcomingBody', {
      name: todo.title,
      days: daysUntil,
    }),
  };
}

function minuteNotificationText(todo: TodoItem, minutes: number): { title: string; body: string } {
  return {
    title: translateStored('reminder.upcomingTitle'),
    body: translateStored('reminder.upcomingMinutesBody', { name: todo.title, minutes }),
  };
}

async function ensurePermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}

async function checkReminders(): Promise<void> {
  if (!isTauri() || !(await ensurePermission())) return;

  const now = new Date();
  const todayKey = localDateKey(now);
  const today = new Date(`${todayKey}T00:00:00`);
  const history = readHistory();
  const todos = await storageService.getTodos();
  let changed = false;

  for (const todo of todos) {
    if (todo.completed || !todo.dueDate) continue;

    const due = new Date(`${todo.dueDate}T00:00:00`);
    const daysUntil = Math.round((due.getTime() - today.getTime()) / DAY_MS);
    let stage: string;
    let message: { title: string; body: string };
    if (daysUntil === 0 && todo.reminderTime) {
      const dueTimestamp = new Date(`${todo.dueDate}T${todo.reminderTime}:00`).getTime();
      const minuteStage = getUpcomingMinuteReminder(now.getTime(), dueTimestamp);
      if (!minuteStage) continue;
      stage = `minutes:${minuteStage}`;
      message = minuteNotificationText(todo, minuteStage);
    } else {
      const reminderTime = todo.reminderTime ?? '09:00';
      const timeReached = now >= new Date(`${todayKey}T${reminderTime}:00`);
      const shouldNotify = daysUntil < 0
        || (timeReached && (daysUntil === 0 || MILESTONES.has(daysUntil)));
      if (!shouldNotify) continue;
      stage = daysUntil < 0 ? `overdue:${todayKey}` : `days:${daysUntil}`;
      message = notificationText(todo, daysUntil);
    }

    const historyKey = `${todo.id}:${todo.dueDate}:${stage}`;
    if (history[historyKey]) continue;

    sendNotification({
      id: Math.abs((todo.id + daysUntil * 101) % 2_147_483_647),
      ...message,
      autoCancel: true,
      extra: { todoId: todo.id, dueDate: todo.dueDate },
    });
    window.dispatchEvent(new CustomEvent<TodoReminderBalloonDetail>(TODO_REMINDER_BALLOON_EVENT, {
      detail: {
        id: historyKey,
        title: message.title,
        task: todo.title,
        dueDate: todo.dueDate,
      },
    }));
    history[historyKey] = new Date().toISOString();
    changed = true;
  }

  if (changed) localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export async function startReminderService(): Promise<() => void> {
  if (!isTauri()) return () => undefined;

  let actionListener: Awaited<ReturnType<typeof onAction>> | undefined;
  try {
    actionListener = await onAction((options) => void openTodoFromNotification(options));
    await checkReminders();
  } catch (error) {
    console.error('Hatırlatıcı servisi başlatılamadı:', error);
  }

  const interval = window.setInterval(() => void checkReminders(), 60_000);
  const refresh = () => void checkReminders();
  window.addEventListener('todo-reminders-changed', refresh);

  return () => {
    window.clearInterval(interval);
    window.removeEventListener('todo-reminders-changed', refresh);
    actionListener?.unregister();
  };
}

export function refreshReminders(): void {
  window.dispatchEvent(new Event('todo-reminders-changed'));
}
