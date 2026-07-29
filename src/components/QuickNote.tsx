import { useEffect, useState } from 'react';
import { MAX_NOTE_LENGTH, storageService } from '../services/storage';

export function QuickNote() {
  const [content, setContent] = useState('');
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => {
    void loadNote();
  }, []);

  const loadNote = async () => {
    const note = await storageService.getNote();
    if (note) {
      setContent(note.content);
      setSavedAt(note.updatedAt);
    }
  };

  const handleSave = async () => {
    const note = await storageService.saveNote(content);
    setSavedAt(note.updatedAt);
  };

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="mb-1 flex items-start justify-between">
        <div>
          <p className="hidden">Capture</p>
          <h2 className="text-[1.1rem] font-bold text-heading">Hızlı not</h2>
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
        className="cursor-pointer rounded-full border-0 bg-theme-accent px-3.5 py-2.5 font-semibold text-white shadow-[0_10px_28px_rgba(14,26,69,0.16)] transition-transform duration-150 hover:-translate-y-px"
        onClick={() => void handleSave()}
      >
        Kaydet
      </button>
    </section>
  );
}
