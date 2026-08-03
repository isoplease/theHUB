import { useEffect, useRef, useState } from 'react';
import { MAX_NOTE_LENGTH, storageService } from '../services/storage';

export function QuickNote() {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savedMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsavedChanges = content !== savedContent;

  useEffect(() => {
    void loadNote();

    return () => {
      if (savedMessageTimer.current) {
        clearTimeout(savedMessageTimer.current);
      }
    };
  }, []);

  const loadNote = async () => {
    const note = await storageService.getNote();
    if (note) {
      setContent(note.content);
      setSavedContent(note.content);
      setSavedAt(note.updatedAt);
    }
  };

  const handleSave = async () => {
    if (isSaving) return;

    setIsSaving(true);
    try {
      const note = await storageService.saveNote(content);
      setSavedContent(note.content);
      setSavedAt(note.updatedAt);
      setShowSaved(true);

      if (savedMessageTimer.current) {
        clearTimeout(savedMessageTimer.current);
      }
      savedMessageTimer.current = setTimeout(() => {
        setShowSaved(false);
        savedMessageTimer.current = null;
      }, 2000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
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
      <textarea
        value={content}
        maxLength={MAX_NOTE_LENGTH}
        spellCheck={false}
        className="w-full rounded-xl border border-theme-border bg-transparent px-3 py-2.5 text-heading outline-none focus:ring-2 focus:ring-theme-accent/30"
        onChange={(event) => setContent(event.target.value)}
        placeholder="Buraya bir not yazın..."
        rows={10}
      />
      <span className="text-sm text-info">
        Notlar bu cihazda şifrelenmeden saklanır; parola veya erişim anahtarı kaydetmeyin.
      </span>
      <button
        type="button"
        className={`cursor-pointer rounded-full border bg-theme-accent px-3.5 py-2.5 font-semibold text-white shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-all duration-150 hover:-translate-y-px disabled:cursor-wait disabled:opacity-70 ${hasUnsavedChanges ? 'border-red-400' : 'border-transparent'}`}
        onClick={() => void handleSave()}
        disabled={isSaving}
      >
        {isSaving ? 'Kaydediliyor…' : 'Kaydet'}
      </button>
    </section>
  );
}
