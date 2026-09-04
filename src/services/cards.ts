export const CARD_VISIBILITY_KEY = 'dashboard-card-visibility-v1';
export const MEDIA_CONTROLS_ENABLED_KEY = 'dashboard-media-controls-enabled-v1';
export const DEFAULT_CARD_ORDER = ['shortcuts', 'media', 'tasks', 'dateTracker', 'notes', 'calculator', 'timeTools'] as const;
export type CardId = (typeof DEFAULT_CARD_ORDER)[number];
export type CardVisibility = Record<CardId, boolean>;

export function cardTitleKey(cardId: CardId) {
  if (cardId === 'shortcuts') return 'shortcuts.title';
  if (cardId === 'media') return 'media.title';
  if (cardId === 'tasks') return 'tasks.title';
  if (cardId === 'dateTracker') return 'dateTracker.title';
  if (cardId === 'notes') return 'note.title';
  if (cardId === 'calculator') return 'calculator.title';
  return 'timeTools.title';
}

export function parseCardVisibility(stored: string | null, legacyMedia: string | null): CardVisibility {
  const visibility: CardVisibility = {
    shortcuts: true, media: legacyMedia !== 'false', tasks: true,
    dateTracker: true, notes: true, calculator: true, timeTools: true,
  };
  try {
    const parsed: unknown = JSON.parse(stored ?? 'null');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const card of DEFAULT_CARD_ORDER) {
        const value = (parsed as Record<string, unknown>)[card];
        if (typeof value === 'boolean') visibility[card] = value;
      }
    }
  } catch {
    // Older settings and malformed values retain the default card layout.
  }
  return visibility;
}

export function reorderVisibleCards(
  order: CardId[], visibility: CardVisibility, active: CardId, over: CardId,
): CardId[] {
  const visible = order.filter((card) => visibility[card]);
  const from = visible.indexOf(active);
  const to = visible.indexOf(over);
  if (from < 0 || to < 0 || from === to) return order;
  visible.splice(to, 0, visible.splice(from, 1)[0]);
  let index = 0;
  // Keep hidden cards in their saved slots so enabling them restores their position.
  return order.map((card) => visibility[card] ? visible[index++] : card);
}
