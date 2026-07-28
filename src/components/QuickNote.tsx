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
    <section className="card note-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Capture</p>
          <h2>Hızlı not</h2>
        </div>
        <span className="muted">{savedAt ? new Date(savedAt).toLocaleString() : 'Henüz kaydedilmedi'}</span>
      </div>
      <textarea
        value={content}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Buraya bir not yazın..."
        rows={10}
      />
      <span className="muted">
        Notlar bu cihazda şifrelenmeden saklanır; parola veya erişim anahtarı kaydetmeyin.
      </span>
      <button type="button" onClick={() => void handleSave()}>
        Kaydet
      </button>
    </section>
  );
}
