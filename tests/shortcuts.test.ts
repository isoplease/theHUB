import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeShortcutUrl } from '../src/services/shortcuts.ts';

test('şemasız web adreslerini güvenli HTTPS kısayoluna dönüştürür', () => {
  assert.deepEqual(normalizeShortcutUrl('www.github.com/isoplease'), {
    url: 'https://www.github.com/isoplease',
    name: 'github.com',
  });
});

test('yalnızca HTTP ve HTTPS kısayollarını kabul eder', () => {
  assert.equal(normalizeShortcutUrl('javascript:alert(1)'), null);
  assert.equal(normalizeShortcutUrl('file:///C:/Windows/System32'), null);
  assert.equal(normalizeShortcutUrl('https://user:password@example.com'), null);
  assert.equal(normalizeShortcutUrl('https://'), null);
  assert.equal(normalizeShortcutUrl('https://example.com')?.url, 'https://example.com/');
});
