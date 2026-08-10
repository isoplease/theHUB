import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clampTimerPart,
  formatStopwatch,
  formatTimer,
  timerPartsToMilliseconds,
} from '../services/timeTools';
import { useLanguage } from '../i18n';

type TimeTool = 'stopwatch' | 'timer';
type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

interface ControlButtonProps {
  readonly kind: 'stop' | 'play' | 'pause';
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

let startBeepContext: AudioContext | null = null;

function playStartBeep() {
  const AudioContextClass = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    if (!startBeepContext || startBeepContext.state === 'closed') {
      startBeepContext = new AudioContextClass();
    }
    const context = startBeepContext;
    const playTone = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startTime = context.currentTime;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(620, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.06, startTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.09);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.095);
    };

    if (context.state === 'suspended') void context.resume().then(playTone).catch(() => undefined);
    else playTone();
  } catch {
    // Ses aygıtı kullanılamıyorsa zaman araçları normal şekilde çalışmaya devam eder.
  }
}

function ControlIcon({ kind }: Pick<ControlButtonProps, 'kind'>) {
  if (kind === 'stop') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
        <rect x="6" y="6" width="12" height="12" rx="1.5" />
      </svg>
    );
  }

  if (kind === 'pause') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
      <path d="M8 5.8v12.4a1 1 0 0 0 1.54.84l9.15-6.2a1 1 0 0 0 0-1.68L9.54 4.96A1 1 0 0 0 8 5.8Z" />
    </svg>
  );
}

function ControlButton({ kind, label, disabled = false, onClick }: ControlButtonProps) {
  const isStop = kind === 'stop';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`flex size-12 cursor-pointer items-center justify-center rounded-xl border transition-all duration-150 hover:-translate-y-px active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 ${
        isStop
          ? 'border-red-400/50 bg-red-500/10 text-red-300 hover:bg-red-500/20'
          : 'border-theme-accent bg-theme-accent text-white shadow-[0_8px_20px_rgba(14,26,69,0.2)] hover:brightness-110'
      }`}
      onClick={onClick}
    >
      <ControlIcon kind={kind} />
    </button>
  );
}

function TimerField({
  label,
  value,
  maximum,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly maximum: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-[0.65rem] font-semibold tracking-[0.1em] text-info uppercase">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={maximum}
        value={value}
        disabled={disabled}
        className="w-full rounded-xl border border-theme-border bg-panel px-2 py-2 text-center text-xl font-bold text-heading outline-none transition-shadow [font-family:'DS_Digital',ui-monospace,monospace] focus:border-theme-accent focus:ring-2 focus:ring-theme-accent/20 disabled:opacity-55"
        onChange={(event) => onChange(clampTimerPart(Number(event.target.value), maximum))}
      />
    </label>
  );
}

interface TimeToolsProps {
  readonly dragHandle?: ReactNode;
}

export function TimeTools({ dragHandle }: TimeToolsProps) {
  const { t } = useLanguage();
  const [activeTool, setActiveTool] = useState<TimeTool>('stopwatch');
  const [stopwatchElapsed, setStopwatchElapsed] = useState(0);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const stopwatchStartedAt = useRef<number | null>(null);

  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [timerStatus, setTimerStatus] = useState<TimerStatus>('idle');
  const [timerRemaining, setTimerRemaining] = useState(0);
  const timerEndsAt = useRef<number | null>(null);

  const configuredTimer = timerPartsToMilliseconds(hours, minutes, seconds);

  useEffect(() => {
    if (!stopwatchRunning) return;
    const update = () => {
      if (stopwatchStartedAt.current !== null) {
        setStopwatchElapsed(Date.now() - stopwatchStartedAt.current);
      }
    };
    update();
    const interval = window.setInterval(update, 30);
    return () => window.clearInterval(interval);
  }, [stopwatchRunning]);

  useEffect(() => {
    if (timerStatus !== 'running') return;
    const update = () => {
      if (timerEndsAt.current === null) return;
      const nextRemaining = Math.max(0, timerEndsAt.current - Date.now());
      setTimerRemaining(nextRemaining);
      if (nextRemaining === 0) {
        timerEndsAt.current = null;
        setTimerStatus('finished');
      }
    };
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [timerStatus]);

  const toggleStopwatch = () => {
    playStartBeep();
    if (stopwatchRunning) {
      if (stopwatchStartedAt.current !== null) {
        setStopwatchElapsed(Date.now() - stopwatchStartedAt.current);
      }
      setStopwatchRunning(false);
      return;
    }
    stopwatchStartedAt.current = Date.now() - stopwatchElapsed;
    setStopwatchRunning(true);
  };

  const resetStopwatch = () => {
    stopwatchStartedAt.current = null;
    setStopwatchRunning(false);
    setStopwatchElapsed(0);
  };

  const toggleTimer = () => {
    playStartBeep();
    if (timerStatus === 'running') {
      const nextRemaining = timerEndsAt.current === null
        ? timerRemaining
        : Math.max(0, timerEndsAt.current - Date.now());
      timerEndsAt.current = null;
      setTimerRemaining(nextRemaining);
      setTimerStatus(nextRemaining > 0 ? 'paused' : 'finished');
      return;
    }

    const duration = timerStatus === 'paused' ? timerRemaining : configuredTimer;
    if (duration <= 0) return;
    setTimerRemaining(duration);
    timerEndsAt.current = Date.now() + duration;
    setTimerStatus('running');
  };

  const resetTimer = () => {
    timerEndsAt.current = null;
    setTimerStatus('idle');
    setTimerRemaining(configuredTimer);
  };

  const updateTimerPart = (setter: (value: number) => void, value: number) => {
    timerEndsAt.current = null;
    setTimerStatus('idle');
    setTimerRemaining(0);
    setter(value);
  };

  const timerDisplay = timerStatus === 'idle' ? configuredTimer : timerRemaining;
  const timerCanStart = timerStatus === 'paused' || configuredTimer > 0;
  const timerIsCritical = timerStatus !== 'idle' && timerRemaining > 0 && timerRemaining <= 10_000;
  const timerIsHeartbeat = timerStatus === 'running' && timerRemaining > 0 && timerRemaining <= 3_000;

  return (
    <section className="self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]" aria-label={t('timeTools.label')}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[1.1rem] font-bold text-heading">{t('timeTools.title')}</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-theme-border bg-panel p-1" aria-label={t('timeTools.selection')}>
            <button
              type="button"
              aria-pressed={activeTool === 'stopwatch'}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTool === 'stopwatch' ? 'bg-theme-accent text-white' : 'text-info hover:text-heading'}`}
              onClick={() => setActiveTool('stopwatch')}
            >
              {t('timeTools.stopwatch')}
            </button>
            <button
              type="button"
              aria-pressed={activeTool === 'timer'}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTool === 'timer' ? 'bg-theme-accent text-white' : 'text-info hover:text-heading'}`}
              onClick={() => setActiveTool('timer')}
            >
              {t('timeTools.timer')}
            </button>
          </div>
          {dragHandle}
        </div>
      </div>

      {activeTool === 'stopwatch' ? (
        <div>
          <output
            className="flex min-h-28 items-center justify-center rounded-2xl border border-theme-border bg-panel px-4 text-5xl font-bold tracking-[0.08em] text-heading shadow-inner [font-family:'DS_Digital',ui-monospace,monospace]"
            aria-label={t('timeTools.stopwatchDisplay')}
          >
            {formatStopwatch(stopwatchElapsed)}
          </output>
          <p className="mt-3 text-center text-xs font-medium text-info" aria-live="polite">
            {stopwatchRunning ? t('timeTools.running') : stopwatchElapsed > 0 ? t('timeTools.paused') : t('timeTools.ready')}
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <ControlButton kind="stop" label={t('timeTools.stopwatchReset')} disabled={stopwatchElapsed === 0 && !stopwatchRunning} onClick={resetStopwatch} />
            <ControlButton kind={stopwatchRunning ? 'pause' : 'play'} label={stopwatchRunning ? t('timeTools.stopwatchPause') : t('timeTools.stopwatchStart')} onClick={toggleStopwatch} />
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex gap-2">
            <TimerField label={t('timeTools.hours')} value={hours} maximum={23} disabled={timerStatus === 'running'} onChange={(value) => updateTimerPart(setHours, value)} />
            <TimerField label={t('timeTools.minutes')} value={minutes} maximum={59} disabled={timerStatus === 'running'} onChange={(value) => updateTimerPart(setMinutes, value)} />
            <TimerField label={t('timeTools.seconds')} value={seconds} maximum={59} disabled={timerStatus === 'running'} onChange={(value) => updateTimerPart(setSeconds, value)} />
          </div>
          <output
            className={`flex min-h-28 items-center justify-center rounded-2xl border px-4 text-5xl font-bold tracking-[0.08em] transition-[border-color,box-shadow,filter,transform,background-color] duration-200 [font-family:'DS_Digital',ui-monospace,monospace] ${
              timerStatus === 'finished'
                ? 'border-red-400/60 bg-red-500/10 text-red-300 shadow-[inset_0_0_16px_rgba(239,68,68,0.12),0_0_18px_rgba(239,68,68,0.16)]'
                : timerIsCritical
                  ? 'border-red-500 bg-red-500/10 text-heading shadow-[inset_0_0_18px_rgba(239,68,68,0.12),0_0_0_1px_rgba(239,68,68,0.24),0_0_22px_rgba(239,68,68,0.2)]'
                  : 'border-theme-border bg-panel text-heading shadow-inner'
            } ${timerIsHeartbeat ? 'animate-[timer-heartbeat_1s_ease-in-out_infinite] motion-reduce:animate-none' : ''}`}
            aria-label={t('timeTools.timerDisplay')}
            aria-live="polite"
          >
            {formatTimer(timerDisplay)}
          </output>
          <p className={`mt-3 text-center text-xs font-semibold ${timerStatus === 'finished' ? 'text-red-300' : 'text-info'}`} aria-live="polite">
            {timerStatus === 'running' && t('timeTools.countingDown')}
            {timerStatus === 'paused' && t('timeTools.paused')}
            {timerStatus === 'idle' && t('timeTools.ready')}
            {timerStatus === 'finished' && t('timeTools.finished')}
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <ControlButton kind="stop" label={t('timeTools.timerReset')} disabled={timerStatus === 'idle'} onClick={resetTimer} />
            <ControlButton
              kind={timerStatus === 'running' ? 'pause' : 'play'}
              label={timerStatus === 'running' ? t('timeTools.timerPause') : t('timeTools.timerStart')}
              disabled={!timerCanStart}
              onClick={toggleTimer}
            />
          </div>
        </div>
      )}
    </section>
  );
}
