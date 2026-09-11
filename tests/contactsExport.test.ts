import assert from 'node:assert/strict';
import test from 'node:test';
import { createContactsHtml, createContactsText } from '../src/services/contactsExport.ts';
import type { ContactItem } from '../src/types/app.ts';

const labels = {
  title: 'Contacts', name: 'Full Name', phone: 'Phone', email: 'Email',
  organization: 'Organization', notes: 'Notes',
};

const contacts: ContactItem[] = [
  {
    id: '1', firstName: 'Ada', lastName: 'Lovelace', phone: '+44 123',
    email: 'ada@example.com', organization: 'Analytical Engine', notes: 'First line\nSecond line',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '2', firstName: '<Grace>', lastName: 'Hopper', phone: '',
    email: 'grace@example.com', organization: 'Navy & Computing', notes: '',
    createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

test('contact TXT export keeps contacts and fields in a readable order', () => {
  const output = createContactsText(contacts, labels);
  assert.ok(output.indexOf('1. Full Name: Ada Lovelace') < output.indexOf('2. Full Name: <Grace> Hopper'));
  assert.match(output, /Phone: \+44 123\n   Email: ada@example\.com/);
  assert.match(output, /Notes: First line\n   Second line/);
});

test('contact HTML export uses a structured table and escapes contact data', () => {
  const output = createContactsHtml(contacts, labels, 'en');
  assert.match(output, /<table>/);
  assert.match(output, /<th>Full Name<\/th>/);
  assert.match(output, /&lt;Grace&gt; Hopper/);
  assert.match(output, /Navy &amp; Computing/);
  assert.doesNotMatch(output, /<td><Grace>/);
});
