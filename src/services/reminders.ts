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

const HISTORY_KEY = 'todo-reminder-history-v1';
const DAY_MS = 86_400_000;
const MILESTONES = new Set([30, 21, 14, 7, 3, 2, 1]);

export const TODO_REMINDER_OPEN_EVENT = 'todo-reminder-open';

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
      title: 'Geciken görev',
      body: `“${todo.title}” görevinin tarihi ${Math.abs(daysUntil)} gün geçti.`,
    };
  }
  if (daysUntil === 0) {
    return { title: 'Bugünkü görev', body: `“${todo.title}” bugün tamamlanmalı.` };
  }
  return {
    title: 'Yaklaşan görev',
    body: `“${todo.title}” için ${daysUntil} gün kaldı.`,
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
    const reminderTime = todo.reminderTime ?? '09:00';
    const timeReached = now >= new Date(`${todayKey}T${reminderTime}:00`);
    const shouldNotify = daysUntil < 0 || (timeReached && (daysUntil === 0 || MILESTONES.has(daysUntil)));
    if (!shouldNotify) continue;

    const stage = daysUntil < 0 ? `overdue:${todayKey}` : `days:${daysUntil}`;
    const historyKey = `${todo.id}:${todo.dueDate}:${stage}`;
    if (history[historyKey]) continue;

    const message = notificationText(todo, daysUntil);
    sendNotification({
      id: Math.abs((todo.id + daysUntil * 101) % 2_147_483_647),
      ...message,
      autoCancel: true,
      extra: { todoId: todo.id, dueDate: todo.dueDate },
    });
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
