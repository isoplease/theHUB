import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type Direction = 'up' | 'right' | 'down' | 'left';
type Slots = Partial<Record<Direction, string | null>>;

const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];
const RING = 230;

const POSITIONS: Record<Direction, string> = {
  up: 'left-1/2 top-3 -translate-x-1/2',
  down: 'bottom-3 left-1/2 -translate-x-1/2',
  left: 'left-3 top-1/2 -translate-y-1/2',
  right: 'right-3 top-1/2 -translate-y-1/2',
};

/** Shift + dosya sürükleme sırasında imlecin çevresinde açılan 4 yönlü dönüştürme joystick'i (?view=joystick).
 * Etiketleri ve vurgulanan yönü Rust gönderir; dosya fare bırakılınca Rust tarafında çevrilir. */
export function JoystickView() {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [slots, setSlots] = useState<Slots>({});
  const [active, setActive] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Katman dosyayı asla taşıtmaz/silmez: bırakma 'kopyala' sayılır ve sayfa dosyaya yönlenmez.
    const allow = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    window.addEventListener('dragenter', allow);
    window.addEventListener('dragover', allow);
    window.addEventListener('drop', allow);
    const stops = [
      listen<{ x: number; y: number; slots: Slots }>('joystick-open', (event) => {
        setOrigin({ x: event.payload.x, y: event.payload.y });
        setSlots(event.payload.slots);
        setLoaded(DIRECTIONS.some((direction) => event.payload.slots[direction]));
        setActive(null);
      }),
      listen<Slots>('joystick-files', (event) => {
        setSlots(event.payload);
        setLoaded(true);
      }),
      listen<number | null>('joystick-hover', (event) => setActive(event.payload)),
      listen('joystick-close', () => {
        setOrigin(null);
        setSlots({});
        setActive(null);
        setLoaded(false);
      }),
    ];
    // Dinleyiciler hazır olunca Rust'a haber ver; katman ondan önce gösterilmez.
    void Promise.all(stops).then(() => invoke('joystick_ready')).catch(() => undefined);
    return () => {
      window.removeEventListener('dragenter', allow);
      window.removeEventListener('dragover', allow);
      window.removeEventListener('drop', allow);
      stops.forEach((stop) => void stop.then((dispose) => dispose()));
    };
  }, []);

  if (!origin) return <div className="fixed inset-0 bg-transparent" />;
  const ratio = window.devicePixelRatio || 1;
  const hasSlots = DIRECTIONS.some((direction) => slots[direction]);
  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-transparent font-sans">
      <div
        className="absolute rounded-full border border-theme-border bg-card/85 shadow-[var(--shadow)] backdrop-blur-md"
        style={{ width: RING, height: RING, left: origin.x / ratio - RING / 2, top: origin.y / ratio - RING / 2 }}
      >
        <div className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-theme-border text-[11px] font-bold uppercase tracking-wide text-heading">
          {active !== null && slots[DIRECTIONS[active]] ? `→ ${slots[DIRECTIONS[active]]}` : ''}
        </div>
        {!hasSlots && (
          <div className="absolute inset-0 grid place-items-center px-14 text-center text-xs font-semibold text-heading">
            {loaded ? 'Bu tür desteklenmiyor' : 'Dosya okunuyor…'}
          </div>
        )}
        {DIRECTIONS.map((direction, index) => {
          const target = slots[direction];
          if (!target) return null;
          return (
            <div
              key={direction}
              className={`absolute grid h-10 min-w-14 place-items-center rounded-full px-3 text-xs font-bold uppercase tracking-wide transition-colors ${POSITIONS[direction]} ${
                active === index ? 'bg-red-600 text-white' : 'bg-theme-border/40 text-heading'
              }`}
            >
              {target}
            </div>
          );
        })}
      </div>
    </div>
  );
}
