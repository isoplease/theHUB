export const MAX_TIMER_SECONDS = (24 * 60 * 60) - 1;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

export function clampTimerPart(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.trunc(value)));
}

export function timerPartsToMilliseconds(
  hours: number,
  minutes: number,
  seconds: number,
): number {
  const safeHours = clampTimerPart(hours, 23);
  const safeMinutes = clampTimerPart(minutes, 59);
  const safeSeconds = clampTimerPart(seconds, 59);
  return ((safeHours * 3600) + (safeMinutes * 60) + safeSeconds) * 1000;
}

export function presetMinutesToTimer(presetMinutes: number): {
  hours: number;
  minutes: number;
  milliseconds: number;
} {
  const safeMinutes = Number.isFinite(presetMinutes)
    ? Math.max(0, Math.trunc(presetMinutes))
    : 0;
  return {
    hours: Math.floor(safeMinutes / 60),
    minutes: safeMinutes % 60,
    milliseconds: safeMinutes * 60_000,
  };
}
export function formatTimer(milliseconds: number): string {
  const totalSeconds = Math.min(
    MAX_TIMER_SECONDS,
    Math.max(0, Math.ceil(milliseconds / 1000)),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatStopwatch(milliseconds: number): string {
  const totalCentiseconds = Math.max(0, Math.floor(milliseconds / 10));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}
