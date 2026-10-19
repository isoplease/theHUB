import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLanguage, type TranslationKey } from '../i18n';

type Tool = 'pen' | 'marker' | 'rect' | 'arrow' | 'crop';

interface ScreenshotToolProps {
  readonly dragHandle?: ReactNode;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const MONITOR_KEY = 'dashboard-monitor-v1';
const MAX_UNDO = 15;
const SAVE_DELAY_MS = 500;
const TOOLS: readonly { id: Tool; labelKey: TranslationKey }[] = [
  { id: 'pen', labelKey: 'screenshot.pen' },
  { id: 'marker', labelKey: 'screenshot.marker' },
  { id: 'rect', labelKey: 'screenshot.rect' },
  { id: 'arrow', labelKey: 'screenshot.arrow' },
  { id: 'crop', labelKey: 'screenshot.crop' },
];

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function readMonitorIndex(): number {
  try {
    const stored = Number.parseInt(window.localStorage.getItem(MONITOR_KEY) ?? '0', 10);
    return Number.isInteger(stored) && stored >= 0 && stored < 16 ? stored : 0;
  } catch {
    return 0;
  }
}

function fileStamp(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, '0');
  return `theHUB-${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.png`;
}

function canvasToBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG üretilemedi'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error ?? new Error('Okunamadı'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = width * 4;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

export function ScreenshotTool({ dragHandle }: ScreenshotToolProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const undoRef = useRef<ImageData[]>([]);
  const fileNameRef = useRef('');
  const saveTimerRef = useRef<number | null>(null);
  const gestureRef = useRef<{ base: ImageData; start: Point; points: Point[] } | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ff3b30');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [undoCount, setUndoCount] = useState(0);

  const saveNow = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !fileNameRef.current || !isTauri()) return;
    try {
      const data = await canvasToBase64(canvas);
      const path = await invoke<string>('save_screenshot', { filename: fileNameRef.current, data });
      setStatus(t('screenshot.saved', { path }));
    } catch (error) {
      setStatus(t('screenshot.saveFailed', { error: String(error) }));
    }
  }, [t]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveNow();
    }, SAVE_DELAY_MS);
  }, [saveNow]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  const capture = async () => {
    if (!isTauri() || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const dataUrl = await invoke<string>('capture_screen', { monitor: readMonitorIndex() });
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Görüntü yüklenemedi'));
        image.src = dataUrl;
      });
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      ctx.drawImage(image, 0, 0);
      undoRef.current = [];
      setUndoCount(0);
      fileNameRef.current = fileStamp();
      setHasImage(true);
      await saveNow();
    } catch (error) {
      setStatus(t('screenshot.captureFailed', { error: String(error) }));
    } finally {
      setBusy(false);
    }
  };

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };

  const paintGesture = (ctx: CanvasRenderingContext2D, end: Point) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const canvas = ctx.canvas;
    const unit = Math.max(2, canvas.width / 400);
    ctx.putImageData(gesture.base, 0, 0);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (tool === 'pen' || tool === 'marker') {
      ctx.globalAlpha = tool === 'marker' ? 0.35 : 1;
      ctx.lineWidth = tool === 'marker' ? unit * 5 : unit;
      ctx.beginPath();
      gesture.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      if (gesture.points.length === 1) ctx.lineTo(gesture.points[0].x + 0.01, gesture.points[0].y);
      ctx.stroke();
    } else if (tool === 'rect') {
      ctx.lineWidth = unit;
      ctx.strokeRect(gesture.start.x, gesture.start.y, end.x - gesture.start.x, end.y - gesture.start.y);
    } else if (tool === 'arrow') {
      ctx.lineWidth = unit;
      drawArrow(ctx, gesture.start, end, unit);
    } else {
      const x = Math.min(gesture.start.x, end.x);
      const y = Math.min(gesture.start.y, end.y);
      const width = Math.abs(end.x - gesture.start.x);
      const height = Math.abs(end.y - gesture.start.y);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(gesture.base, 0, 0, x, y, width, height);
      ctx.setLineDash([unit * 3, unit * 2]);
      ctx.lineWidth = unit / 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(x, y, width, height);
    }
    ctx.restore();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!hasImage || event.button !== 0) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setPointerCapture(event.pointerId);
    const start = pointOf(event);
    gestureRef.current = { base: ctx.getImageData(0, 0, canvas.width, canvas.height), start, points: [start] };
    paintGesture(ctx, start);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    const ctx = event.currentTarget.getContext('2d');
    if (!gesture || !ctx) return;
    const point = pointOf(event);
    gesture.points.push(point);
    paintGesture(ctx, point);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext('2d');
    gestureRef.current = null;
    if (!gesture || !ctx) return;
    const end = pointOf(event);
    undoRef.current = [...undoRef.current.slice(-(MAX_UNDO - 1)), gesture.base];
    if (tool === 'crop') {
      const x = Math.max(0, Math.round(Math.min(gesture.start.x, end.x)));
      const y = Math.max(0, Math.round(Math.min(gesture.start.y, end.y)));
      const width = Math.min(canvas.width - x, Math.round(Math.abs(end.x - gesture.start.x)));
      const height = Math.min(canvas.height - y, Math.round(Math.abs(end.y - gesture.start.y)));
      if (width < 8 || height < 8) {
        ctx.putImageData(gesture.base, 0, 0);
        undoRef.current = undoRef.current.slice(0, -1);
        return;
      }
      const cropped = (() => {
        ctx.putImageData(gesture.base, 0, 0);
        return ctx.getImageData(x, y, width, height);
      })();
      canvas.width = width;
      canvas.height = height;
      ctx.putImageData(cropped, 0, 0);
    } else {
      paintGesture(ctx, end);
    }
    setUndoCount(undoRef.current.length);
    scheduleSave();
  };

  const undo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const previous = undoRef.current.pop();
    if (!canvas || !ctx || !previous) return;
    canvas.width = previous.width;
    canvas.height = previous.height;
    ctx.putImageData(previous, 0, 0);
    setUndoCount(undoRef.current.length);
    scheduleSave();
  };

  const copy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG üretilemedi');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus(t('screenshot.copied'));
    } catch (error) {
      setStatus(t('screenshot.saveFailed', { error: String(error) }));
    }
  };

  const buttonClass = 'cursor-pointer rounded-lg border border-theme-border bg-transparent px-2.5 py-1.5 text-xs font-semibold text-heading transition-colors hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <section className="min-w-0 self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[1.1rem] font-bold text-heading">{t('screenshot.title')}</h2>
        {dragHandle}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={`${buttonClass} bg-theme-accent-bg`} disabled={busy} onClick={() => void capture()}>
          {busy ? t('screenshot.capturing') : hasImage ? t('screenshot.new') : t('screenshot.capture')}
        </button>
        {hasImage && (
          <>
            <button type="button" className={buttonClass} disabled={undoCount === 0} onClick={undo}>{t('screenshot.undo')}</button>
            <button type="button" className={buttonClass} onClick={() => void copy()}>{t('screenshot.copy')}</button>
          </>
        )}
      </div>
      {hasImage && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t('screenshot.tools')}>
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${buttonClass} ${tool === item.id ? 'border-theme-accent bg-panel' : ''}`}
              aria-pressed={tool === item.id}
              onClick={() => setTool(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-1.5 text-xs text-info">
            {t('screenshot.color')}
            <input
              type="color"
              value={color}
              className="size-7 cursor-pointer rounded border border-theme-border bg-transparent p-0"
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`mt-3 w-full cursor-crosshair touch-none rounded-xl border border-theme-border ${hasImage ? '' : 'hidden'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {!hasImage && <p className="mt-3 text-sm text-info">{t('screenshot.hint')}</p>}
      {status && <p className="mt-2 break-all text-xs text-info" role="status">{status}</p>}
    </section>
  );
}
