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
    <div className="date-time" aria-label={`${dateFormatter.format(now)}, saat ${timeFormatter.format(now)}`}>
      <time className="date-time-clock" dateTime={now.toISOString()}>
        {timeFormatter.format(now)}
      </time>
      <span className="date-time-date">{dateFormatter.format(now)}</span>
    </div>
  );
}
