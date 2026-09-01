import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { MAX_NOTE_LENGTH, MAX_NOTE_STORAGE_LENGTH, storageService } from '../services/storage';
import {
  backupNote,
  exportNoteText,
  readNoteRecoveryBackup,
  saveNoteRecoverySnapshot,
} from '../services/noteExport';
import type { NoteExportFormat } from '../services/noteExport';
import { useLanguage } from '../i18n';
import { VisibilityToggle } from './VisibilityToggle';

const RICH_NOTE_PREFIX = 'dashboard-rich-note-v1:';
const NOTE_HEIGHT_KEY = 'dashboard-quick-note-height-v1';
const CONCEALED_NOTE_LINES_KEY = 'dashboard-quick-note-concealed-lines-v1';
const ACTIVE_NOTE_WORKSPACE_KEY = 'dashboard-quick-note-active-workspace-v1';
const CARET_SENTINEL = '\u200B';
const DEFAULT_NOTE_HEIGHT = 230;
const MIN_NOTE_HEIGHT = 160;
const MAX_NOTE_HEIGHT = 720;
const NOTE_WORKSPACES = [1, 2, 3, 4] as const;
type NoteWorkspaceId = (typeof NOTE_WORKSPACES)[number];
const NOTE_WORKSPACE_LABELS: Record<NoteWorkspaceId, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
};

function workspaceStorageKey(baseKey: string, workspaceId: NoteWorkspaceId): string {
  return workspaceId === 1 ? baseKey : `${baseKey}-${workspaceId}`;
}

function loadConcealedNoteLines(workspaceId: NoteWorkspaceId): Set<number> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(
      workspaceStorageKey(CONCEALED_NOTE_LINES_KEY, workspaceId),
    ) ?? '[]');
    if (!Array.isArray(stored)) return new Set();
    return new Set(stored.filter((value): value is number => (
      Number.isInteger(value) && value >= 0 && value < MAX_NOTE_LENGTH
    )));
  } catch {
    return new Set();
  }
}

interface NoteLineGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface NoteCaretGeometry {
  top: number;
  left: number;
  height: number;
}

interface InlineNoteFormat {
  markerColor?: string;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
}

interface SelectedTextSegment {
  node: Text;
  start: number;
  end: number;
}

const MARKER_COLORS = [
  { nameKey: 'color.yellow', value: '#fde047' },
  { nameKey: 'color.green', value: '#4ade80' },
  { nameKey: 'color.blue', value: '#60a5fa' },
  { nameKey: 'color.purple', value: '#c084fc' },
  { nameKey: 'color.red', value: '#f87171' },
  { nameKey: 'color.orange', value: '#fb923c' },
  { nameKey: 'color.pink', value: '#f472b6' },
  { nameKey: 'color.turquoise', value: '#2dd4bf' },
] as const;

function normalizeColor(value: string): string {
  const candidate = value.trim().toLowerCase();
  const longHex = candidate.match(/^#([0-9a-f]{6})$/);
  if (longHex) return `#${longHex[1]}`;
  const shortHex = candidate.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (shortHex) return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;
  const rgb = candidate.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return `#${rgb.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`;
  }

  const probe = document.createElement('span');
  probe.style.color = candidate;
  const normalized = probe.style.color.toLowerCase();
  const normalizedRgb = normalized.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return normalizedRgb
    ? `#${normalizedRgb.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`
    : '';
}

function noteTextColor(element: HTMLElement): string {
  const storedColor = element.dataset.noteColor;
  return normalizeColor(storedColor && storedColor !== 'true' ? storedColor : element.style.color);
}

function restoreStoredNoteStyles(editor: HTMLElement): void {
  const allowedMarkerColors = new Set<string>(MARKER_COLORS.map(({ value }) => value));
  editor.querySelectorAll<HTMLElement>('[data-marker-color]').forEach((marker) => {
    const color = normalizeColor(marker.dataset.markerColor ?? '');
    if (!allowedMarkerColors.has(color)) return;
    marker.dataset.markerColor = color;
    marker.style.setProperty('background-color', color, 'important');
    marker.style.setProperty('color', '#111827', 'important');
  });
  editor.querySelectorAll<HTMLElement>('[data-note-color]').forEach((text) => {
    const color = noteTextColor(text);
    if (!color) return;
    text.dataset.noteColor = color;
    text.style.setProperty('color', color, 'important');
  });
}

function unwrapElement(element: HTMLElement) {
  element.replaceWith(...Array.from(element.childNodes));
}

function normalizeMarkerElements(container: ParentNode) {
  Array.from(container.querySelectorAll('mark')).forEach((marker) => {
    if (!marker.textContent && !marker.querySelector('br')) marker.remove();
  });
}

function normalizeNoteColorElements(container: ParentNode) {
  Array.from(container.querySelectorAll('span[data-note-color]')).reverse().forEach((span) => {
    const element = span as HTMLElement;
    const onlyChild = element.childNodes.length === 1 ? element.firstElementChild : null;
    if (onlyChild instanceof HTMLElement && onlyChild.matches('span[data-note-color]')) {
      unwrapElement(element);
      return;
    }
    const parent = element.parentElement;
    if (parent?.matches('span[data-note-color]')
      && noteTextColor(parent) === noteTextColor(element)) {
      unwrapElement(element);
    }
  });

  Array.from(container.querySelectorAll('span[data-note-color]')).forEach((span) => {
    const element = span as HTMLElement;
    let next = element.nextSibling;
    while (next instanceof HTMLElement
      && next.matches('span[data-note-color]')
      && noteTextColor(next) === noteTextColor(element)) {
      while (next.firstChild) element.appendChild(next.firstChild);
      const following = next.nextSibling;
      next.remove();
      next = following;
    }
    if (!element.textContent && !element.querySelector('br')) element.remove();
  });
}

function removeEmptyListArtifacts(container: ParentNode) {
  Array.from(container.querySelectorAll('li')).forEach((item) => {
    const hasText = (item.textContent ?? '').replaceAll(CARET_SENTINEL, '').trim().length > 0;
    if (hasText || item.querySelector('br')) return;

    const list = item.parentElement;
    const wrapper = list?.parentElement;
    item.remove();
    if (list && !list.querySelector('li')) {
      list.remove();
      if (wrapper?.matches('div, p')
        && wrapper.childNodes.length === 0
        && !(wrapper.textContent ?? '').replaceAll(CARET_SENTINEL, '').trim()) {
        wrapper.remove();
      }
    }
  });
}

function sanitizeNoteHtml(html: string): string {
  const source = document.createElement('template');
  const output = document.createElement('div');
  const allowedColors = new Set(MARKER_COLORS.map(({ value }) => normalizeColor(value)));
  source.innerHTML = html;

  const appendFormattedText = (text: string, parent: Node, format: InlineNoteFormat) => {
    let formattedNode: Node = document.createTextNode(text);
    if (format.italic) {
      const italicText = document.createElement('em');
      italicText.appendChild(formattedNode);
      formattedNode = italicText;
    }
    if (format.bold) {
      const boldText = document.createElement('strong');
      boldText.appendChild(formattedNode);
      formattedNode = boldText;
    }
    if (format.textColor) {
      const coloredText = document.createElement('span');
      coloredText.dataset.noteColor = format.textColor;
      coloredText.style.color = format.textColor;
      coloredText.appendChild(formattedNode);
      formattedNode = coloredText;
    }
    if (format.markerColor) {
      const marker = document.createElement('mark');
      marker.dataset.markerColor = format.markerColor;
      marker.style.backgroundColor = format.markerColor;
      marker.appendChild(formattedNode);
      formattedNode = marker;
    }
    parent.appendChild(formattedNode);
  };

  const copySafeNode = (node: Node, parent: Node, format: InlineNoteFormat = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replaceAll(CARET_SENTINEL, '');
      if (text) appendFormattedText(text, parent, format);
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const tagName = node.tagName.toLowerCase();
    if (tagName === 'br') {
      parent.appendChild(document.createElement('br'));
      return;
    }

    if (tagName === 'mark') {
      const markerColor = normalizeColor(node.dataset.markerColor ?? node.style.backgroundColor);
      const nextFormat = allowedColors.has(markerColor) ? { ...format, markerColor } : format;
      Array.from(node.childNodes).forEach((child) => copySafeNode(child, parent, nextFormat));
      return;
    }
    if (tagName === 'span') {
      const markerColor = normalizeColor(node.dataset.markerColor ?? node.style.backgroundColor);
      const textColor = noteTextColor(node);
      const nextFormat = allowedColors.has(markerColor)
        ? { ...format, markerColor }
        : (textColor ? { ...format, textColor } : format);
      Array.from(node.childNodes).forEach((child) => copySafeNode(child, parent, nextFormat));
      return;
    }
    if (tagName === 'b' || tagName === 'strong') {
      Array.from(node.childNodes).forEach((child) => copySafeNode(child, parent, {
        ...format,
        bold: true,
      }));
      return;
    }
    if (tagName === 'i' || tagName === 'em') {
      Array.from(node.childNodes).forEach((child) => copySafeNode(child, parent, {
        ...format,
        italic: true,
      }));
      return;
    }

    let safeParent = parent;
    if (tagName === 'div' || tagName === 'p' || tagName === 'ol') {
      safeParent = document.createElement(tagName);
      parent.appendChild(safeParent);
    } else if (tagName === 'li') {
      const listItem = document.createElement('li');
      const isLegacyHyphenItem = node.parentElement?.tagName.toLowerCase() === 'ul'
        && node.parentElement.dataset.marker === 'hyphen';
      if (node.dataset.marker === 'hyphen' || isLegacyHyphenItem) listItem.dataset.marker = 'hyphen';
      safeParent = listItem;
      parent.appendChild(listItem);
    } else if (tagName === 'ul') {
      const list = document.createElement('ul');
      safeParent = list;
      parent.appendChild(list);
    }

    Array.from(node.childNodes).forEach((child) => copySafeNode(child, safeParent, format));
  };

  Array.from(source.content.childNodes).forEach((node) => copySafeNode(node, output));
  removeEmptyListArtifacts(output);
  normalizeMarkerElements(output);
  normalizeNoteColorElements(output);
  return output.innerHTML;
}

function rangeBelongsToEditor(editor: HTMLElement, range: Range): boolean {
  return range.startContainer.isConnected
    && range.endContainer.isConnected
    && editor.contains(range.commonAncestorContainer);
}

function selectedTextSegments(editor: HTMLElement, range: Range): SelectedTextSegment[] {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const segments: SelectedTextSegment[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.data.replaceAll(CARET_SENTINEL, '')) continue;
    try {
      if (!range.intersectsNode(node)) continue;
    } catch {
      continue;
    }
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start < end) segments.push({ node, start, end });
  }
  return segments;
}

function wrapSelectedText<T extends HTMLElement>(
  editor: HTMLElement,
  range: Range,
  createWrapper: () => T,
): T[] {
  const wrappers: T[] = [];
  [...selectedTextSegments(editor, range)].reverse().forEach(({ node, start, end }) => {
    const selectedText = start > 0 ? node.splitText(start) : node;
    if (end - start < selectedText.length) selectedText.splitText(end - start);
    const wrapper = createWrapper();
    selectedText.replaceWith(wrapper);
    wrapper.appendChild(selectedText);
    wrappers.unshift(wrapper);
  });
  return wrappers;
}

function activeEditorRange(editor: HTMLElement, storedRange: Range | null): Range | null {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const liveRange = selection.getRangeAt(0);
    if (rangeBelongsToEditor(editor, liveRange)) return liveRange.cloneRange();
  }
  return storedRange && rangeBelongsToEditor(editor, storedRange) ? storedRange.cloneRange() : null;
}

function getVisibleNoteLength(editor: HTMLElement): number {
  return editor.innerText.replaceAll(CARET_SENTINEL, '').length;
}

function normalizeStoredNote(content: string): { serialized: string; html: string } {
  if (content.startsWith(RICH_NOTE_PREFIX)) {
    const html = sanitizeNoteHtml(content.slice(RICH_NOTE_PREFIX.length));
    return { serialized: `${RICH_NOTE_PREFIX}${html}`, html };
  }

  const container = document.createElement('div');
  container.textContent = content;
  const html = container.innerHTML.replaceAll('\n', '<br>');
  return { serialized: `${RICH_NOTE_PREFIX}${html}`, html };
}

function getConcealedNoteLines(editor: HTMLElement | null): string[] {
  if (!editor) return [];
  const lines = editor.innerText
    .replaceAll(CARET_SENTINEL, '')
    .split(/\r?\n/)
    .map((line) => (line.trim() ? '- - -' : ''));
  return lines.some(Boolean) ? lines : [];
}

function measureNoteLines(editor: HTMLElement | null): NoteLineGeometry[] {
  if (!editor) return [];
  const editorRect = editor.getBoundingClientRect();
  const fragments: Array<NoteLineGeometry & { right: number }> = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    if (!(textNode.textContent ?? '').replaceAll(CARET_SENTINEL, '').trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    Array.from(range.getClientRects()).forEach((rect) => {
      if (rect.width < 1 || rect.height < 1) return;
      fragments.push({
        top: rect.top - editorRect.top,
        left: rect.left - editorRect.left,
        right: rect.right - editorRect.left,
        width: rect.width,
        height: rect.height,
      });
    });
  }

  const lines: Array<NoteLineGeometry & { right: number }> = [];
  fragments.sort((a, b) => a.top - b.top || a.left - b.left).forEach((fragment) => {
    const existing = lines.find((line) => Math.abs(line.top - fragment.top) < 3);
    if (!existing) {
      lines.push({ ...fragment });
      return;
    }
    const bottom = Math.max(existing.top + existing.height, fragment.top + fragment.height);
    existing.top = Math.min(existing.top, fragment.top);
    existing.left = Math.min(existing.left, fragment.left);
    existing.right = Math.max(existing.right, fragment.right);
    existing.width = existing.right - existing.left;
    existing.height = bottom - existing.top;
  });

  return lines.map(({ right: _right, ...line }) => line);
}

function rangeAtPoint(clientX: number, clientY: number): Range | null {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = caretDocument.caretPositionFromPoint?.(clientX, clientY);
  if (position) {
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  return caretDocument.caretRangeFromPoint?.(clientX, clientY)?.cloneRange() ?? null;
}

function blankLineAtRange(editor: HTMLElement, range: Range): HTMLElement | null {
  const anchor = range.startContainer instanceof HTMLElement
    ? range.startContainer
    : range.startContainer.parentElement;
  const line = anchor?.closest<HTMLElement>('div, p, li');
  if (!line || line === editor || !editor.contains(line)) return null;
  const visibleText = (line.textContent ?? '').replaceAll(CARET_SENTINEL, '').trim();
  return !visibleText && line.querySelector('br') ? line : null;
}

function measureHighlightedCaret(editor: HTMLElement): NoteCaretGeometry | null {
  if (document.activeElement !== editor) return null;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !rangeBelongsToEditor(editor, range)) return null;

  const anchor = range.startContainer instanceof HTMLElement
    ? range.startContainer
    : range.startContainer.parentElement;
  const marker = anchor?.closest<HTMLElement>('mark');
  if (!marker || !editor.contains(marker)) return null;

  const markerTail = document.createRange();
  markerTail.selectNodeContents(marker);
  markerTail.setStart(range.startContainer, range.startOffset);
  if (markerTail.toString().replaceAll(CARET_SENTINEL, '').length > 0) return null;

  const rects = Array.from(marker.getClientRects()).filter((rect) => rect.height > 0);
  const markerRect = rects.at(-1);
  if (!markerRect) return null;
  const editorRect = editor.getBoundingClientRect();
  return {
    top: markerRect.top - editorRect.top,
    left: markerRect.right - editorRect.left,
    height: markerRect.height,
  };
}

interface QuickNoteProps {
  readonly dragHandle?: ReactNode;
}

interface QuickNoteWorkspaceProps extends QuickNoteProps {
  readonly workspaceId: NoteWorkspaceId;
  readonly onWorkspaceChange: (workspaceId: NoteWorkspaceId) => void;
}

export function QuickNote({ dragHandle }: QuickNoteProps) {
  const [workspaceId, setWorkspaceId] = useState<NoteWorkspaceId>(() => {
    const stored = Number(window.localStorage.getItem(ACTIVE_NOTE_WORKSPACE_KEY));
    return NOTE_WORKSPACES.includes(stored as NoteWorkspaceId) ? stored as NoteWorkspaceId : 1;
  });

  const selectWorkspace = (nextWorkspaceId: NoteWorkspaceId) => {
    window.localStorage.setItem(ACTIVE_NOTE_WORKSPACE_KEY, String(nextWorkspaceId));
    setWorkspaceId(nextWorkspaceId);
  };

  return (
    <QuickNoteWorkspace
      key={workspaceId}
      dragHandle={dragHandle}
      workspaceId={workspaceId}
      onWorkspaceChange={selectWorkspace}
    />
  );
}

function QuickNoteWorkspace({ dragHandle, workspaceId, onWorkspaceChange }: QuickNoteWorkspaceProps) {
  const { language, locale, t } = useLanguage();
  const noteTooLongMessage = t('note.tooLong', { count: MAX_NOTE_LENGTH.toLocaleString(locale) });
  const [savedAt, setSavedAt] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [noteConcealed, setNoteConcealed] = useState(false);
  const [concealedLines, setConcealedLines] = useState<string[]>([]);
  const [noteLineGeometries, setNoteLineGeometries] = useState<NoteLineGeometry[]>([]);
  const [highlightedCaretGeometry, setHighlightedCaretGeometry] = useState<NoteCaretGeometry | null>(null);
  const [concealedNoteLines, setConcealedNoteLines] = useState<Set<number>>(
    () => loadConcealedNoteLines(workspaceId),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [exportingFormat, setExportingFormat] = useState<NoteExportFormat | null>(null);
  const [noteColorPickerValue, setNoteColorPickerValue] = useState('#ffffff');
  const editorRef = useRef<HTMLDivElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef('');
  const persistedContentRef = useRef('');
  const manuallySavedContentRef = useRef('');
  const hasUserEditedRef = useRef(false);
  const selectionRef = useRef<Range | null>(null);
  const savedMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const editorHeightRef = useRef(DEFAULT_NOTE_HEIGHT);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const initialTranslateRef = useRef(t);

  // The initial load must run once; language changes must not reload and replace editor state.
  useEffect(() => {
    const loadInitialNote = async () => {
      try {
        const [storedNote, recoveryBackup] = await Promise.all([
          storageService.getNote(workspaceId),
          readNoteRecoveryBackup(workspaceId),
        ]);
        const storedTime = Date.parse(storedNote?.updatedAt ?? '');
        const recoveryTime = Date.parse(recoveryBackup?.updatedAt ?? '');
        const useRecovery = recoveryBackup
          && (!storedNote || (Number.isFinite(recoveryTime) && recoveryTime > storedTime));
        const note = useRecovery
          ? { id: workspaceId, workspaceId, content: recoveryBackup.content, updatedAt: recoveryBackup.updatedAt }
          : storedNote;
        if (note) {
          const normalized = normalizeStoredNote(note.content);
          if (hasUserEditedRef.current) return;
          if (editorRef.current) {
            editorRef.current.innerHTML = normalized.html;
            restoreStoredNoteStyles(editorRef.current);
          }
          requestAnimationFrame(() => {
            if (editorRef.current) restoreStoredNoteStyles(editorRef.current);
            setNoteLineGeometries(measureNoteLines(editorRef.current));
          });
          contentRef.current = normalized.serialized;
          persistedContentRef.current = normalized.serialized;
          manuallySavedContentRef.current = normalized.serialized;
          setSavedAt(note.updatedAt);
          if (useRecovery || normalized.serialized !== note.content) {
            void storageService.saveNote(normalized.serialized, workspaceId);
            saveNoteRecoverySnapshot(normalized.serialized, new Date().toISOString(), workspaceId);
          }
        }
      } catch {
        setSaveError(initialTranslateRef.current('note.loadError'));
      }
    };
    void loadInitialNote();
    const storedHeight = Number(window.localStorage.getItem(
      workspaceStorageKey(NOTE_HEIGHT_KEY, workspaceId),
    ));
    setEditorHeight(Number.isFinite(storedHeight) && storedHeight > 0 ? storedHeight : DEFAULT_NOTE_HEIGHT);

    return () => {
      resizeCleanupRef.current?.();
      if (savedMessageTimer.current) {
        clearTimeout(savedMessageTimer.current);
      }
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let animationFrame = 0;
    const refreshCaret = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        setHighlightedCaretGeometry(measureHighlightedCaret(editor));
      });
    };
    document.addEventListener('selectionchange', refreshCaret);
    editor.addEventListener('scroll', refreshCaret, { passive: true });
    window.addEventListener('resize', refreshCaret);
    refreshCaret();
    return () => {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('selectionchange', refreshCaret);
      editor.removeEventListener('scroll', refreshCaret);
      window.removeEventListener('resize', refreshCaret);
    };
  }, []);

  useEffect(() => {
    const preserveNoteBeforeReload = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const content = `${RICH_NOTE_PREFIX}${sanitizeNoteHtml(editor.innerHTML)}`;
      if (getVisibleNoteLength(editor) <= MAX_NOTE_LENGTH && content.length <= MAX_NOTE_STORAGE_LENGTH) {
        saveNoteRecoverySnapshot(content, new Date().toISOString(), workspaceId);
      }
    };

    window.addEventListener('beforeunload', preserveNoteBeforeReload);
    window.addEventListener('pagehide', preserveNoteBeforeReload);
    return () => {
      window.removeEventListener('beforeunload', preserveNoteBeforeReload);
      window.removeEventListener('pagehide', preserveNoteBeforeReload);
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let animationFrame = 0;
    const refreshLines = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        setNoteLineGeometries(measureNoteLines(editor));
      });
    };
    const resizeObserver = new ResizeObserver(refreshLines);
    resizeObserver.observe(editor);
    editor.addEventListener('scroll', refreshLines, { passive: true });
    refreshLines();
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      editor.removeEventListener('scroll', refreshLines);
    };
  }, []);

  useEffect(() => {
    if (noteLineGeometries.length === 0) return;
    setConcealedNoteLines((current) => {
      const valid = new Set(Array.from(current).filter((index) => index < noteLineGeometries.length));
      return valid.size === current.size ? current : valid;
    });
  }, [noteLineGeometries.length]);

  useEffect(() => {
    window.localStorage.setItem(
      workspaceStorageKey(CONCEALED_NOTE_LINES_KEY, workspaceId),
      JSON.stringify(Array.from(concealedNoteLines).sort((left, right) => left - right)),
    );
  }, [concealedNoteLines, workspaceId]);

  const updateSaveIndicator = () => {
    const hasUnsavedChanges = contentRef.current !== manuallySavedContentRef.current;
    saveButtonRef.current?.classList.toggle('border-red-400', hasUnsavedChanges);
    saveButtonRef.current?.classList.toggle('border-transparent', !hasUnsavedChanges);
    saveButtonRef.current?.classList.toggle('note-save-unsaved', hasUnsavedChanges);
  };

  const setEditorHeight = (height: number, persist = false) => {
    const normalizedHeight = Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, Math.round(height)));
    editorHeightRef.current = normalizedHeight;
    if (editorRef.current) editorRef.current.style.height = `${normalizedHeight}px`;
    resizeHandleRef.current?.setAttribute('aria-valuenow', String(normalizedHeight));
    if (persist) window.localStorage.setItem(
      workspaceStorageKey(NOTE_HEIGHT_KEY, workspaceId),
      String(normalizedHeight),
    );
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !editorRef.current) return;
    event.preventDefault();
    resizeCleanupRef.current?.();

    const startY = event.clientY;
    const startHeight = editorRef.current.getBoundingClientRect().height;
    const handlePointerMove = (pointerEvent: PointerEvent) => {
      setEditorHeight(startHeight + pointerEvent.clientY - startY);
    };
    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      window.localStorage.setItem(
        workspaceStorageKey(NOTE_HEIGHT_KEY, workspaceId),
        String(editorHeightRef.current),
      );
      resizeCleanupRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    resizeCleanupRef.current = stopResize;
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setEditorHeight(editorHeightRef.current + (event.key === 'ArrowDown' ? 20 : -20), true);
  };

  const syncEditorContent = () => {
    const editor = editorRef.current;
    if (!editor) return;
    hasUserEditedRef.current = true;
    if (!editor.textContent && !editor.querySelector('br, mark')) editor.innerHTML = '';

    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (rangeBelongsToEditor(editor, range)) selectionRef.current = range.cloneRange();
    }

    const serialized = `${RICH_NOTE_PREFIX}${sanitizeNoteHtml(editor.innerHTML)}`;
    if (getVisibleNoteLength(editor) <= MAX_NOTE_LENGTH && serialized.length <= MAX_NOTE_STORAGE_LENGTH) {
      contentRef.current = serialized;
      setSaveError('');
      updateSaveIndicator();
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        autoSaveTimerRef.current = null;
        void saveCurrentNote(false);
      }, 1500);
    } else {
      setSaveError(noteTooLongMessage);
      saveButtonRef.current?.classList.add('border-red-400');
      saveButtonRef.current?.classList.remove('border-transparent');
      saveButtonRef.current?.classList.add('note-save-unsaved');
    }
    requestAnimationFrame(() => setNoteLineGeometries(measureNoteLines(editor)));
  };

  const rememberSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };

  const handleEditorDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor || noteConcealed || event.button !== 0) return;

    const selection = window.getSelection();
    const pointRange = rangeAtPoint(event.clientX, event.clientY);
    if (!selection || !pointRange || !rangeBelongsToEditor(editor, pointRange)) return;

    const blankLine = blankLineAtRange(editor, pointRange);
    if (blankLine) {
      event.preventDefault();
      editor.focus();
      pointRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(pointRange);
      selectionRef.current = pointRange.cloneRange();
      return;
    }

    const editorRect = editor.getBoundingClientRect();
    const styles = window.getComputedStyle(editor);
    const fontSize = Number.parseFloat(styles.fontSize) || 16;
    const parsedLineHeight = Number.parseFloat(styles.lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.5;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const contentRange = document.createRange();
    contentRange.selectNodeContents(editor);
    const contentRects = Array.from(contentRange.getClientRects()).filter((rect) => (
      rect.height > 0 && rect.bottom >= editorRect.top && rect.top <= editorRect.bottom
    ));
    const fallbackBottom = editorRect.top + paddingTop + lineHeight;
    const contentBottom = contentRects.reduce(
      (bottom, rect) => Math.max(bottom, rect.bottom),
      fallbackBottom,
    );

    if (event.clientY <= contentBottom + lineHeight * 0.35) {
      return;
    }

    event.preventDefault();
    editor.focus();
    const editorIsEmpty = !editor.textContent?.replaceAll(CARET_SENTINEL, '').trim()
      && !editor.querySelector('br, li');
    const requestedLines = editorIsEmpty
      ? Math.floor((event.clientY - editorRect.top - paddingTop) / lineHeight) + 1
      : Math.ceil((event.clientY - contentBottom) / lineHeight);
    const linesToAdd = Math.min(100, Math.max(1, requestedLines));
    const fragment = document.createDocumentFragment();
    let targetLine: HTMLDivElement | null = null;
    for (let index = 0; index < linesToAdd; index += 1) {
      targetLine = document.createElement('div');
      targetLine.appendChild(document.createElement('br'));
      fragment.appendChild(targetLine);
    }
    editor.appendChild(fragment);
    if (!targetLine) return;

    const targetRange = document.createRange();
    targetRange.setStart(targetLine, 0);
    targetRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(targetRange);
    selectionRef.current = targetRange.cloneRange();
    syncEditorContent();
  };

  const breakOutOfMarkerOnEnter = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    selection: Selection,
    range: Range,
  ): boolean => {
    if (!range.collapsed) return false;

    const anchorElement = range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement;
    const marker = anchorElement?.closest<HTMLElement>('mark');
    if (!marker || !editorRef.current?.contains(marker)) return false;

    const markerTail = document.createRange();
    markerTail.selectNodeContents(marker);
    markerTail.setStart(range.startContainer, range.startOffset);
    if (markerTail.toString().replaceAll(CARET_SENTINEL, '').length > 0) return false;

    event.preventDefault();
    const lineBreak = document.createElement('br');
    const caretAnchor = document.createTextNode(CARET_SENTINEL);
    const insertionRange = document.createRange();
    insertionRange.setStartAfter(marker);
    insertionRange.collapse(true);
    insertionRange.insertNode(lineBreak);
    lineBreak.after(caretAnchor);

    const caretRange = document.createRange();
    caretRange.setStart(caretAnchor, CARET_SENTINEL.length);
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);
    selectionRef.current = caretRange.cloneRange();
    syncEditorContent();
    return true;
  };

  const removeListMarkerAtCaret = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    selection: Selection,
    range: Range,
  ): boolean => {
    const editor = editorRef.current;
    if (!editor || !range.collapsed) return false;

    const anchorElement = range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement;
    const listItem = anchorElement?.closest<HTMLLIElement>('li');
    const list = listItem?.parentElement;
    if (!listItem || !(list instanceof HTMLUListElement) || !editor.contains(list)) return false;

    const contentBeforeCaret = document.createRange();
    contentBeforeCaret.selectNodeContents(listItem);
    contentBeforeCaret.setEnd(range.startContainer, range.startOffset);
    if (contentBeforeCaret.toString().replaceAll(CARET_SENTINEL, '').length > 0) return false;

    event.preventDefault();
    const parent = list.parentNode;
    if (!parent) return false;

    const plainLine = document.createElement('div');
    while (listItem.firstChild) plainLine.appendChild(listItem.firstChild);
    if (!plainLine.firstChild) plainLine.appendChild(document.createElement('br'));

    const trailingList = list.cloneNode(false) as HTMLUListElement;
    let nextItem = listItem.nextSibling;
    while (nextItem) {
      const followingItem = nextItem.nextSibling;
      trailingList.appendChild(nextItem);
      nextItem = followingItem;
    }
    listItem.remove();

    if (list.children.length > 0) parent.insertBefore(plainLine, list.nextSibling);
    else {
      parent.insertBefore(plainLine, list);
      list.remove();
    }
    if (trailingList.children.length > 0) parent.insertBefore(trailingList, plainLine.nextSibling);

    const plainRange = document.createRange();
    plainRange.selectNodeContents(plainLine);
    plainRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(plainRange);
    selectionRef.current = plainRange.cloneRange();
    syncEditorContent();
    return true;
  };

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    if (event.key === 'Enter' && !event.shiftKey && breakOutOfMarkerOnEnter(event, selection, range)) return;
    if (event.key === 'Backspace' && removeListMarkerAtCaret(event, selection, range)) return;
    if (event.key !== 'Tab') return;
    event.preventDefault();

    if (event.shiftKey && range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text;
      const previousPosition = range.startOffset - 1;
      const tabPosition = textNode.data[previousPosition] === '\t'
        ? previousPosition
        : (textNode.data[range.startOffset] === '\t' ? range.startOffset : -1);
      if (tabPosition >= 0) {
        textNode.deleteData(tabPosition, 1);
        const wrapper = textNode.parentElement;
        if (!textNode.data && wrapper?.tagName === 'SPAN' && wrapper.parentNode) {
          const parent = wrapper.parentNode;
          const wrapperPosition = Array.from(parent.childNodes).indexOf(wrapper);
          wrapper.remove();
          range.setStart(parent, wrapperPosition);
        } else {
          range.setStart(textNode, tabPosition);
        }
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else if (!event.shiftKey) {
      document.execCommand('insertText', false, '\t');
    }

    if (selection.rangeCount) selectionRef.current = selection.getRangeAt(0).cloneRange();
    syncEditorContent();
  };

  const applyMarker = (color: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const range = activeEditorRange(editor, selectionRef.current);
    if (!range || range.collapsed) return;

    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const markers = wrapSelectedText(editor, range, () => {
      const marker = document.createElement('mark');
      marker.dataset.markerColor = color;
      marker.style.backgroundColor = color;
      return marker;
    });
    if (markers.length === 0) return;

    const markedRange = document.createRange();
    markedRange.setStartBefore(markers[0]);
    markedRange.setEndAfter(markers[markers.length - 1]);
    selection?.removeAllRanges();
    selection?.addRange(markedRange);
    selectionRef.current = markedRange.cloneRange();
    syncEditorContent();
  };

  const applyNoteTextColor = (color: string) => {
    setNoteColorPickerValue(color);
    const editor = editorRef.current;
    if (!editor) return;
    const range = activeEditorRange(editor, selectionRef.current);
    if (!range || range.collapsed) return;

    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const coloredSpans = wrapSelectedText(editor, range, () => {
      const coloredSpan = document.createElement('span');
      coloredSpan.dataset.noteColor = color;
      coloredSpan.style.color = color;
      return coloredSpan;
    });
    if (coloredSpans.length === 0) return;

    const coloredRange = document.createRange();
    coloredRange.setStartBefore(coloredSpans[0]);
    coloredRange.setEndAfter(coloredSpans[coloredSpans.length - 1]);
    selection?.removeAllRanges();
    selection?.addRange(coloredRange);
    selectionRef.current = coloredRange.cloneRange();
    syncEditorContent();
  };

  const applyInlineStyle = (style: 'bold' | 'italic') => {
    const editor = editorRef.current;
    if (!editor) return;
    const range = activeEditorRange(editor, selectionRef.current);
    if (!range || range.collapsed) return;

    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('styleWithCSS', false, 'false');
    if (!document.execCommand(style, false)) return;
    rememberSelection();
    syncEditorContent();
  };

  const applyListStyle = (style: 'bullet' | 'hyphen') => {
    const editor = editorRef.current;
    if (!editor) return;
    const range = activeEditorRange(editor, selectionRef.current);

    editor.focus();
    const selection = window.getSelection();
    if (range) {
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      const endRange = document.createRange();
      endRange.selectNodeContents(editor);
      endRange.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(endRange);
    }

    const anchorElement = selection?.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    let listItem = anchorElement?.closest<HTMLLIElement>('li');
    let list = listItem?.parentElement instanceof HTMLUListElement ? listItem.parentElement : null;
    if (!list || !editor.contains(list)) {
      document.execCommand('insertUnorderedList');
      const updatedAnchor = selection?.anchorNode instanceof HTMLElement
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      listItem = updatedAnchor?.closest<HTMLLIElement>('li');
      list = listItem?.parentElement instanceof HTMLUListElement ? listItem.parentElement : null;
    }

    if (list && listItem && editor.contains(list)) {
      if (list.dataset.marker === 'hyphen') {
        Array.from(list.children).forEach((child) => {
          if (child instanceof HTMLLIElement) child.dataset.marker = 'hyphen';
        });
        delete list.dataset.marker;
      }
      if (style === 'hyphen') listItem.dataset.marker = 'hyphen';
      else delete listItem.dataset.marker;
    }

    rememberSelection();
    syncEditorContent();
  };

  const clearMarker = () => {
    const editor = editorRef.current;
    const range = selectionRef.current;
    if (!editor || !range || range.collapsed) return;

    const markers = Array.from(editor.querySelectorAll('mark')).filter((marker) => {
      try {
        return range.intersectsNode(marker);
      } catch {
        return false;
      }
    });

    markers.forEach((marker) => {
      marker.replaceWith(...Array.from(marker.childNodes));
    });
    selectionRef.current = null;
    editor.focus();
    syncEditorContent();
  };

  const saveCurrentNote = async (showConfirmation: boolean) => {
    const currentHtml = sanitizeNoteHtml(editorRef.current?.innerHTML ?? '');
    const currentContent = `${RICH_NOTE_PREFIX}${currentHtml}`;
    const plainText = (editorRef.current?.innerText ?? '').replaceAll(CARET_SENTINEL, '');
    const visibleLength = plainText.length;
    if (visibleLength > MAX_NOTE_LENGTH || currentContent.length > MAX_NOTE_STORAGE_LENGTH) {
      setSaveError(noteTooLongMessage);
      return;
    }
    if (!showConfirmation && currentContent === persistedContentRef.current) return;

    contentRef.current = currentContent;
    if (showConfirmation) setIsSaving(true);
    setSaveError('');
    const saveJob = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const note = await storageService.saveNote(currentContent, workspaceId);
        persistedContentRef.current = note.content;
        if (showConfirmation) manuallySavedContentRef.current = note.content;
        updateSaveIndicator();
        setSavedAt(note.updatedAt);

        try {
          await backupNote(plainText, note.content, note.updatedAt, workspaceId);
        } catch {
          setSaveError(t('note.backupError'));
        }

        if (showConfirmation) {
          setShowSaved(true);
          if (savedMessageTimer.current) clearTimeout(savedMessageTimer.current);
          savedMessageTimer.current = setTimeout(() => {
            setShowSaved(false);
            savedMessageTimer.current = null;
          }, 2000);
        }
      });
    saveQueueRef.current = saveJob.then(() => undefined, () => undefined);

    try {
      await saveJob;
    } catch {
      setSaveError(t('note.saveError'));
    } finally {
      if (showConfirmation) setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    await saveCurrentNote(true);
  };

  const changeWorkspace = async (nextWorkspaceId: NoteWorkspaceId) => {
    if (nextWorkspaceId === workspaceId) return;
    const editor = editorRef.current;
    const currentContent = `${RICH_NOTE_PREFIX}${sanitizeNoteHtml(editor?.innerHTML ?? '')}`;
    if ((editor && getVisibleNoteLength(editor) > MAX_NOTE_LENGTH)
      || currentContent.length > MAX_NOTE_STORAGE_LENGTH) {
      setSaveError(noteTooLongMessage);
      return;
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    saveNoteRecoverySnapshot(currentContent, new Date().toISOString(), workspaceId);
    await saveCurrentNote(false);
    onWorkspaceChange(nextWorkspaceId);
  };

  const handleExport = async (format: NoteExportFormat) => {
    const plainText = (editorRef.current?.innerText ?? '').replaceAll(CARET_SENTINEL, '');
    setExportingFormat(format);
    setExportStatus('');
    try {
      const result = await exportNoteText(plainText, format, language, workspaceId);
      if (result === 'saved') setExportStatus(t('note.exported'));
    } catch {
      setExportStatus(t('note.exportError'));
    } finally {
      setExportingFormat(null);
    }
  };

  const toggleNoteVisibility = () => {
    setNoteConcealed((current) => {
      const next = !current;
      if (next) {
        setConcealedLines(getConcealedNoteLines(editorRef.current));
        selectionRef.current = null;
        window.getSelection()?.removeAllRanges();
        if (editorRef.current) editorRef.current.scrollTop = 0;
      }
      return next;
    });
  };

  const toggleNoteLineVisibility = (lineIndex: number) => {
    setConcealedNoteLines((current) => {
      const next = new Set(current);
      if (next.has(lineIndex)) next.delete(lineIndex);
      else next.add(lineIndex);
      return next;
    });
  };

  return (
    <section className="flex flex-col gap-3 self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="mb-1 flex items-start justify-between">
        <div className="flex flex-col items-start gap-1.5">
          <div className="flex items-center gap-2.5">
            <p className="hidden">Capture</p>
            <h2 className="text-[1.1rem] font-bold text-heading">{t('note.title')}</h2>
            <VisibilityToggle
              concealed={noteConcealed}
              showLabel={t('note.reveal')}
              hideLabel={t('note.conceal')}
              onToggle={toggleNoteVisibility}
            />
            <span
              className={`text-sm font-semibold text-white transition-opacity duration-200 ${showSaved ? 'opacity-100' : 'opacity-0'}`}
              aria-live="polite"
            >
              {showSaved ? t('note.saved') : ''}
            </span>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t('note.workspaces')}>
            {NOTE_WORKSPACES.map((candidateWorkspaceId) => {
              const active = candidateWorkspaceId === workspaceId;
              return (
                <button
                  key={candidateWorkspaceId}
                  type="button"
                  className={`grid size-5 cursor-pointer place-items-center rounded-md border text-[0.62rem] font-bold leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-theme-accent ${active ? 'border-theme-accent bg-theme-accent-bg text-heading' : 'border-theme-border bg-panel text-info hover:border-theme-accent hover:text-heading'}`}
                  aria-pressed={active}
                  aria-label={t('note.workspace', { count: candidateWorkspaceId })}
                  title={t('note.workspace', { count: candidateWorkspaceId })}
                  onClick={() => void changeWorkspace(candidateWorkspaceId)}
                >
                  {NOTE_WORKSPACE_LABELS[candidateWorkspaceId]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <details className="group relative">
            <summary
              className="grid size-7 cursor-pointer list-none place-items-center rounded-lg text-info transition-colors hover:bg-theme-accent-bg hover:text-heading focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-theme-accent [&::-webkit-details-marker]:hidden"
              aria-label={t('note.settings')}
              title={t('note.settings')}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
              </svg>
            </summary>
            <div className="absolute top-9 right-0 z-30 w-52 rounded-xl border border-theme-border bg-card p-3 shadow-[var(--shadow)]">
              <p className="mb-2 text-xs font-semibold text-heading">{t('note.exportData')}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(['txt', 'pdf', 'html'] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    className="cursor-pointer rounded-lg border border-theme-border bg-panel px-2 py-1.5 text-xs font-bold uppercase text-heading transition-colors hover:bg-theme-accent-bg disabled:cursor-wait disabled:opacity-60"
                    disabled={exportingFormat !== null}
                    onClick={() => void handleExport(format)}
                  >
                    {exportingFormat === format ? '…' : format}
                  </button>
                ))}
              </div>
              {exportStatus && (
                <p className="mt-2 text-xs text-info" role="status">{exportStatus}</p>
              )}
            </div>
          </details>
          <span className="text-sm text-info">{savedAt ? new Date(savedAt).toLocaleString(locale) : t('note.neverSaved')}</span>
          {dragHandle}
        </div>
      </div>
      <div className="relative">
        <div
          ref={editorRef}
          role="textbox"
          aria-label={t('note.editorLabel')}
          aria-multiline="true"
          aria-hidden={noteConcealed}
          contentEditable={!noteConcealed}
          tabIndex={noteConcealed ? -1 : 0}
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={t('note.placeholder')}
          className={`quick-note-editor h-[230px] min-h-[160px] max-h-[720px] w-full overflow-y-auto whitespace-pre-wrap rounded-xl border border-theme-border bg-transparent py-2.5 pr-9 pl-3 text-white [tab-size:4] outline-none empty:before:pointer-events-none empty:before:text-info empty:before:content-[attr(data-placeholder)] focus:ring-2 focus:ring-theme-accent/30 [&_li]:my-0.5 [&_mark]:rounded-none [&_mark]:p-0 [&_mark]:text-[#111827] [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-none [&_ul]:pl-6 [&_ul_li]:relative [&_ul_li]:before:absolute [&_ul_li]:before:-left-5 [&_ul_li]:before:w-4 [&_ul_li]:before:text-center [&_ul_li]:before:content-['•'] [&_ul_li[data-marker=hyphen]]:before:content-['-'] ${noteConcealed ? 'pointer-events-none select-none !text-transparent caret-transparent before:!text-transparent [&_*]:!text-transparent [&_mark]:!bg-transparent [&_ul_li]:before:!text-transparent' : ''}`}
          onInput={syncEditorContent}
          onKeyDown={handleEditorKeyDown}
          onMouseUp={rememberSelection}
          onDoubleClick={handleEditorDoubleClick}
          onKeyUp={rememberSelection}
          onSelect={rememberSelection}
          onPaste={(event) => {
            event.preventDefault();
            document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
            syncEditorContent();
          }}
        />
        {!noteConcealed && highlightedCaretGeometry && (
          <span
            className="quick-note-highlight-caret pointer-events-none absolute z-[4]"
            style={highlightedCaretGeometry}
            aria-hidden="true"
          />
        )}
        {!noteConcealed && noteLineGeometries.map((line, index) => {
          if (line.top + line.height <= 1 || line.top >= editorHeightRef.current - 1) return null;
          const concealed = concealedNoteLines.has(index);
          const buttonTop = Math.max(2, line.top + (line.height - 18) / 2);
          const buttonLeft = Math.min(
            line.left + line.width + 5,
            (editorRef.current?.clientWidth ?? 0) - 23,
          );
          const maskTop = Math.max(1, line.top - 1);
          const maskHeight = Math.min(line.height + 2, editorHeightRef.current - maskTop - 1);
          return (
            <div key={index}>
              {concealed && (
                <div
                  className="pointer-events-none absolute z-[1] flex items-center bg-panel text-sm text-heading"
                  style={{
                    top: maskTop,
                    left: Math.max(10, line.left - 2),
                    width: line.width + 4,
                    height: maskHeight,
                  }}
                  aria-hidden="true"
                >
                  - - -
                </div>
              )}
              <button
                type="button"
                className="absolute z-[2] grid size-[18px] cursor-pointer place-items-center rounded bg-transparent text-info opacity-0 transition-all duration-150 hover:bg-theme-accent-bg hover:text-heading hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-theme-accent"
                style={{ top: buttonTop, left: buttonLeft }}
                aria-label={t(concealed ? 'note.revealLine' : 'note.concealLine', { line: index + 1 })}
                title={t(concealed ? 'note.revealLine' : 'note.concealLine', { line: index + 1 })}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleNoteLineVisibility(index)}
              >
                {concealed ? (
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m3 3 18 18" />
                    <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                    <path d="M9.9 4.3A10.7 10.7 0 0 1 12 4c5.4 0 9 5.2 9 5.2a12.4 12.4 0 0 1-2.2 2.8" />
                    <path d="M6.6 6.6A13.7 13.7 0 0 0 3 9.2S6.6 14.4 12 14.4c.8 0 1.6-.1 2.3-.3" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12s3.6-5.2 9-5.2 9 5.2 9 5.2-3.6 5.2-9 5.2S3 12 3 12Z" />
                    <circle cx="12" cy="12" r="2.6" />
                  </svg>
                )}
              </button>
            </div>
          );
        })}
        {noteConcealed && concealedLines.length > 0 && (
          <div
            className="pointer-events-none absolute inset-px z-[3] overflow-hidden rounded-[11px] bg-panel whitespace-pre-wrap py-2.5 pr-9 pl-3 text-heading"
            aria-hidden="true"
          >
            {concealedLines.map((line, index) => (
              <div key={`${index}-${line}`} className="min-h-[1.5em]">{line || '\u00a0'}</div>
            ))}
          </div>
        )}
      </div>
      <div
        ref={resizeHandleRef}
        role="separator"
        tabIndex={0}
        aria-label={t('note.resize')}
        aria-orientation="horizontal"
        aria-valuemin={MIN_NOTE_HEIGHT}
        aria-valuemax={MAX_NOTE_HEIGHT}
        aria-valuenow={DEFAULT_NOTE_HEIGHT}
        className="group -my-1 flex h-4 cursor-ns-resize touch-none items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      >
        <span className="h-1 w-20 rounded-full bg-info/45 transition-all group-hover:w-28 group-hover:bg-theme-accent group-focus-visible:w-28 group-focus-visible:bg-theme-accent" />
      </div>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('note.toolbar')}>
        {MARKER_COLORS.map(({ nameKey, value }) => (
          <button
            key={nameKey}
            type="button"
            className="grid size-6 cursor-pointer place-items-center rounded-md border border-transparent bg-transparent transition-colors hover:border-theme-border focus-visible:border-theme-accent focus-visible:outline-none"
            aria-label={t('note.marker', { color: t(nameKey) })}
            title={t('note.marker', { color: t(nameKey) })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyMarker(value)}
          >
            <span className="size-[15px] rounded-[2px]" style={{ backgroundColor: value }} />
          </button>
        ))}
        <button
          type="button"
          className="ml-1 cursor-pointer rounded-lg border border-theme-border bg-panel px-2 py-1 text-xs font-semibold text-heading transition-colors hover:bg-theme-accent-bg"
          aria-label={t('note.clearMarker')}
          title={t('note.clearMarker')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearMarker}
        >
          {t('note.clearMarkerButton')}
        </button>
        <span className="mx-0.5 h-5 w-px bg-theme-border" aria-hidden="true" />
        <button
          type="button"
          className="grid size-7 cursor-pointer place-items-center rounded-lg border border-theme-border bg-panel text-base font-bold text-heading transition-colors hover:bg-theme-accent-bg"
          aria-label={t('note.bulletList')}
          title={t('note.bulletList')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyListStyle('bullet')}
        >
          •
        </button>
        <button
          type="button"
          className="grid size-7 cursor-pointer place-items-center rounded-lg border border-theme-border bg-panel text-base font-bold text-heading transition-colors hover:bg-theme-accent-bg"
          aria-label={t('note.hyphenList')}
          title={t('note.hyphenList')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyListStyle('hyphen')}
        >
          -
        </button>
        <button
          type="button"
          className="grid size-7 cursor-pointer place-items-center rounded-lg border border-theme-border bg-panel text-sm font-bold text-heading transition-colors hover:bg-theme-accent-bg"
          aria-label={t('note.bold')}
          title={t('note.bold')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyInlineStyle('bold')}
        >
          B
        </button>
        <button
          type="button"
          className="grid size-7 cursor-pointer place-items-center rounded-lg border border-theme-border bg-panel text-sm font-semibold italic text-heading transition-colors hover:bg-theme-accent-bg"
          aria-label={t('note.italic')}
          title={t('note.italic')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyInlineStyle('italic')}
        >
          I
        </button>
        <label
          className="grid size-7 cursor-pointer place-items-center rounded-lg border border-theme-border bg-panel transition-colors hover:bg-theme-accent-bg"
          title={t('note.textColorTitle')}
          onMouseDown={rememberSelection}
        >
          <input
            type="color"
            value={noteColorPickerValue}
            aria-label={t('note.textColor')}
            className="size-[18px] cursor-pointer rounded-[3px] border-0 bg-transparent p-0"
            onInput={(event) => applyNoteTextColor(event.currentTarget.value)}
          />
        </label>
      </div>
      <button
        ref={saveButtonRef}
        type="button"
        className="cursor-pointer rounded-full border border-transparent bg-theme-accent px-3.5 py-2.5 font-semibold text-white shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-all duration-150 hover:-translate-y-px disabled:cursor-wait disabled:opacity-70"
        onClick={() => void handleSave()}
      >
        {isSaving ? t('note.saving') : t('note.save')}
      </button>
      {saveError && (
        <p className="text-xs font-semibold text-red-300" role="alert">
          {saveError}
        </p>
      )}
      <span className="text-sm text-info">
        {t('note.storageWarning')}
      </span>
    </section>
  );
}
