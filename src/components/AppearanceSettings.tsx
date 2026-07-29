import { useEffect, useState } from 'react';

const STORAGE_KEY = 'dashboard-custom-colors-v1';
const DEFAULT_BACKGROUND = '#0f172a';
const DEFAULT_CARDS = '#172033';
const DEFAULT_HEADINGS = '#f8fafc';
const DEFAULT_INFO = '#94a3b8';
const DEFAULT_WORKSPACE_LABEL_COLOR = '#0e1a45';

interface CustomColors {
  background: string;
  backgroundTransparency: number;
  cards: string;
  headings: string;
  info: string;
}

interface AppearanceSettingsProps {
  readonly windowDecorations: boolean;
  readonly onWindowDecorationsChange: (enabled: boolean) => void;
  readonly workspaceLabel: string;
  readonly workspaceLabelColor: string;
  readonly onWorkspaceLabelChange: (label: string) => void;
  readonly onWorkspaceLabelColorChange: (color: string) => void;
}

function backgroundWithTransparency(color: string, transparency = 0): string {
  const normalized = color.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const alpha = 1 - Math.min(100, Math.max(0, transparency)) / 100;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function applyColors(colors: CustomColors | null) {
  const root = document.documentElement;
  if (colors) {
    root.style.setProperty(
      '--custom-background',
      backgroundWithTransparency(colors.background, colors.backgroundTransparency),
    );
    root.style.setProperty('--custom-card', colors.cards);
    root.style.setProperty('--custom-heading', colors.headings);
    root.style.setProperty('--custom-info', colors.info);
  } else {
    root.style.removeProperty('--custom-background');
    root.style.removeProperty('--custom-card');
    root.style.removeProperty('--custom-heading');
    root.style.removeProperty('--custom-info');
  }
}

function getDefaultColors(): CustomColors {
  return {
    background: DEFAULT_BACKGROUND,
    backgroundTransparency: 0,
    cards: DEFAULT_CARDS,
    headings: DEFAULT_HEADINGS,
    info: DEFAULT_INFO,
  };
}

export function AppearanceSettings({
  windowDecorations,
  onWindowDecorationsChange,
  workspaceLabel,
  workspaceLabelColor,
  onWorkspaceLabelChange,
  onWorkspaceLabelColorChange,
}: AppearanceSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [colors, setColors] = useState<CustomColors>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return getDefaultColors();
      }
      const parsed = JSON.parse(stored) as Partial<CustomColors>;
      return { ...getDefaultColors(), ...parsed };
    } catch {
      return getDefaultColors();
    }
  });
  const [isCustomized, setIsCustomized] = useState(() => window.localStorage.getItem(STORAGE_KEY) !== null);

  useEffect(() => {
    applyColors(isCustomized ? colors : null);
    if (isCustomized) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
    }
  }, [colors, isCustomized]);

  const updateColor = <Key extends keyof CustomColors,>(key: Key, value: CustomColors[Key]) => {
    setIsCustomized(true);
    setColors((current) => ({ ...current, [key]: value }));
  };

  const resetColors = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setIsCustomized(false);
    onWorkspaceLabelChange('Personal workspace');
    onWorkspaceLabelColorChange(DEFAULT_WORKSPACE_LABEL_COLOR);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="grid size-[42px] cursor-pointer place-items-center rounded-xl border border-theme-border bg-card p-0 text-[1.3rem] leading-none font-semibold text-heading transition-transform duration-150 hover:-translate-y-px"
        aria-expanded={isOpen}
        aria-label="Renk ayarlarını aç"
        title="Görünüm ayarları"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {isOpen && (
        <div className="absolute top-[calc(100%+10px)] right-0 z-10 w-[220px] rounded-2xl border border-theme-border bg-card p-3.5 shadow-[var(--shadow)]">
          <label className="mb-2.5 flex items-center justify-between gap-3.5 text-sm text-heading">
            <span>Arka plan</span>
            <input
              className="h-8 w-11 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
              type="color"
              value={colors.background}
              onChange={(event) => updateColor('background', event.target.value)}
            />
          </label>
          <label className="mb-2.5 block text-sm text-heading">
            <span className="mb-1.5 flex items-center justify-between">
              <span>Arka plan şeffaflığı</span>
              <output>{colors.backgroundTransparency ?? 0}%</output>
            </span>
            <input
              className="w-full cursor-pointer accent-theme-accent"
              type="range"
              min="0"
              max="100"
              step="1"
              value={colors.backgroundTransparency ?? 0}
              onChange={(event) => updateColor('backgroundTransparency', Number(event.target.value))}
            />
          </label>
          <label className="mb-2.5 flex items-center justify-between gap-3.5 text-sm text-heading">
            <span>Kartlar</span>
            <input
              className="h-8 w-11 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
              type="color"
              value={colors.cards}
              onChange={(event) => updateColor('cards', event.target.value)}
            />
          </label>
          <label className="mb-2.5 flex items-center justify-between gap-3.5 text-sm text-heading">
            <span>Kart Başlıkları</span>
            <input
              className="h-8 w-11 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
              type="color"
              value={colors.headings}
              onChange={(event) => updateColor('headings', event.target.value)}
            />
          </label>
          <label className="mb-2.5 flex items-center justify-between gap-3.5 text-sm text-heading">
            <span>Bilgi Yazıları</span>
            <input
              className="h-8 w-11 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
              type="color"
              value={colors.info}
              onChange={(event) => updateColor('info', event.target.value)}
            />
          </label>
          <label className="mb-2.5 flex cursor-pointer items-center justify-between gap-3.5 text-sm text-heading">
            <span>Windows Çerçevesi</span>
            <input
              type="checkbox"
              checked={windowDecorations}
              className="size-4 cursor-pointer accent-theme-accent"
              onChange={(event) => onWindowDecorationsChange(event.target.checked)}
            />
          </label>
          <label className="mb-2.5 block text-sm text-heading">
            <span className="mb-1.5 block">Çalışma alanı başlığı</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={workspaceLabel}
                maxLength={50}
                placeholder="Personal workspace"
                className="min-w-0 flex-1 rounded-lg border border-theme-border bg-panel px-2.5 py-2 text-sm text-heading outline-none"
                onChange={(event) => onWorkspaceLabelChange(event.target.value)}
              />
              <input
                type="color"
                value={workspaceLabelColor}
                aria-label="Çalışma alanı başlık rengi"
                className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
                onChange={(event) => onWorkspaceLabelColorChange(event.target.value)}
              />
            </div>
          </label>
          <button
            type="button"
            className="mt-1 w-full cursor-pointer rounded-xl border border-red-400/60 bg-red-500/70 p-2 font-semibold text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-500/85"
            onClick={resetColors}
          >
            Tema Varsayılanına Dön
          </button>
        </div>
      )}
    </div>
  );
}
