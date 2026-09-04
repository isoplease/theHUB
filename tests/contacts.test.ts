import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContactInput, sortContacts } from '../src/services/contacts.ts';
import type { ContactItem } from '../src/types/app.ts';

const contacts: ContactItem[] = [
  { id: '2', firstName: 'Zeynep', lastName: 'Ak', phone: '', email: '', organization: '', notes: '', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: '1', firstName: 'Ahmet', lastName: 'Can', phone: '', email: '', organization: '', notes: '', createdAt: '2026-01-02T00:00:00.000Z' },
];

test('kişileri düz listede eklenme sırasıyla tutar ve A-Z sıralar', () => {
  assert.deepEqual(sortContacts(contacts, 'flat', 'tr-TR').map(({ id }) => id), ['2', '1']);
  assert.deepEqual(sortContacts(contacts, 'alphabetical', 'tr-TR').map(({ id }) => id), ['1', '2']);
});

test('kişi alanlarını temizler ve geçersiz e-postayı reddeder', () => {
  assert.deepEqual(normalizeContactInput({
    firstName: '  Ada ', lastName: ' Lovelace ', phone: ' 123 ', email: ' ada@example.com ', organization: ' Math ', notes: ' Note ',
  }), {
    firstName: 'Ada', lastName: 'Lovelace', phone: '123', email: 'ada@example.com', organization: 'Math', notes: 'Note',
  });
  assert.equal(normalizeContactInput({ firstName: 'Ada', lastName: '', phone: '', email: 'invalid', organization: '', notes: '' }), null);
  assert.equal(normalizeContactInput({ firstName: ' ', lastName: '', phone: '', email: '', organization: '', notes: '' }), null);
  assert.equal(normalizeContactInput({ firstName: 'Ada' } as never), null);
});
