import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useLanguage } from '../i18n';
import {
  buildDateKey,
  calendarDaysRemaining,
  formatTrackedDate,
  isValidDateKey,
  localDateKey,
  sortTrackedDateEvents,
} from '../services/dateTracker';
import { MAX_DATE_EVENT_TITLE_LENGTH, storageService } from '../services/storage';
import type { DateEventFormat, DateEventItem } from '../types/app';

interface DateTrackerProps {
  readonly dragHandle?: ReactNode;
  readonly onEventsChange?: (events: readonly DateEventItem[]) => void;
}

function initialDateParts() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    day: tomorrow.getDate(),
    month: tomorrow.getMonth() + 1,
    year: tomorrow.getFullYear(),
  };
}

export function DateTracker({ dragHandle, onEventsChange }: DateTrackerProps) {
  const { locale, t } = useLanguage();
  const initialDate = useMemo(initialDateParts, []);
  const [events, setEvents] = useState<DateEventItem[]>([]);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<DateEventFormat>('dmy');
  const [day, setDay] = useState(initialDate.day);
  const [month, setMonth] = useState(initialDate.month);
  const [year, setYear] = useState(initialDate.year);
  const [todayKey, setTodayKey] = useState(localDateKey);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  const monthLabels = useMemo(() => Array.from({ length: 12 }, (_, index) => (
    new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2024, index, 1))
  )), [locale]);

  const showTemporaryError = (message: string) => {
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    setError(message);
    errorTimerRef.current = window.setTimeout(() => {
      errorTimerRef.current = null;
      setError('');
    }, 3_000);
  };

  useEffect(() => () => {
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
  }, []);

  useEffect(() => {
    if (!loading) onEventsChange?.(events);
  }, [events, loading, onEventsChange]);

  useEffect(() => {
    let active = true;
    void storageService.getDateEvents()
      .then((items) => {
        if (active) setEvents(sortTrackedDateEvents(items));
      })
      .catch(() => {
        if (active) showTemporaryError(t('dateTracker.loadError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    const refreshDate = () => setTodayKey(localDateKey());
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshDate();
    };
    const intervalId = window.setInterval(refreshDate, 30_000);
    window.addEventListener('focus', refreshDate);
    window.addEventListener('pageshow', refreshDate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshDate);
      window.removeEventListener('pageshow', refreshDate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  const addEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const date = buildDateKey(year, month, day);
    if (!normalizedTitle) {
      showTemporaryError(t('dateTracker.titleRequired'));
      return;
    }
    if (!isValidDateKey(date)) {
      showTemporaryError(t('dateTracker.invalidDate'));
      return;
    }
    if (date < todayKey) {
      showTemporaryError(t('dateTracker.pastDate'));
      return;
    }

    try {
      const created = await storageService.addDateEvent(normalizedTitle, date, format);
      setEvents((current) => sortTrackedDateEvents([...current, created]));
      setTitle('');
      setError('');
    } catch {
      showTemporaryError(t('dateTracker.saveError'));
    }
  };

  const deleteEvent = async (id: string) => {
    setDeletingId(id);
    try {
      await storageService.deleteDateEvent(id);
      setEvents((current) => current.filter((item) => item.id !== id));
      setPendingDeleteId(null);
      setError('');
    } catch {
      showTemporaryError(t('dateTracker.deleteError'));
    } finally {
      setDeletingId(null);
    }
  };

  const dateFields = {
    day: (
      <label key="day" className="min-w-0 flex-1">
        <span className="sr-only">{t('dateTracker.day')}</span>
        <select value={day} onChange={(event) => setDay(Number(event.target.value))} className="w-full cursor-pointer rounded-lg border border-theme-border bg-panel px-2 py-2 text-sm text-heading outline-none focus:border-theme-accent focus:ring-2 focus:ring-theme-accent/20" aria-label={t('dateTracker.day')}>
          {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>{String(value).padStart(2, '0')}</option>
          ))}
        </select>
      </label>
    ),
    month: (
      <label key="month" className="min-w-0 flex-[1.35]">
        <span className="sr-only">{t('dateTracker.month')}</span>
        <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="w-full cursor-pointer rounded-lg border border-theme-border bg-panel px-2 py-2 text-sm text-heading outline-none focus:border-theme-accent focus:ring-2 focus:ring-theme-accent/20" aria-label={t('dateTracker.month')}>
          {monthLabels.map((label, index) => (
            <option key={label} value={index + 1}>{String(index + 1).padStart(2, '0')} · {label}</option>
          ))}
        </select>
      </label>
    ),
    year: (
      <label key="year" className="min-w-20 flex-1">
        <span className="sr-only">{t('dateTracker.year')}</span>
        <input type="number" min={new Date().getFullYear()} max={9999} value={year} onChange={(event) => setYear(Number(event.target.value))} className="w-full rounded-lg border border-theme-border bg-panel px-2 py-2 text-sm text-heading outline-none focus:border-theme-accent focus:ring-2 focus:ring-theme-accent/20" aria-label={t('dateTracker.year')} />
      </label>
    ),
  };

  return (
    <section className="self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[1.1rem] font-bold text-heading">{t('dateTracker.title')}</h2>
        {dragHandle}
      </div>
      <form className="mt-4 space-y-3" onSubmit={(event) => void addEvent(event)}>
        <input type="text" value={title} maxLength={MAX_DATE_EVENT_TITLE_LENGTH} onChange={(event) => setTitle(event.target.value)} placeholder={t('dateTracker.eventName')} aria-label={t('dateTracker.eventName')} className="w-full rounded-xl border border-theme-border bg-transparent px-3 py-2.5 text-heading outline-none placeholder:text-info focus:ring-2 focus:ring-theme-accent/30" />
        <div className="inline-grid grid-cols-2 rounded-lg border border-theme-border bg-panel p-0.5" aria-label={t('dateTracker.dateFormat')}>
          {(['dmy', 'mdy'] as const).map((value) => (
            <button key={value} type="button" className={`cursor-pointer rounded-md px-2.5 py-1 text-[0.68rem] font-semibold tracking-wide transition-colors ${format === value ? 'bg-theme-accent text-white' : 'text-info hover:text-heading'}`} aria-pressed={format === value} onClick={() => setFormat(value)}>
              {t(value === 'dmy' ? 'dateTracker.dmy' : 'dateTracker.mdy')}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {format === 'dmy' ? [dateFields.day, dateFields.month, dateFields.year] : [dateFields.month, dateFields.day, dateFields.year]}
        </div>
        <button type="submit" className="w-full cursor-pointer rounded-xl border border-theme-accent bg-theme-accent px-4 py-2.5 font-semibold text-white shadow-[0_8px_20px_rgba(14,26,69,0.12)] transition-all hover:-translate-y-px hover:brightness-110">
          {t('dateTracker.add')}
        </button>
        {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
      </form>
      <div className="mt-4 min-h-[250px]" aria-live="polite" aria-busy={loading}>
        {!loading && events.length === 0 && <span className="sr-only">{t('dateTracker.empty')}</span>}
        {events.map((item) => {
          const days = calendarDaysRemaining(item.date, new Date(`${todayKey}T12:00:00`));
          const countdown = days > 0 ? t(days === 1 ? 'dateTracker.dayLeft' : 'dateTracker.daysLeft', { count: days }) : days === 0 ? t('dateTracker.today') : t('dateTracker.expired');
          return (
            <article key={item.id} className="relative min-h-[50px] border-b border-theme-border/55 py-2 pr-8 last:border-b-0">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-semibold text-heading">{formatTrackedDate(item.date, item.format)}</span>
                <span className="break-words text-info">{item.title}</span>
              </p>
              <div className="ml-2 flex min-h-5 items-start text-xs font-semibold text-heading">
                <span className="mr-2 h-3.5 w-3 shrink-0 rounded-bl-md border-b border-l border-theme-border" aria-hidden="true" />
                <span className="pt-1">{countdown}</span>
              </div>
              <button type="button" className="absolute top-2 right-0 grid size-5 cursor-pointer place-items-center rounded text-xs text-red-300 transition-colors hover:bg-red-500/15 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/40" aria-label={t('dateTracker.deleteNamed', { name: item.title })} aria-expanded={pendingDeleteId === item.id} title={t('common.delete')} onClick={() => setPendingDeleteId((current) => current === item.id ? null : item.id)}>×</button>
              {pendingDeleteId === item.id && (
                <div className="mt-2 rounded-xl border border-red-400/45 bg-red-500/10 p-2.5" role="alertdialog" aria-label={t('dateTracker.confirmDelete', { name: item.title })}>
                  <p className="text-xs text-heading">{t('dateTracker.confirmDelete', { name: item.title })}</p>
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" className="cursor-pointer rounded-lg border border-theme-border px-3 py-1.5 text-xs font-semibold text-info transition-colors hover:text-heading disabled:cursor-wait disabled:opacity-60" disabled={deletingId === item.id} onClick={() => setPendingDeleteId(null)}>{t('common.cancel')}</button>
                    <button type="button" className="cursor-pointer rounded-lg border border-red-400/55 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/25 hover:text-white disabled:cursor-wait disabled:opacity-60" disabled={deletingId === item.id} onClick={() => void deleteEvent(item.id)}>{deletingId === item.id ? '…' : t('common.delete')}</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
