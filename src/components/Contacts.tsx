import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { CONTACT_LIMITS, contactDisplayName, normalizeContactInput, sortContacts } from '../services/contacts';
import type { ContactSortMode } from '../services/contacts';
import { storageService } from '../services/storage';
import type { ContactInput, ContactItem } from '../types/app';
import { useLanguage } from '../i18n';

const CONTACT_SORT_KEY = 'thehub-contact-sort-v1';
const CONTACT_COLUMNS_KEY = 'thehub-contact-columns-v1';
const EMPTY_CONTACT: ContactInput = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  organization: '',
  notes: '',
};

type ContactColumn = 'name' | 'phone' | 'email' | 'organization';
const CONTACT_COLUMNS: readonly ContactColumn[] = ['name', 'phone', 'email', 'organization'];

function loadSortMode(): ContactSortMode {
  return window.localStorage.getItem(CONTACT_SORT_KEY) === 'alphabetical' ? 'alphabetical' : 'flat';
}

function loadVisibleColumns(): ContactColumn[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(CONTACT_COLUMNS_KEY) ?? 'null');
    if (!Array.isArray(stored)) return [...CONTACT_COLUMNS];
    const valid = stored.filter((column): column is ContactColumn => CONTACT_COLUMNS.includes(column as ContactColumn));
    return valid.length > 0 && new Set(valid).size === valid.length ? valid : [...CONTACT_COLUMNS];
  } catch {
    return [...CONTACT_COLUMNS];
  }
}

function columnTitleKey(column: ContactColumn) {
  if (column === 'name') return 'contacts.nameColumn';
  if (column === 'phone') return 'contacts.phone';
  if (column === 'email') return 'contacts.email';
  if (column === 'organization') return 'contacts.organization';
  return 'contacts.organization';
}

function columnValue(contact: ContactItem, column: ContactColumn): string {
  if (column === 'name') return contactDisplayName(contact);
  return contact[column];
}

function contactGridStyle(columns: readonly ContactColumn[]): CSSProperties {
  const tracks = columns.map((column) => column === 'name' ? 'minmax(0, 1.2fr)' : 'minmax(0, 1fr)');
  return { gridTemplateColumns: `1rem ${tracks.join(' ')} 1.75rem` };
}

function CopyIcon() {
  return <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
}

function NoteIcon({ filled = false }: { readonly filled?: boolean }) {
  return filled
    ? <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true"><path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h12a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-11Zm2.1-.45 6.4 5.2 6.4-5.2a1 1 0 0 0-.4-.05H6a1 1 0 0 0-.4.05Zm13.4 2.1-6.37 5.17a1 1 0 0 1-1.26 0L5 8.15v9.35a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.15Z" /></svg>
    : <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>;
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Clipboard unavailable');
  }
}

interface ContactsProps {
  readonly dragHandle?: ReactNode;
}

export function Contacts({ dragHandle }: ContactsProps) {
  const { locale, t } = useLanguage();
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [sortMode, setSortMode] = useState<ContactSortMode>(loadSortMode);
  const [visibleColumns, setVisibleColumns] = useState<ContactColumn[]>(loadVisibleColumns);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ContactInput>(EMPTY_CONTACT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ContactInput>(EMPTY_CONTACT);
  const [editSaving, setEditSaving] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = (message: string) => {
    setError(message);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(''), 3_000);
  };

  useEffect(() => {
    let cancelled = false;
    void storageService.getContacts()
      .then((stored) => {
        if (!cancelled) setContacts(stored);
      })
      .catch(() => {
        if (!cancelled) showError(t('contacts.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (errorTimer.current) clearTimeout(errorTimer.current);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [t]);

  const orderedContacts = useMemo(
    () => sortContacts(contacts, sortMode, locale),
    [contacts, locale, sortMode],
  );
  const gridStyle = contactGridStyle(visibleColumns);

  const updateSortMode = (mode: ContactSortMode) => {
    setSortMode(mode);
    window.localStorage.setItem(CONTACT_SORT_KEY, mode);
  };

  const toggleColumn = (column: ContactColumn) => {
    setVisibleColumns((current) => {
      const isVisible = current.includes(column);
      if (isVisible && current.length === 1) return current;
      const next = isVisible
        ? current.filter((item) => item !== column)
        : CONTACT_COLUMNS.filter((item) => current.includes(item) || item === column);
      window.localStorage.setItem(CONTACT_COLUMNS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const updateField = (field: keyof ContactInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const addContact = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.firstName.trim()) {
      showError(t('contacts.nameRequired'));
      return;
    }
    const normalized = normalizeContactInput(form);
    if (!normalized) {
      showError(t('contacts.invalidData'));
      return;
    }
    setSaving(true);
    try {
      const created = await storageService.addContact(normalized);
      setContacts((current) => [...current, created]);
      setForm(EMPTY_CONTACT);
      setFormOpen(false);
      setError('');
    } catch {
      showError(t('contacts.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const deleteContact = async (id: string) => {
    try {
      await storageService.deleteContact(id);
      setContacts((current) => current.filter((contact) => contact.id !== id));
      setPendingDeleteId(null);
    } catch {
      showError(t('contacts.deleteError'));
    }
  };

  const openContactEditor = (contact: ContactItem) => {
    setEditingContactId((current) => current === contact.id ? null : contact.id);
    setEditForm({
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      email: contact.email,
      organization: contact.organization,
      notes: contact.notes,
    });
    setPendingDeleteId(null);
  };

  const saveContact = async (contact: ContactItem) => {
    const normalized = normalizeContactInput(editForm);
    if (!normalized) {
      showError(t('contacts.invalidData'));
      return;
    }
    setEditSaving(true);
    try {
      const updated = await storageService.updateContact(contact.id, normalized);
      if (!updated) throw new Error('Contact missing');
      setContacts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingContactId(null);
      setEditForm(EMPTY_CONTACT);
    } catch {
      showError(t('contacts.updateError'));
    } finally {
      setEditSaving(false);
    }
  };

  const copyContactValue = async (contact: ContactItem, column: ContactColumn, value: string) => {
    if (!value) return;
    try {
      await copyText(value);
      const key = `${contact.id}:${column}`;
      setCopiedField(key);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedField(''), 1_500);
    } catch {
      showError(t('contacts.copyError'));
    }
  };

  return (
    <section className="self-start rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]" aria-label={t('contacts.title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[1.1rem] font-bold text-heading">{t('contacts.title')} <span className="text-sm font-medium text-info">({contacts.length})</span></h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-xl border border-theme-border bg-panel p-1" aria-label={t('contacts.sort')}>
            {(['flat', 'alphabetical'] as const).map((mode) => (
              <button key={mode} type="button" className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${sortMode === mode ? 'bg-theme-accent text-white' : 'text-info hover:text-heading'}`} aria-pressed={sortMode === mode} onClick={() => updateSortMode(mode)}>
                {t(mode === 'flat' ? 'contacts.flat' : 'contacts.alphabetical')}
              </button>
            ))}
          </div>
          <div className="relative">
            <button type="button" className="cursor-pointer rounded-xl border border-theme-border bg-panel px-3 py-2 text-xs font-semibold text-heading transition-colors hover:border-theme-accent" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((current) => !current)}>{t('contacts.columns')}</button>
            {columnsOpen && (
              <div className="absolute top-11 right-0 z-40 w-44 rounded-xl border border-theme-border bg-card p-2 shadow-[var(--shadow)]">
                {CONTACT_COLUMNS.map((column) => (
                  <label key={column} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-info hover:bg-panel hover:text-heading">
                    <input type="checkbox" checked={visibleColumns.includes(column)} disabled={visibleColumns.length === 1 && visibleColumns.includes(column)} className="accent-[var(--accent)]" onChange={() => toggleColumn(column)} />
                    <span>{t(columnTitleKey(column))}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="cursor-pointer rounded-xl border border-theme-accent bg-theme-accent px-3 py-2 text-xs font-semibold text-white transition-all hover:-translate-y-px hover:brightness-110" aria-expanded={formOpen} onClick={() => { setFormOpen((current) => !current); setColumnsOpen(false); }}>{t('contacts.add')}</button>
          {dragHandle}
        </div>
      </div>

      {formOpen && (
        <form className="mt-4 rounded-2xl border border-theme-border bg-panel/45 p-3" onSubmit={(event) => void addContact(event)}>
          <div className="grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
            <input type="text" autoFocus required maxLength={CONTACT_LIMITS.firstName} value={form.firstName} placeholder={t('contacts.firstName')} aria-label={t('contacts.firstName')} className="rounded-xl border border-theme-border bg-card px-3 py-2 text-sm text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => updateField('firstName', event.target.value)} />
            <input type="text" maxLength={CONTACT_LIMITS.lastName} value={form.lastName} placeholder={t('contacts.lastName')} aria-label={t('contacts.lastName')} className="rounded-xl border border-theme-border bg-card px-3 py-2 text-sm text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => updateField('lastName', event.target.value)} />
            <input type="tel" maxLength={CONTACT_LIMITS.phone} value={form.phone} placeholder={t('contacts.phone')} aria-label={t('contacts.phone')} className="rounded-xl border border-theme-border bg-card px-3 py-2 text-sm text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => updateField('phone', event.target.value)} />
            <input type="email" maxLength={CONTACT_LIMITS.email} value={form.email} placeholder={t('contacts.email')} aria-label={t('contacts.email')} className="rounded-xl border border-theme-border bg-card px-3 py-2 text-sm text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => updateField('email', event.target.value)} />
          </div>
          <input type="text" maxLength={CONTACT_LIMITS.organization} value={form.organization} placeholder={t('contacts.organization')} aria-label={t('contacts.organization')} className="mt-2 w-full rounded-xl border border-theme-border bg-card px-3 py-2 text-sm text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => updateField('organization', event.target.value)} />
          <textarea maxLength={CONTACT_LIMITS.notes} value={form.notes} placeholder={t('contacts.notes')} aria-label={t('contacts.notes')} rows={3} className="mt-2 w-full resize-y rounded-xl border border-theme-border bg-card px-3 py-2 text-sm text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => updateField('notes', event.target.value)} />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" className="cursor-pointer rounded-lg border border-theme-border px-3 py-1.5 text-xs font-semibold text-info hover:text-heading" onClick={() => { setFormOpen(false); setForm(EMPTY_CONTACT); setError(''); }}>{t('common.cancel')}</button>
            <button type="submit" disabled={saving} className="cursor-pointer rounded-lg bg-theme-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-60">{saving ? '…' : t('common.add')}</button>
          </div>
        </form>
      )}

      {error && <p className="mt-3 text-xs font-semibold text-red-300" role="alert">{error}</p>}
      <div className="mt-4 min-h-28" aria-busy={loading} aria-live="polite">
        {!loading && contacts.length === 0 ? (
          <p className="py-8 text-center text-sm text-info">{t('contacts.empty')}</p>
        ) : contacts.length > 0 && (
          <div className={sortMode === 'flat' ? '' : 'rounded-2xl border border-theme-border'}>
            {sortMode === 'alphabetical' && <div className="grid gap-2 border-b border-theme-border bg-panel px-3 py-2 text-[0.65rem] font-bold tracking-wide text-info uppercase" style={gridStyle}>
              <span aria-hidden="true" />
              {visibleColumns.map((column) => <span key={column}>{t(columnTitleKey(column))}</span>)}
              <span aria-hidden="true" />
            </div>}
            {orderedContacts.map((contact) => (
              <article key={contact.id} className={sortMode === 'flat' ? 'px-1 py-2' : 'border-b border-theme-border/55 px-3 py-2.5 last:border-b-0'}>
                <div className="grid items-start gap-2 text-xs" style={gridStyle}>
                  <span className="group/note relative mt-px grid size-4 place-items-center text-white" aria-label={contact.notes.trim() || undefined}>
                    {contact.notes.trim() && <>
                      <NoteIcon filled />
                      <span role="tooltip" className="pointer-events-none absolute top-5 left-0 z-50 w-max max-w-[min(16rem,calc(100vw-4rem))] rounded-lg border border-theme-border bg-card px-2.5 py-2 text-left text-xs font-normal whitespace-pre-wrap text-heading opacity-0 shadow-[var(--shadow)] group-hover/note:opacity-100">
                        {contact.notes.trim()}
                      </span>
                    </>}
                  </span>
                  {visibleColumns.map((column) => {
                    const value = columnValue(contact, column);
                    const copyKey = `${contact.id}:${column}`;
                    return <span key={column} className={`group/cell relative flex min-w-0 items-start gap-1 ${column === 'name' ? 'font-semibold text-heading' : 'text-info'}`} title={value}>
                      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{value || '—'}</span>
                      {column === 'name' && <button type="button" className="mt-px grid size-4 shrink-0 cursor-pointer place-items-center rounded text-info opacity-0 transition-opacity hover:text-theme-accent focus-visible:opacity-100 focus-visible:text-theme-accent group-hover/cell:opacity-100" aria-label={t('contacts.editContact')} title={t('contacts.editContact')} onClick={() => openContactEditor(contact)}><NoteIcon /></button>}
                      {value && <button type="button" className="mt-px grid size-4 shrink-0 cursor-pointer place-items-center rounded text-info opacity-0 transition-opacity hover:opacity-100 hover:text-white focus-visible:opacity-100 focus-visible:text-white group-hover/cell:opacity-100" aria-label={t('contacts.copy', { field: t(columnTitleKey(column)) })} title={copiedField === copyKey ? t('contacts.copied') : t('contacts.copy', { field: t(columnTitleKey(column)) })} onClick={() => void copyContactValue(contact, column, value)}>{copiedField === copyKey ? '✓' : <CopyIcon />}</button>}
                    </span>;
                  })}
                  <button type="button" className="grid size-5 cursor-pointer place-items-center rounded text-sm text-red-300 hover:bg-red-500/15 hover:text-white" aria-label={t('contacts.deleteNamed', { name: contactDisplayName(contact) })} title={t('common.delete')} onClick={() => { setPendingDeleteId((current) => current === contact.id ? null : contact.id); setEditingContactId(null); }}>×</button>
                </div>
                {editingContactId === contact.id && (
                  <div className="mt-2 rounded-xl border border-theme-border bg-panel/45 p-2">
                    <div className="grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
                      <input type="text" autoFocus required maxLength={CONTACT_LIMITS.firstName} value={editForm.firstName} placeholder={t('contacts.firstName')} aria-label={t('contacts.firstName')} className="rounded-lg border border-theme-border bg-card px-3 py-2 text-xs text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => setEditForm((current) => ({ ...current, firstName: event.target.value }))} />
                      <input type="text" maxLength={CONTACT_LIMITS.lastName} value={editForm.lastName} placeholder={t('contacts.lastName')} aria-label={t('contacts.lastName')} className="rounded-lg border border-theme-border bg-card px-3 py-2 text-xs text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => setEditForm((current) => ({ ...current, lastName: event.target.value }))} />
                      <input type="tel" maxLength={CONTACT_LIMITS.phone} value={editForm.phone} placeholder={t('contacts.phone')} aria-label={t('contacts.phone')} className="rounded-lg border border-theme-border bg-card px-3 py-2 text-xs text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))} />
                      <input type="email" maxLength={CONTACT_LIMITS.email} value={editForm.email} placeholder={t('contacts.email')} aria-label={t('contacts.email')} className="rounded-lg border border-theme-border bg-card px-3 py-2 text-xs text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))} />
                    </div>
                    <input type="text" maxLength={CONTACT_LIMITS.organization} value={editForm.organization} placeholder={t('contacts.organization')} aria-label={t('contacts.organization')} className="mt-2 w-full rounded-lg border border-theme-border bg-card px-3 py-2 text-xs text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => setEditForm((current) => ({ ...current, organization: event.target.value }))} />
                    <textarea rows={3} maxLength={CONTACT_LIMITS.notes} value={editForm.notes} placeholder={t('contacts.notes')} aria-label={t('contacts.notes')} className="mt-2 w-full resize-y rounded-lg border border-theme-border bg-card px-3 py-2 text-xs text-heading outline-none placeholder:text-info focus:border-theme-accent" onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))} />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" className="cursor-pointer rounded-lg border border-theme-border px-2.5 py-1 text-xs font-semibold text-info hover:text-heading" onClick={() => { setEditingContactId(null); setEditForm(EMPTY_CONTACT); }}>{t('common.cancel')}</button>
                      <button type="button" disabled={editSaving} className="cursor-pointer rounded-lg bg-theme-accent px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-60" onClick={() => void saveContact(contact)}>{editSaving ? '…' : t('contacts.saveChanges')}</button>
                    </div>
                  </div>
                )}
                {pendingDeleteId === contact.id && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-400/45 bg-red-500/10 p-2">
                    <span className="text-xs text-heading">{t('contacts.confirmDelete', { name: contactDisplayName(contact) })}</span>
                    <div className="flex gap-2">
                      <button type="button" className="cursor-pointer rounded-lg border border-theme-border px-2.5 py-1 text-xs font-semibold text-info hover:text-heading" onClick={() => setPendingDeleteId(null)}>{t('common.cancel')}</button>
                      <button type="button" className="cursor-pointer rounded-lg border border-red-400/50 bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/25 hover:text-white" onClick={() => void deleteContact(contact.id)}>{t('common.delete')}</button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
