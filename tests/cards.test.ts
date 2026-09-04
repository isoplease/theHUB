import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CARD_ORDER, parseCardVisibility, reorderVisibleCards } from '../src/services/cards.ts';

test('eski medya tercihini korur ve diğer kartları açık başlatır', () => {
  const visibility = parseCardVisibility(null, 'false');
  assert.equal(visibility.media, false);
  for (const card of DEFAULT_CARD_ORDER.filter((card) => card !== 'media')) {
    assert.equal(visibility[card], true);
  }
});

test('kayıtlı tercihler eski medya ayarından önceliklidir; bozuk değerler yok sayılır', () => {
  const visibility = parseCardVisibility('{"media":true,"notes":false,"tasks":"false","unknown":false}', 'false');
  assert.equal(visibility.media, true);
  assert.equal(visibility.notes, false);
  assert.equal(visibility.tasks, true);
  assert.equal(Object.keys(visibility).length, 7);
  for (const stored of ['{', '[]', 'null', 'false']) {
    assert.deepEqual(parseCardVisibility(stored, 'false'), parseCardVisibility(null, 'false'));
  }
});

test('tüm kartları kapatma tercihi yeniden yüklenirken korunur', () => {
  const allHidden = Object.fromEntries(DEFAULT_CARD_ORDER.map((card) => [card, false]));
  assert.deepEqual(parseCardVisibility(JSON.stringify(allHidden), null), allHidden);
});

test('görünür kartları taşırken gizli kartların yeri ve tüm kartlar korunur', () => {
  const order = [...DEFAULT_CARD_ORDER];
  const visibility = parseCardVisibility('{"media":false,"notes":false}', null);
  const next = reorderVisibleCards(order, visibility, 'timeTools', 'tasks');
  assert.deepEqual(next, ['shortcuts', 'media', 'timeTools', 'tasks', 'notes', 'dateTracker', 'calculator']);
  assert.deepEqual(order, DEFAULT_CARD_ORDER);
  assert.equal(new Set(next).size, DEFAULT_CARD_ORDER.length);
  assert.deepEqual(reorderVisibleCards(next, visibility, 'timeTools', 'calculator'), order);
  assert.equal(reorderVisibleCards(order, visibility, 'media', 'tasks'), order);
});
