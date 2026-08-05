import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { MAX_NOTE_LENGTH, storageService } from '../services/storage';

const RICH_NOTE_PREFIX = 'dashboard-rich-note-v1:';
const NOTE_HEIGHT_KEY = 'dashboard-quick-note-height-v1';
const DEFAULT_NOTE_HEIGHT = 230;
const MIN_NOTE_HEIGHT = 160;
const MAX_NOTE_HEIGHT = 720;
const NOTE_TOO_LONG_MESSAGE = `Not en fazla ${MAX_NOTE_LENGTH.toLocaleString('tr-TR')} karakter olabilir.`;
const MARKER_COLORS = [
  { name: 'Sarı', value: '#fde047' },
  { name: 'Yeşil', value: '#4ade80' },
  { name: 'Mavi', value: '#60a5fa' },
  { name: 'Mor', value: '#c084fc' },
  { name: 'Kırmızı', value: '#f87171' },
  { name: 'Turuncu', value: '#fb923c' },
  { name: 'Pembe', value: '#f472b6' },
  { name: 'Turkuaz', value: '#2dd4bf' },
] as const;

function normalizeColor(value: string): string {
  const probe = document.createElement('span');
  probe.style.backgroundColor = value;
  return probe.style.backgroundColor;
}

function sanitizeNoteHtml(html: string): string {
  const source = document.createElement('template');
  const output = document.createElement('div');
  const allowedColors = new Set(MARKER_COLORS.map(({ value }) => normalizeColor(value)));
  source.innerHTML = html;

  const copySafeNode = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''));
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const tagName = node.tagName.toLowerCase();
    if (tagName === 'br') {
      parent.appendChild(document.createElement('br'));
      return;
    }

    let safeParent = parent;
    if (tagName === 'div' || tagName === 'p') {
      safeParent = document.createElement(tagName);
      parent.appendChild(safeParent);
    } else if (tagName === 'mark' || tagName === 'span') {
      const backgroundColor = normalizeColor(node.style.backgroundColor);
      if (allowedColors.has(backgroundColor)) {
        const marker = document.createElement('mark');
        marker.style.backgroundColor = backgroundColor;
        safeParent = marker;
        parent.appendChild(marker);
      }
    }

    Array.from(node.childNodes).forEach((child) => copySafeNode(child, safeParent));
  };

  Array.from(source.content.childNodes).forEach((node) => copySafeNode(node, output));
  return output.innerHTML;
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
  const [editorHtml, setEditorHtml] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const editorRef = useRef<HTMLDivElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef('');
  const savedContentRef = useRef('');
  const selectionRef = useRef<Range | null>(null);
  const savedMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorHeightRef = useRef(DEFAULT_NOTE_HEIGHT);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void loadNote();
    const storedHeight = Number(window.localStorage.getItem(NOTE_HEIGHT_KEY));
    setEditorHeight(Number.isFinite(storedHeight) && storedHeight > 0 ? storedHeight : DEFAULT_NOTE_HEIGHT);

    return () => {
      resizeCleanupRef.current?.();
      if (savedMessageTimer.current) {
        clearTimeout(savedMessageTimer.current);
      }
    };
  }, []);

  const loadNote = async () => {
    try {
      const note = await storageService.getNote();
      if (note) {
        const normalized = normalizeStoredNote(note.content);
        setEditorHtml(normalized.html);
        contentRef.current = normalized.serialized;
        savedContentRef.current = normalized.serialized;
        setSavedAt(note.updatedAt);
      }
    } catch {
      setSaveError('Kaydedilmiş not yüklenemedi.');
    }
  };

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
    if (!editor.textContent && !editor.querySelector('br, mark')) editor.innerHTML = '';

    const serialized = `${RICH_NOTE_PREFIX}${sanitizeNoteHtml(editor.innerHTML)}`;
    if (serialized.length <= MAX_NOTE_LENGTH) {
      contentRef.current = serialized;
      setSaveError('');
      updateSaveIndicator();
    } else {
      setSaveError(NOTE_TOO_LONG_MESSAGE);
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
    range.insertNode(marker);

    const markedRange = document.createRange();
    markedRange.selectNodeContents(marker);
    selection?.removeAllRanges();
    selection?.addRange(markedRange);
    selectionRef.current = markedRange.cloneRange();
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
      setSaveError(NOTE_TOO_LONG_MESSAGE);
      return;
    }
    contentRef.current = currentContent;
    setEditorHtml(currentHtml);
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
      setSaveError('Not kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="mb-1 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <p className="hidden">Capture</p>
          <h2 className="text-[1.1rem] font-bold text-heading">Hızlı Not</h2>
          <span
            className={`text-sm font-semibold text-white transition-opacity duration-200 ${showSaved ? 'opacity-100' : 'opacity-0'}`}
            aria-live="polite"
          >
            {showSaved ? 'Kaydedildi' : ''}
          </span>
        </div>
        <span className="text-sm text-info">{savedAt ? new Date(savedAt).toLocaleString() : 'Henüz kaydedilmedi'}</span>
      </div>
      <div
        ref={editorRef}
        role="textbox"
        aria-label="Hızlı not metni"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: editorHtml }}
        spellCheck={false}
        data-placeholder="Buraya bir not yazın..."
        className="h-[230px] min-h-[160px] max-h-[720px] w-full overflow-y-auto whitespace-pre-wrap rounded-xl border border-theme-border bg-transparent px-3 py-2.5 text-heading outline-none empty:before:pointer-events-none empty:before:text-info empty:before:content-[attr(data-placeholder)] focus:ring-2 focus:ring-theme-accent/30 [&_mark]:rounded-sm [&_mark]:px-0.5 [&_mark]:text-[#111827]"
        onInput={syncEditorContent}
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
        aria-label="Not alanının yüksekliğini değiştir"
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
      <div className="flex items-center gap-2" role="toolbar" aria-label="Marker renkleri">
        {MARKER_COLORS.map(({ name, value }) => (
          <button
            key={name}
            type="button"
            className="grid size-6 cursor-pointer place-items-center rounded-md border border-transparent bg-transparent transition-colors hover:border-theme-border focus-visible:border-theme-accent focus-visible:outline-none"
            aria-label={`${name} marker`}
            title={`${name} marker`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyMarker(value)}
          >
            <span className="size-[15px] rounded-[2px]" style={{ backgroundColor: value }} />
          </button>
        ))}
        <button
          type="button"
          className="ml-1 cursor-pointer rounded-lg border border-theme-border bg-panel px-2 py-1 text-xs font-semibold text-heading transition-colors hover:bg-theme-accent-bg"
          aria-label="Seçili metindeki markerı temizle"
          title="Seçili metindeki markerı temizle"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearMarker}
        >
          Markerı temizle
        </button>
      </div>
      <button
        ref={saveButtonRef}
        type="button"
        className="cursor-pointer rounded-full border border-transparent bg-theme-accent px-3.5 py-2.5 font-semibold text-white shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-all duration-150 hover:-translate-y-px disabled:cursor-wait disabled:opacity-70"
        onClick={() => void handleSave()}
        disabled={isSaving}
      >
        {isSaving ? 'Kaydediliyor…' : 'Kaydet'}
      </button>
      {saveError && (
        <p className="text-xs font-semibold text-red-300" role="alert">
          {saveError}
        </p>
      )}
      <span className="text-sm text-info">
        Notlar bu cihazda şifrelenmeden saklanır; parola veya erişim anahtarı kaydetmeyin.
      </span>
    </section>
  );
}
