const MINUTE_MS = 60_000;

export type UpcomingMinuteReminder = 30 | 10 | 5;

export function getUpcomingMinuteReminder(
  nowTimestamp: number,
  dueTimestamp: number,
): UpcomingMinuteReminder | null {
  const remaining = dueTimestamp - nowTimestamp;
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 30 * MINUTE_MS) return null;
  if (remaining <= 5 * MINUTE_MS) return 5;
  if (remaining <= 10 * MINUTE_MS) return 10;
  return 30;
}
