import type { DateEventFormat, DateEventItem } from '../types/app';

const DAY_IN_MILLISECONDS = 86_400_000;

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidDateKey(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

export function calendarDaysRemaining(targetDate: string, today = new Date()): number {
  if (!isValidDateKey(targetDate)) return Number.NaN;
  const [year, month, day] = targetDate.split('-').map(Number);
  const targetUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((targetUtc - todayUtc) / DAY_IN_MILLISECONDS);
}

export function formatTrackedDate(value: string, format: DateEventFormat): string {
  if (!isValidDateKey(value)) return value;
  const [year, month, day] = value.split('-');
  return format === 'mdy' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}

export function sortTrackedDateEvents(events: readonly DateEventItem[]): DateEventItem[] {
  return [...events].sort((left, right) => (
    left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt)
  ));
}
