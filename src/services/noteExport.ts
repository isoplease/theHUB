import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

export type NoteExportFormat = 'txt' | 'html' | 'pdf';

export interface NoteRecoveryBackup {
  content: string;
  updatedAt: string;
}

const NOTE_RECOVERY_KEY = 'thehub-quick-note-recovery-v1';

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createPlainHtml(text: string, language: 'tr' | 'en'): string {
  return `<!doctype html>\n<html lang="${language}">\n<head>\n<meta charset="utf-8">\n<title>theHUB Notes</title>\n</head>\n<body>\n<pre>${escapeHtml(text)}</pre>\n</body>\n</html>\n`;
}

async function createPdf(text: string): Promise<Uint8Array> {
  const [pdfMake, pdfFonts] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const document: TDocumentDefinitions = {
    info: { title: 'theHUB Notes' },
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.3 },
    content: [{ text }],
  };

  return new Promise((resolve) => {
    pdfMake.createPdf(document, undefined, undefined, pdfFonts.vfs).getBuffer((buffer) => {
      resolve(new Uint8Array(buffer));
    });
  });
}

function downloadInBrowser(filename: string, bytes: Uint8Array, mimeType: string) {
  const browserBytes = new Uint8Array(bytes.byteLength);
  browserBytes.set(bytes);
  const blob = new Blob([browserBytes.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportNoteText(
  text: string,
  format: NoteExportFormat,
  language: 'tr' | 'en',
): Promise<'saved' | 'cancelled'> {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `theHUB-notes-${date}.${format}`;
  let bytes: Uint8Array;
  let mimeType: string;

  if (format === 'pdf') {
    bytes = await createPdf(text);
    mimeType = 'application/pdf';
  } else if (format === 'html') {
    bytes = new TextEncoder().encode(createPlainHtml(text, language));
    mimeType = 'text/html;charset=utf-8';
  } else {
    // The UTF-8 BOM keeps Turkish characters intact in older Notepad versions.
    bytes = new TextEncoder().encode(`\uFEFF${text}`);
    mimeType = 'text/plain;charset=utf-8';
  }

  if (!isTauriRuntime()) {
    downloadInBrowser(filename, bytes, mimeType);
    return 'saved';
  }

  const selectedPath = await save({
    defaultPath: filename,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!selectedPath) return 'cancelled';

  await invoke('write_note_export', {
    path: selectedPath,
    format,
    data: Array.from(bytes),
  });
  return 'saved';
}

function readBrowserRecoveryBackup(): NoteRecoveryBackup | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NOTE_RECOVERY_KEY) ?? 'null') as Partial<NoteRecoveryBackup> | null;
    return typeof parsed?.content === 'string' && typeof parsed.updatedAt === 'string'
      ? { content: parsed.content, updatedAt: parsed.updatedAt }
      : null;
  } catch {
    return null;
  }
}

export function saveNoteRecoverySnapshot(content: string, updatedAt: string): void {
  try {
    window.localStorage.setItem(NOTE_RECOVERY_KEY, JSON.stringify({ content, updatedAt }));
  } catch {
    // IndexedDB and the native rotating backup remain available if localStorage is full.
  }
}

export async function readNoteRecoveryBackup(): Promise<NoteRecoveryBackup | null> {
  const browserBackup = readBrowserRecoveryBackup();
  if (!isTauriRuntime()) return browserBackup;

  try {
    const nativeBackup = await invoke<NoteRecoveryBackup | null>('read_quick_note_backup');
    if (!nativeBackup) return browserBackup;
    if (!browserBackup) return nativeBackup;
    return Date.parse(nativeBackup.updatedAt) >= Date.parse(browserBackup.updatedAt)
      ? nativeBackup
      : browserBackup;
  } catch {
    return browserBackup;
  }
}

export async function backupNote(
  text: string,
  content: string,
  updatedAt: string,
): Promise<void> {
  saveNoteRecoverySnapshot(content, updatedAt);

  if (!isTauriRuntime()) return;
  await invoke('backup_quick_note', { text, content, updatedAt });
}
