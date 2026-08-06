import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';

export function DateTimeDisplay() {
  const { locale, t } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: '2-digit', month: 'long', year: 'numeric', weekday: 'long',
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div
      className="min-w-[190px] rounded-2xl border border-theme-border bg-card px-3.5 py-2.5 text-right shadow-[var(--shadow)] pointer-events-none select-none max-[900px]:min-w-[170px]"
      aria-label={t('dateTime.label', { date: dateFormatter.format(now), time: timeFormatter.format(now) })}
    >
      <time className="block text-[1.1rem] font-bold tracking-[0.04em] text-heading tabular-nums" dateTime={now.toISOString()}>
        {timeFormatter.format(now)}
      </time>
      <span className="mt-0.5 block text-[0.76rem] text-info capitalize">{dateFormatter.format(now)}</span>
    </div>
  );
}
