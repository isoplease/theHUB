import { useEffect, useState } from 'react';

const timeFormatter = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  weekday: 'long',
});

export function DateTimeDisplay() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div
      className="min-w-[190px] rounded-2xl border border-theme-border bg-card px-3.5 py-2.5 text-right shadow-[var(--shadow)] pointer-events-none select-none max-[900px]:min-w-[170px]"
      aria-label={`${dateFormatter.format(now)}, saat ${timeFormatter.format(now)}`}
    >
      <time className="block text-[1.1rem] font-bold tracking-[0.04em] text-heading tabular-nums" dateTime={now.toISOString()}>
        {timeFormatter.format(now)}
      </time>
      <span className="mt-0.5 block text-[0.76rem] text-info capitalize">{dateFormatter.format(now)}</span>
    </div>
  );
}
