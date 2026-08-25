import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { message, open as openDialog } from '@tauri-apps/plugin-dialog';
import { useLanguage } from '../i18n';

const SHORTCUT_STORAGE_KEY = 'thehub-path-shortcuts-v1';
const SHORTCUT_SLOT_COUNT = 10;
const MAX_PATH_LENGTH = 32_768;
const MAX_ICON_DATA_URL_LENGTH = 1_500_000;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

type ShortcutKind = 'file' | 'folder';

interface PathShortcut {
  path: string;
  name: string;
  kind: ShortcutKind;
  iconDataUrl?: string;
}

function emptySlots(): Array<PathShortcut | null> {
  return Array.from({ length: SHORTCUT_SLOT_COUNT }, () => null);
}

function loadShortcuts(): Array<PathShortcut | null> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? 'null');
    if (!Array.isArray(stored)) return emptySlots();

    return emptySlots().map((_, index) => {
      const item: unknown = stored[index];
      if (!item || typeof item !== 'object') return null;
      const candidate = item as Partial<PathShortcut>;
      if (
        typeof candidate.path !== 'string'
        || candidate.path.length === 0
        || candidate.path.length > MAX_PATH_LENGTH
        || typeof candidate.name !== 'string'
        || candidate.name.length === 0
        || (candidate.kind !== 'file' && candidate.kind !== 'folder')
      ) {
        return null;
      }
      return {
        path: candidate.path,
        name: candidate.name.slice(0, 260),
        kind: candidate.kind,
        iconDataUrl: typeof candidate.iconDataUrl === 'string'
          && candidate.iconDataUrl.startsWith(PNG_DATA_URL_PREFIX)
          && candidate.iconDataUrl.length <= MAX_ICON_DATA_URL_LENGTH
          ? candidate.iconDataUrl
          : undefined,
      };
    });
  } catch {
    return emptySlots();
  }
}

function itemName(path: string): string {
  const normalizedPath = path.replaceAll(String.fromCharCode(92), '/').replace(/\/+$/, '');
  const parts = normalizedPath.split('/');
  return parts.at(-1) || path;
}

function FolderIcon({ plus = false }: { readonly plus?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="size-[30px] fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 9.5A2.5 2.5 0 0 1 6 7h7l3 3h10a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 26 26H6a2.5 2.5 0 0 1-2.5-2.5Z" />
      {plus && (
        <>
          <path d="M16 14.5v7" strokeWidth="2.2" />
          <path d="M12.5 18h7" strokeWidth="2.2" />
        </>
      )}
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="size-[28px] fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3.5h10l6 6v19H8Z" />
      <path d="M18 3.5v6h6" />
      <path d="M12 16h8M12 20h8M12 24h5" />
    </svg>
  );
}

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

async function readSystemIcon(path: string): Promise<string | undefined> {
  try {
    const icon = await invoke<string | null>('get_shortcut_icon', { path });
    return typeof icon === 'string'
      && icon.startsWith(PNG_DATA_URL_PREFIX)
      && icon.length <= MAX_ICON_DATA_URL_LENGTH
      ? icon
      : undefined;
  } catch {
    return undefined;
  }
}

interface PathShortcutsProps {
  readonly dragHandle?: ReactNode;
}

export function PathShortcuts({ dragHandle }: PathShortcutsProps) {
  const { t } = useLanguage();
  const [shortcuts, setShortcuts] = useState(loadShortcuts);
  const [selectingSlot, setSelectingSlot] = useState<number | null>(null);

  useEffect(() => {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
  }, [shortcuts]);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    const storedShortcuts = loadShortcuts();
    void Promise.all(storedShortcuts.map(async (shortcut, index) => (
      shortcut
        ? { index, path: shortcut.path, iconDataUrl: await readSystemIcon(shortcut.path) }
        : null
    ))).then((icons) => {
      if (cancelled) return;
      setShortcuts((current) => current.map((shortcut, index) => {
        const refreshed = icons[index];
        return shortcut && refreshed?.iconDataUrl && shortcut.path === refreshed.path
          ? { ...shortcut, iconDataUrl: refreshed.iconDataUrl }
          : shortcut;
      }));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const choosePath = async (index: number, kind: ShortcutKind) => {
    setSelectingSlot(null);
    if (!isTauri()) {
      await message(t('shortcuts.desktopOnly'), { title: 'theHUB', kind: 'info' }).catch(() => undefined);
      return;
    }

    try {
      const selected = await openDialog({
        multiple: false,
        directory: kind === 'folder',
        title: t(kind === 'folder' ? 'shortcuts.selectFolder' : 'shortcuts.selectFile'),
      });
      if (typeof selected !== 'string' || !selected) return;

      const iconDataUrl = await readSystemIcon(selected);

      setShortcuts((current) => current.map((shortcut, slotIndex) => (
        slotIndex === index
          ? { path: selected, name: itemName(selected), kind, iconDataUrl }
          : shortcut
      )));
    } catch {
      await message(t('shortcuts.selectError'), { title: 'theHUB', kind: 'error' }).catch(() => undefined);
    }
  };

  const openShortcut = async (shortcut: PathShortcut) => {
    try {
      await invoke('open_shortcut_path', { path: shortcut.path });
    } catch {
      await message(t('shortcuts.openError', { name: shortcut.name }), {
        title: 'theHUB',
        kind: 'error',
      }).catch(() => undefined);
    }
  };

  const removeShortcut = (index: number) => {
    setSelectingSlot(null);
    setShortcuts((current) => current.map((shortcut, slotIndex) => (
      slotIndex === index ? null : shortcut
    )));
  };

  return (
    <section className="self-start rounded-3xl border border-theme-border bg-card p-4 shadow-[var(--shadow)]" aria-label={t('shortcuts.label')}>
      <div className="flex items-stretch justify-center gap-2">
        <div className="path-shortcuts-grid min-w-0">
        {shortcuts.map((shortcut, index) => (
        <div key={index} className="group relative">
          <button
            type="button"
            className={`grid size-9 cursor-pointer place-items-center rounded-lg border bg-panel transition-all duration-150 hover:-translate-y-px hover:border-theme-accent hover:bg-theme-accent-bg hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/35 ${
              shortcut ? 'border-theme-border text-info' : 'border-dashed border-theme-border text-info/80'
            }`}
            aria-label={shortcut
              ? t('shortcuts.openNamed', { name: shortcut.name })
              : t('shortcuts.add', { slot: index + 1 })}
            title={shortcut ? `${shortcut.name}
${shortcut.path}` : t('shortcuts.add', { slot: index + 1 })}
            onClick={() => {
              if (shortcut) void openShortcut(shortcut);
              else setSelectingSlot((current) => (current === index ? null : index));
            }}
          >
            {shortcut?.iconDataUrl ? (
              <img
                src={shortcut.iconDataUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="pointer-events-none size-8 select-none object-contain"
              />
            ) : shortcut?.kind === 'file' ? <FileIcon /> : <FolderIcon plus={!shortcut} />}
          </button>

          {shortcut && (
            <button
              type="button"
              className="absolute -top-2 right-0 z-10 grid size-4 cursor-pointer place-items-center rounded-full border border-red-300/60 bg-card text-[11px] leading-none text-red-300 opacity-0 shadow-sm transition-opacity hover:bg-red-500/15 hover:text-white group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
              aria-label={t('shortcuts.removeNamed', { name: shortcut.name })}
              title={t('shortcuts.removeNamed', { name: shortcut.name })}
              onClick={(event) => {
                event.stopPropagation();
                removeShortcut(index);
              }}
            >
              ×
            </button>
          )}

          {!shortcut && selectingSlot === index && (
            <div className={`absolute top-11 z-50 flex w-28 flex-col gap-1 rounded-xl border border-theme-border bg-card p-1.5 shadow-[var(--shadow)] ${
              index % 5 < 2 ? 'left-0' : index % 5 > 2 ? 'right-0' : 'left-1/2 -translate-x-1/2'
            }`}>
              <button
                type="button"
                className="cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-heading hover:bg-theme-accent-bg"
                onClick={() => void choosePath(index, 'folder')}
              >
                {t('shortcuts.folder')}
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-heading hover:bg-theme-accent-bg"
                onClick={() => void choosePath(index, 'file')}
              >
                {t('shortcuts.file')}
              </button>
            </div>
          )}
        </div>
        ))}
        </div>
        <div className="flex shrink-0 items-center border-l border-theme-border pl-2">
          {dragHandle}
        </div>
      </div>
    </section>
  );
}
