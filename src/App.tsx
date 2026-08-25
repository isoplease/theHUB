import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './App.css';
import { AppearanceSettings } from './components/AppearanceSettings';
import { DateTimeDisplay } from './components/DateTimeDisplay';
import { PathShortcuts } from './components/PathShortcuts';
import { QuickNote } from './components/QuickNote';
import { TimeTools } from './components/TimeTools';
import { TodoList } from './components/TodoList';
import { storageService } from './services/storage';
import {
  startReminderService,
  TODO_REMINDER_BALLOON_EVENT,
  type TodoReminderBalloonDetail,
} from './services/reminders';
import type { ThemeMode } from './types/app';
import appIcon from '../icons/thehub-icon.png';
import { useLanguage } from './i18n';

const Calculator = lazy(() => import('./components/Calculator').then((module) => ({
  default: module.Calculator,
})));

const WINDOW_DECORATIONS_KEY = 'dashboard-window-decorations-v1';
const WORKSPACE_LABEL_KEY = 'dashboard-workspace-label-v1';
const WORKSPACE_LABEL_COLOR_KEY = 'dashboard-workspace-label-color-v1';
const CARD_ORDER_KEY = 'dashboard-card-order-v1';
const DEFAULT_CARD_ORDER = ['shortcuts', 'tasks', 'notes', 'calculator', 'timeTools'] as const;
const LEGACY_CARD_ORDER = ['tasks', 'notes', 'calculator', 'timeTools'] as const;
type CardId = (typeof DEFAULT_CARD_ORDER)[number];

function cardTitleKey(cardId: CardId) {
  if (cardId === 'shortcuts') return 'shortcuts.title';
  if (cardId === 'tasks') return 'tasks.title';
  if (cardId === 'notes') return 'note.title';
  if (cardId === 'calculator') return 'calculator.title';
  return 'timeTools.title';
}

function loadCardOrder(): CardId[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(CARD_ORDER_KEY) ?? 'null');
    if (!Array.isArray(stored)) return [...DEFAULT_CARD_ORDER];

    const validCards = new Set<string>(DEFAULT_CARD_ORDER);
    if (new Set(stored).size !== stored.length
      || !stored.every((card): card is CardId => typeof card === 'string' && validCards.has(card))) {
      return [...DEFAULT_CARD_ORDER];
    }

    if (stored.length === DEFAULT_CARD_ORDER.length) return stored;
    if (
      stored.length === LEGACY_CARD_ORDER.length
      && LEGACY_CARD_ORDER.every((card) => stored.includes(card))
    ) {
      return ['shortcuts', ...stored];
    }
    return [...DEFAULT_CARD_ORDER];
  } catch {
    return [...DEFAULT_CARD_ORDER];
  }
}

interface SortableCardProps {
  readonly id: CardId;
  readonly label: string;
  readonly children: (dragHandle: ReactNode) => ReactNode;
}

function SortableCard({ id, label, children }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const dragHandle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="grid size-8 shrink-0 touch-none cursor-grab place-items-center rounded-lg border border-transparent bg-transparent text-info transition-all hover:border-theme-border hover:bg-panel hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40 active:cursor-grabbing"
      aria-label={label}
      title={label}
      {...attributes}
      {...listeners}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] fill-current">
        <circle cx="8" cy="6" r="1.4" />
        <circle cx="16" cy="6" r="1.4" />
        <circle cx="8" cy="12" r="1.4" />
        <circle cx="16" cy="12" r="1.4" />
        <circle cx="8" cy="18" r="1.4" />
        <circle cx="16" cy="18" r="1.4" />
      </svg>
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      className={`min-w-0 self-start ${isDragging ? 'relative z-20 opacity-80' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {children(dragHandle)}
    </div>
  );
}

const FRAMELESS_RESIZE_HANDLES = [
  { direction: 'North', className: 'fixed top-0 right-3 left-3 z-[60] h-1.5 cursor-n-resize' },
  { direction: 'South', className: 'fixed right-3 bottom-0 left-3 z-[60] h-1.5 cursor-s-resize' },
  { direction: 'West', className: 'fixed top-3 bottom-3 left-0 z-[60] w-1.5 cursor-w-resize' },
  { direction: 'East', className: 'fixed top-3 right-0 bottom-3 z-[60] w-1.5 cursor-e-resize' },
  { direction: 'NorthWest', className: 'fixed top-0 left-0 z-[61] size-3 cursor-nw-resize' },
  { direction: 'NorthEast', className: 'fixed top-0 right-0 z-[61] size-3 cursor-ne-resize' },
  { direction: 'SouthWest', className: 'fixed bottom-0 left-0 z-[61] size-3 cursor-sw-resize' },
  { direction: 'SouthEast', className: 'fixed right-0 bottom-0 z-[61] size-3 cursor-se-resize' },
] as const;

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function App() {
  const { t } = useLanguage();
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [todoCount, setTodoCount] = useState(0);
  const [automationCount, setAutomationCount] = useState(0);
  const [reminderBalloons, setReminderBalloons] = useState<TodoReminderBalloonDetail[]>([]);
  const [cardOrder, setCardOrder] = useState<CardId[]>(loadCardOrder);
  const cardSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [windowDecorations, setWindowDecorations] = useState(
    () => window.localStorage.getItem(WINDOW_DECORATIONS_KEY) !== 'false',
  );
  const [workspaceLabel, setWorkspaceLabel] = useState(
    () => window.localStorage.getItem(WORKSPACE_LABEL_KEY) ?? 'Personal workspace',
  );
  const [workspaceLabelColor, setWorkspaceLabelColor] = useState(
    () => window.localStorage.getItem(WORKSPACE_LABEL_COLOR_KEY) ?? '#0e1a45',
  );

  useEffect(() => {
    const showReminderBalloon = (event: Event) => {
      const detail = (event as CustomEvent<TodoReminderBalloonDetail>).detail;
      if (!detail?.id || !detail.task) return;
      setReminderBalloons((current) => (
        current.some((balloon) => balloon.id === detail.id) ? current : [...current, detail]
      ));
    };
    window.addEventListener(TODO_REMINDER_BALLOON_EVENT, showReminderBalloon);
    return () => window.removeEventListener(TODO_REMINDER_BALLOON_EVENT, showReminderBalloon);
  }, []);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('theme') as ThemeMode | null;
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setTheme(storedTheme);
    }
    void storageService.init();
    let stopReminders: (() => void) | undefined;
    void startReminderService().then((stop) => {
      stopReminders = stop;
    });
    return () => stopReminders?.();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(WINDOW_DECORATIONS_KEY, String(windowDecorations));
    if (isTauri()) {
      void (async () => {
        await invoke('prepare_main_window', { decorations: windowDecorations });
      })();
    }
  }, [windowDecorations]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_LABEL_KEY, workspaceLabel);
    window.localStorage.setItem(WORKSPACE_LABEL_COLOR_KEY, workspaceLabelColor);
  }, [workspaceLabel, workspaceLabelColor]);

  const handleCardDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setCardOrder((current) => {
      const oldIndex = current.indexOf(active.id as CardId);
      const newIndex = current.indexOf(over.id as CardId);
      if (oldIndex < 0 || newIndex < 0) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      window.localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <div className={`min-h-screen [background:var(--custom-background,linear-gradient(135deg,var(--panel)_0%,var(--surface)_100%))] font-sans text-body antialiased scheme-light dark:scheme-dark ${
      windowDecorations ? 'p-6' : 'px-6 pt-16 pb-6'
    }`}>
      {!windowDecorations && (
        <>
          {FRAMELESS_RESIZE_HANDLES.map((handle) => (
            <div
              key={handle.direction}
              className={handle.className}
              aria-hidden="true"
              onMouseDown={(event) => {
                if (event.button !== 0 || !isTauri()) return;
                event.preventDefault();
                void getCurrentWindow().startResizeDragging(handle.direction);
              }}
            />
          ))}
          <div className="fixed top-2 right-2 z-50 flex h-10 overflow-hidden rounded-xl border border-theme-border bg-card shadow-[var(--shadow)]">
          <div className="pointer-events-none flex w-12 shrink-0 select-none items-center justify-center" aria-hidden="true">
            <img className="size-9 object-contain drop-shadow-[0_0_4px_rgba(45,212,191,0.38)]" src={appIcon} alt="" draggable={false} />
          </div>
          <div
            className="flex w-24 cursor-move select-none items-center justify-center border-l border-theme-border text-xs font-semibold text-info"
            title={t('window.moveTitle')}
            onMouseDown={(event) => {
              if (event.button === 0 && isTauri()) void getCurrentWindow().startDragging();
            }}
          >
            {t('window.move')}
          </div>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-panel"
            aria-label={t('window.minimize')}
            title={t('window.minimize')}
            onClick={() => {
              if (isTauri()) void getCurrentWindow().minimize();
            }}
          >
            —
          </button>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-panel"
            aria-label={t('window.maximize')}
            title={t('window.maximize')}
            onClick={() => {
              if (isTauri()) void getCurrentWindow().toggleMaximize();
            }}
          >
            □
          </button>
          <button
            type="button"
            className="w-10 cursor-pointer border-l border-theme-border bg-transparent text-heading hover:bg-red-600 hover:text-white"
            aria-label={t('window.hideToTray')}
            title={t('window.hideToTray')}
            onClick={() => {
              if (isTauri()) void getCurrentWindow().hide();
            }}
          >
            ×
          </button>
          </div>
        </>
      )}
      <div
        className="pointer-events-none fixed top-16 right-4 z-[70] flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
      >
        {reminderBalloons.map((balloon) => (
          <aside
            key={balloon.id}
            className="reminder-balloon-alert pointer-events-auto relative overflow-hidden rounded-2xl border bg-card p-4 pr-11 before:absolute before:top-0 before:bottom-0 before:left-0 before:w-1 before:bg-red-400"
            role="status"
          >
            <p className="text-xs font-bold tracking-[0.12em] text-info uppercase">{balloon.title}</p>
            <p className="mt-1.5 break-words text-sm leading-5 font-semibold text-heading">{balloon.task}</p>
            <button
              type="button"
              className="reminder-balloon-close absolute top-2.5 right-2.5 grid size-7 cursor-pointer place-items-center rounded-lg border bg-transparent text-lg leading-none text-red-200 transition-colors hover:bg-red-400/10 hover:text-white"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={() => {
                setReminderBalloons((current) => current.filter((item) => item.id !== balloon.id));
              }}
            >
              ×
            </button>
          </aside>
        ))}
      </div>
      <header className="mb-6 flex items-center justify-between max-[900px]:items-start">
        <div>
          <p
            className="mb-1.5 text-[0.7rem] font-bold tracking-[0.24em] uppercase"
            style={{ color: workspaceLabelColor }}
          >
            {workspaceLabel || 'Personal workspace'}
          </p>
          <h1 className="text-[1.7rem] font-bold text-heading">{t('app.dashboard')}</h1>
          <div className="mt-1 flex flex-col text-[0.95rem] leading-6 font-medium text-info">
            <span>{t(todoCount === 1 ? 'app.taskCount' : 'app.tasksCount', { count: todoCount })}</span>
            <span>{t(automationCount === 1 ? 'app.automationCount' : 'app.automationsCount', { count: automationCount })}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="cursor-pointer rounded-full border-0 bg-theme-accent-bg px-3.5 py-2.5 font-semibold text-heading shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-transform duration-150 hover:-translate-y-px"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <AppearanceSettings
              theme={theme}
              windowDecorations={windowDecorations}
              onWindowDecorationsChange={setWindowDecorations}
              workspaceLabel={workspaceLabel}
              workspaceLabelColor={workspaceLabelColor}
              onWorkspaceLabelChange={setWorkspaceLabel}
              onWorkspaceLabelColorChange={setWorkspaceLabelColor}
            />
          </div>
          <DateTimeDisplay />
        </div>
      </header>

      <DndContext sensors={cardSensors} collisionDetection={closestCenter} onDragEnd={handleCardDragEnd}>
        <SortableContext items={cardOrder} strategy={verticalListSortingStrategy}>
          <main className="grid grid-cols-1 items-start gap-5">
            {cardOrder.map((cardId) => (
              <SortableCard
                key={cardId}
                id={cardId}
                label={t('cards.move', {
                  card: t(cardTitleKey(cardId)),
                })}
              >
                {(dragHandle) => {
                  if (cardId === 'shortcuts') return <PathShortcuts dragHandle={dragHandle} />;
                  if (cardId === 'tasks') {
                    return (
                      <TodoList
                        dragHandle={dragHandle}
                        onCountChange={setTodoCount}
                        onAutomationCountChange={setAutomationCount}
                      />
                    );
                  }
                  if (cardId === 'notes') return <QuickNote dragHandle={dragHandle} />;
                  if (cardId === 'calculator') {
                    return (
                      <Suspense fallback={(
                        <section className="min-h-[430px] self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
                          <div className="flex items-start justify-between gap-3">
                            <h2 className="text-[1.1rem] font-bold text-heading">{t('calculator.title')}</h2>
                            {dragHandle}
                          </div>
                          <p className="mt-2 text-sm text-info">{t('app.loading')}</p>
                        </section>
                      )}>
                        <Calculator dragHandle={dragHandle} />
                      </Suspense>
                    );
                  }
                  return <TimeTools dragHandle={dragHandle} />;
                }}
              </SortableCard>
            ))}
          </main>
        </SortableContext>
      </DndContext>
    </div>
  );
}

export default App;
