import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { ContactItem } from '../types/app';

export type ContactExportFormat = 'txt' | 'html';

export interface ContactExportLabels {
  readonly title: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly organization: string;
  readonly notes: string;
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function displayValue(value: string): string {
  return value.trim() || '—';
}

function exportContactName(contact: ContactItem): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

export function createContactsText(
  contacts: readonly ContactItem[],
  labels: ContactExportLabels,
): string {
  const entries = contacts.map((contact, index) => [
    `${index + 1}. ${labels.name}: ${displayValue(exportContactName(contact))}`,
    `   ${labels.phone}: ${displayValue(contact.phone)}`,
    `   ${labels.email}: ${displayValue(contact.email)}`,
    `   ${labels.organization}: ${displayValue(contact.organization)}`,
    `   ${labels.notes}: ${displayValue(contact.notes).replaceAll('\n', '\n   ')}`,
  ].join('\n'));
  return `${labels.title}\n${'='.repeat(labels.title.length)}\n\n${entries.join('\n\n')}`.trimEnd() + '\n';
}

export function createContactsHtml(
  contacts: readonly ContactItem[],
  labels: ContactExportLabels,
  language: 'tr' | 'en',
): string {
  const rows = contacts.map((contact) => `      <tr>
        <td>${escapeHtml(displayValue(exportContactName(contact)))}</td>
        <td>${escapeHtml(displayValue(contact.phone))}</td>
        <td>${escapeHtml(displayValue(contact.email))}</td>
        <td>${escapeHtml(displayValue(contact.organization))}</td>
        <td class="notes">${escapeHtml(displayValue(contact.notes))}</td>
      </tr>`).join('\n');

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(labels.title)}</title>
  <style>
    body { margin: 32px; color: #172033; background: #fff; font: 14px/1.5 system-ui, sans-serif; }
    h1 { margin: 0 0 20px; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 10px; border: 1px solid #cfd6e4; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #eef2f7; font-size: 12px; text-transform: uppercase; }
    .notes { white-space: pre-wrap; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(labels.title)}</h1>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(labels.name)}</th>
        <th>${escapeHtml(labels.phone)}</th>
        <th>${escapeHtml(labels.email)}</th>
        <th>${escapeHtml(labels.organization)}</th>
        <th>${escapeHtml(labels.notes)}</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
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
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function exportContacts(
  contacts: readonly ContactItem[],
  format: ContactExportFormat,
  labels: ContactExportLabels,
  language: 'tr' | 'en',
): Promise<'saved' | 'cancelled'> {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `theHUB-contacts-${date}.${format}`;
  const content = format === 'html'
    ? createContactsHtml(contacts, labels, language)
    : `\uFEFF${createContactsText(contacts, labels)}`;
  const bytes = new TextEncoder().encode(content);
  const mimeType = format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8';

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
