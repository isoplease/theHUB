import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { MAX_NOTE_LENGTH, storageService } from '../services/storage';
import { useLanguage } from '../i18n';

const RICH_NOTE_PREFIX = 'dashboard-rich-note-v1:';
const NOTE_HEIGHT_KEY = 'dashboard-quick-note-height-v1';
const NOTE_TEXT_COLOR_KEY = 'dashboard-quick-note-text-color-v1';
const LEGACY_APPEARANCE_STORAGE_KEY = 'dashboard-custom-colors-v1';
const NOTE_COLOR_RESET_EVENT = 'dashboard-quick-note-color-reset';
const CARET_SENTINEL = '\u200B';
const DEFAULT_NOTE_HEIGHT = 230;
const MIN_NOTE_HEIGHT = 160;
const MAX_NOTE_HEIGHT = 720;
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
  const probe = document.createElement('span');
  probe.style.backgroundColor = value;
  return probe.style.backgroundColor;
}

function unwrapElement(element: HTMLElement) {
  element.replaceWith(...Array.from(element.childNodes));
}

function normalizeMarkerElements(container: ParentNode) {
  // A new marker can partially contain an older marker. Keep the newest
  // (outer) color and flatten the older marker so highlights never nest.
  Array.from(container.querySelectorAll('mark mark')).forEach((marker) => unwrapElement(marker as HTMLElement));

  Array.from(container.querySelectorAll('mark')).forEach((marker) => {
    if (!marker.textContent && !marker.querySelector('br')) marker.remove();
  });
}

function sanitizeNoteHtml(html: string): string {
  const source = document.createElement('template');
  const output = document.createElement('div');
  const allowedColors = new Set(MARKER_COLORS.map(({ value }) => normalizeColor(value)));
  source.innerHTML = html;

  const copySafeNode = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replaceAll(CARET_SENTINEL, '');
      if (text) parent.appendChild(document.createTextNode(text));
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const tagName = node.tagName.toLowerCase();
    if (tagName === 'br') {
      parent.appendChild(document.createElement('br'));
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
    } else if (tagName === 'mark') {
      const backgroundColor = normalizeColor(node.style.backgroundColor);
      const textColor = normalizeColor(node.style.color);
      if (allowedColors.has(backgroundColor)) {
        const marker = document.createElement('mark');
        marker.style.backgroundColor = backgroundColor;
        if (textColor) marker.style.color = textColor;
        safeParent = marker;
        parent.appendChild(marker);
      }
    } else if (tagName === 'span') {
      const backgroundColor = normalizeColor(node.style.backgroundColor);
      const textColor = normalizeColor(node.style.color);
      if (allowedColors.has(backgroundColor)) {
        const marker = document.createElement('mark');
        marker.style.backgroundColor = backgroundColor;
        safeParent = marker;
        parent.appendChild(marker);
      } else if (textColor) {
        const coloredText = document.createElement('span');
        coloredText.dataset.noteColor = 'true';
        coloredText.style.color = textColor;
        safeParent = coloredText;
        parent.appendChild(coloredText);
      }
    }

    Array.from(node.childNodes).forEach((child) => copySafeNode(child, safeParent));
  };

  Array.from(source.content.childNodes).forEach((node) => copySafeNode(node, output));
  normalizeMarkerElements(output);
  return output.innerHTML;
}

function getStoredNoteTextColor(): string | null {
  const storedColor = window.localStorage.getItem(NOTE_TEXT_COLOR_KEY);
  if (storedColor && /^#[0-9a-f]{6}$/i.test(storedColor)) return storedColor;

  try {
    const legacySettings = JSON.parse(window.localStorage.getItem(LEGACY_APPEARANCE_STORAGE_KEY) ?? '{}') as {
      quickNoteText?: unknown;
    };
    return typeof legacySettings.quickNoteText === 'string' && /^#[0-9a-f]{6}$/i.test(legacySettings.quickNoteText)
      ? legacySettings.quickNoteText
      : null;
  } catch {
    return null;
  }
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

export function QuickNote() {
  const { locale, t } = useLanguage();
  const noteTooLongMessage = t('note.tooLong', { count: MAX_NOTE_LENGTH.toLocaleString(locale) });
  const [savedAt, setSavedAt] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [noteTextColor, setNoteTextColor] = useState<string | null>(getStoredNoteTextColor);
  const [noteColorPickerValue, setNoteColorPickerValue] = useState(
    () => getStoredNoteTextColor() ?? (document.documentElement.dataset.theme === 'dark' ? '#f8fafc' : '#0f172a'),
  );
  const editorRef = useRef<HTMLDivElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef('');
  const savedContentRef = useRef('');
  const hasUserEditedRef = useRef(false);
  const selectionRef = useRef<Range | null>(null);
  const savedMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorHeightRef = useRef(DEFAULT_NOTE_HEIGHT);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const initialTranslateRef = useRef(t);

  // The initial load must run once; language changes must not reload and replace editor state.
  useEffect(() => {
    const loadInitialNote = async () => {
      try {
        const note = await storageService.getNote();
        if (note) {
          const normalized = normalizeStoredNote(note.content);
          if (hasUserEditedRef.current) return;
          if (editorRef.current) editorRef.current.innerHTML = normalized.html;
          contentRef.current = normalized.serialized;
          savedContentRef.current = normalized.serialized;
          setSavedAt(note.updatedAt);
        }
      } catch {
        setSaveError(initialTranslateRef.current('note.loadError'));
      }
    };
    void loadInitialNote();
    const storedHeight = Number(window.localStorage.getItem(NOTE_HEIGHT_KEY));
    setEditorHeight(Number.isFinite(storedHeight) && storedHeight > 0 ? storedHeight : DEFAULT_NOTE_HEIGHT);

    return () => {
      resizeCleanupRef.current?.();
      if (savedMessageTimer.current) {
        clearTimeout(savedMessageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (noteTextColor) {
      root.style.setProperty('--custom-quick-note-text', noteTextColor);
      window.localStorage.setItem(NOTE_TEXT_COLOR_KEY, noteTextColor);
    } else {
      root.style.removeProperty('--custom-quick-note-text');
      window.localStorage.removeItem(NOTE_TEXT_COLOR_KEY);
    }
  }, [noteTextColor]);

  useEffect(() => {
    const resetNoteColor = () => {
      setNoteTextColor(null);
      setNoteColorPickerValue(document.documentElement.dataset.theme === 'dark' ? '#f8fafc' : '#0f172a');
    };
    window.addEventListener(NOTE_COLOR_RESET_EVENT, resetNoteColor);
    return () => window.removeEventListener(NOTE_COLOR_RESET_EVENT, resetNoteColor);
  }, []);

  const updateSaveIndicator = () => {
    const hasUnsavedChanges = contentRef.current !== savedContentRef.current;
    saveButtonRef.current?.classList.toggle('border-red-400', hasUnsavedChanges);
    saveButtonRef.current?.classList.toggle('border-transparent', !hasUnsavedChanges);
  };

  const setEditorHeight = (height: number, persist = false) => {
    const normalizedHeight = Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, Math.round(height)));
    editorHeightRef.current = normalizedHeight;
    if (editorRef.current) editorRef.current.style.height = `${normalizedHeight}px`;
    resizeHandleRef.current?.setAttribute('aria-valuenow', String(normalizedHeight));
    if (persist) window.localStorage.setItem(NOTE_HEIGHT_KEY, String(normalizedHeight));
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
      window.localStorage.setItem(NOTE_HEIGHT_KEY, String(editorHeightRef.current));
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

    const serialized = `${RICH_NOTE_PREFIX}${sanitizeNoteHtml(editor.innerHTML)}`;
    if (serialized.length <= MAX_NOTE_LENGTH) {
      contentRef.current = serialized;
      setSaveError('');
      updateSaveIndicator();
    } else {
      setSaveError(noteTooLongMessage);
      saveButtonRef.current?.classList.add('border-red-400');
      saveButtonRef.current?.classList.remove('border-transparent');
    }
  };

  const rememberSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
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
    if (contentBeforeCaret.toString().length > 0) return false;

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
    const liveSelection = window.getSelection();
    const liveRange = liveSelection?.rangeCount && editor?.contains(liveSelection.anchorNode)
      ? liveSelection.getRangeAt(0).cloneRange()
      : null;
    const range = liveRange ?? selectionRef.current;
    if (!editor || !range || range.collapsed) return;

    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const marker = document.createElement('mark');
    marker.style.backgroundColor = color;
    marker.appendChild(range.extractContents());
    Array.from(marker.querySelectorAll('mark')).forEach((nestedMarker) => unwrapElement(nestedMarker as HTMLElement));
    range.insertNode(marker);

    const markedRange = document.createRange();
    markedRange.selectNodeContents(marker);
    selection?.removeAllRanges();
    selection?.addRange(markedRange);
    selectionRef.current = markedRange.cloneRange();
    syncEditorContent();
  };

  const applyNoteTextColor = (color: string) => {
    setNoteColorPickerValue(color);
    const editor = editorRef.current;
    const liveSelection = window.getSelection();
    const liveRange = liveSelection?.rangeCount && editor?.contains(liveSelection.anchorNode)
      ? liveSelection.getRangeAt(0).cloneRange()
      : null;
    const range = liveRange ?? selectionRef.current;
    if (!editor || !range || range.collapsed || !editor.contains(range.commonAncestorContainer)) {
      if (editor) {
        Array.from(editor.querySelectorAll('span[data-note-color]')).forEach((coloredSpan) => {
          unwrapElement(coloredSpan as HTMLElement);
        });
        Array.from(editor.querySelectorAll('mark')).forEach((marker) => marker.style.removeProperty('color'));
        syncEditorContent();
      }
      setNoteTextColor(color);
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const coloredText = document.createElement('span');
    coloredText.dataset.noteColor = 'true';
    coloredText.style.color = color;
    coloredText.appendChild(range.extractContents());
    Array.from(coloredText.querySelectorAll('span[data-note-color]')).forEach((nestedColor) => {
      unwrapElement(nestedColor as HTMLElement);
    });
    Array.from(coloredText.querySelectorAll('mark')).forEach((marker) => {
      marker.style.color = color;
    });
    range.insertNode(coloredText);

    const coloredRange = document.createRange();
    coloredRange.selectNodeContents(coloredText);
    selection?.removeAllRanges();
    selection?.addRange(coloredRange);
    selectionRef.current = coloredRange.cloneRange();
    syncEditorContent();
  };

  const applyListStyle = (style: 'bullet' | 'hyphen') => {
    const editor = editorRef.current;
    const liveSelection = window.getSelection();
    const liveRange = liveSelection?.rangeCount && editor?.contains(liveSelection.anchorNode)
      ? liveSelection.getRangeAt(0).cloneRange()
      : null;
    const range = liveRange ?? selectionRef.current;
    if (!editor) return;

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

  const handleSave = async () => {
    if (isSaving) return;

    const currentHtml = sanitizeNoteHtml(editorRef.current?.innerHTML ?? '');
    const currentContent = `${RICH_NOTE_PREFIX}${currentHtml}`;
    if (currentContent.length > MAX_NOTE_LENGTH) {
      setSaveError(noteTooLongMessage);
      return;
    }
    contentRef.current = currentContent;
    setIsSaving(true);
    setSaveError('');
    try {
      const note = await storageService.saveNote(currentContent);
      savedContentRef.current = note.content;
      updateSaveIndicator();
      setSavedAt(note.updatedAt);
      setShowSaved(true);

      if (savedMessageTimer.current) {
        clearTimeout(savedMessageTimer.current);
      }
      savedMessageTimer.current = setTimeout(() => {
        setShowSaved(false);
        savedMessageTimer.current = null;
      }, 2000);
    } catch {
      setSaveError(t('note.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="mb-1 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <p className="hidden">Capture</p>
          <h2 className="text-[1.1rem] font-bold text-heading">{t('note.title')}</h2>
          <span
            className={`text-sm font-semibold text-white transition-opacity duration-200 ${showSaved ? 'opacity-100' : 'opacity-0'}`}
            aria-live="polite"
          >
            {showSaved ? t('note.saved') : ''}
          </span>
        </div>
        <span className="text-sm text-info">{savedAt ? new Date(savedAt).toLocaleString(locale) : t('note.neverSaved')}</span>
      </div>
      <div
        ref={editorRef}
        role="textbox"
        aria-label={t('note.editorLabel')}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={t('note.placeholder')}
        className="h-[230px] min-h-[160px] max-h-[720px] w-full overflow-y-auto whitespace-pre-wrap rounded-xl border border-theme-border bg-transparent px-3 py-2.5 [color:var(--custom-quick-note-text,var(--text-h))] [tab-size:4] outline-none empty:before:pointer-events-none empty:before:text-info empty:before:content-[attr(data-placeholder)] focus:ring-2 focus:ring-theme-accent/30 [&_li]:my-0.5 [&_mark]:rounded-none [&_mark]:p-0 [&_mark]:text-[#111827] [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-none [&_ul]:pl-6 [&_ul_li]:relative [&_ul_li]:before:absolute [&_ul_li]:before:-left-5 [&_ul_li]:before:w-4 [&_ul_li]:before:text-center [&_ul_li]:before:content-['•'] [&_ul_li[data-marker=hyphen]]:before:content-['-']"
        onInput={syncEditorContent}
        onKeyDown={handleEditorKeyDown}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onSelect={rememberSelection}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
          syncEditorContent();
        }}
      />
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
            onChange={(event) => applyNoteTextColor(event.target.value)}
          />
        </label>
      </div>
      <button
        ref={saveButtonRef}
        type="button"
        className="cursor-pointer rounded-full border border-transparent bg-theme-accent px-3.5 py-2.5 font-semibold text-white shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-all duration-150 hover:-translate-y-px disabled:cursor-wait disabled:opacity-70"
        onClick={() => void handleSave()}
        disabled={isSaving}
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
