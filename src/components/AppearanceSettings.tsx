import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import type { ThemeMode } from '../types/app';
import { useLanguage } from '../i18n';

const STORAGE_KEY = 'dashboard-custom-colors-v1';
const DEFAULT_BACKGROUND = '#0f172a';
const DEFAULT_CARDS = '#172033';
const DEFAULT_HEADINGS = '#f8fafc';
const DEFAULT_INFO = '#94a3b8';
const DEFAULT_WORKSPACE_LABEL_COLOR = '#0e1a45';
const ABOUT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1';

interface CustomColors {
  background: string;
  backgroundTransparency: number;
  cards: string;
  headings: string;
  info: string;
}

interface AppearanceSettingsProps {
  readonly theme: ThemeMode;
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
  theme,
  windowDecorations,
  onWindowDecorationsChange,
  workspaceLabel,
  workspaceLabelColor,
  onWorkspaceLabelChange,
  onWorkspaceLabelColorChange,
}: AppearanceSettingsProps) {
  const { language, setLanguage, t } = useLanguage();
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
    applyColors(isCustomized && theme === 'dark' ? colors : null);
    if (isCustomized) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
    }
  }, [colors, isCustomized, theme]);

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
        aria-label={t('settings.open')}
        title={t('settings.title')}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {isOpen && (
        <div className="absolute top-[calc(100%+10px)] right-0 z-10 max-h-[calc(100vh-90px)] w-[240px] overflow-y-auto rounded-2xl border border-theme-border bg-card p-3.5 shadow-[var(--shadow)]">
          <h2 className="mb-3 text-sm font-bold text-heading">{t('settings.title')}</h2>
          <label className="mb-3 block text-sm text-heading">
            <span className="mb-1.5 block">{t('settings.language')}</span>
            <select
              value={language}
              className="w-full cursor-pointer rounded-lg border border-theme-border bg-panel px-2.5 py-2 text-sm text-heading outline-none focus:border-theme-accent"
              onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'tr')}
            >
              <option value="tr">{t('settings.turkish')}</option>
              <option value="en">{t('settings.english')}</option>
            </select>
          </label>
          <label className="mb-2.5 flex items-center justify-between gap-3.5 text-sm text-heading">
            <span>{t('settings.background')}</span>
            <input
              className="h-8 w-11 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
              type="color"
              value={colors.background}
              onChange={(event) => updateColor('background', event.target.value)}
            />
          </label>
          <label className="mb-2.5 block text-sm text-heading">
            <span className="mb-1.5 flex items-center justify-between">
              <span>{t('settings.backgroundTransparency')}</span>
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
            <span>{t('settings.cards')}</span>
            <input
              className="h-8 w-11 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
              type="color"
              value={colors.cards}
              onChange={(event) => updateColor('cards', event.target.value)}
            />
          </label>
          <label className="mb-2.5 flex items-center justify-between gap-3.5 text-sm text-heading">
            <span>{t('settings.cardHeadings')}</span>
            <input
              className="h-8 w-11 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
              type="color"
              value={colors.headings}
              onChange={(event) => updateColor('headings', event.target.value)}
            />
          </label>
          <label className="mb-2.5 flex items-center justify-between gap-3.5 text-sm text-heading">
            <span>{t('settings.infoText')}</span>
            <input
              className="h-8 w-11 cursor-pointer rounded-lg border border-theme-border bg-transparent p-0.5"
              type="color"
              value={colors.info}
              onChange={(event) => updateColor('info', event.target.value)}
            />
          </label>
          <label className="mb-2.5 flex cursor-pointer items-center justify-between gap-3.5 text-sm text-heading">
            <span>{t('settings.windowsFrame')}</span>
            <input
              type="checkbox"
              checked={windowDecorations}
              className="size-4 cursor-pointer accent-theme-accent"
              onChange={(event) => onWindowDecorationsChange(event.target.checked)}
            />
          </label>
          <label className="mb-2.5 block text-sm text-heading">
            <span className="mb-1.5 block">{t('settings.workspaceTitle')}</span>
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
                aria-label={t('settings.workspaceTitleColor')}
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
            {t('settings.resetTheme')}
          </button>
          <section className="mt-4 border-t border-theme-border pt-3" aria-labelledby="about-heading">
            <h3 id="about-heading" className="text-sm font-bold text-heading">{t('settings.about')}</h3>
            <p className="mt-2 text-xs leading-5 text-info">
              {t('settings.aboutText')}
            </p>
            <div
              className="mx-auto mt-3 w-fit rounded-xl bg-white p-2 shadow-[0_8px_22px_rgba(15,23,42,0.16)]"
              role="img"
              aria-label={t('settings.qrLabel')}
              title={ABOUT_URL}
            >
              <QRCode
                value={ABOUT_URL}
                size={132}
                level="M"
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
