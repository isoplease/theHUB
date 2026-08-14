import assert from 'node:assert/strict';
import test from 'node:test';
import { getUpcomingMinuteReminder } from '../src/services/reminderSchedule.ts';

const MINUTE_MS = 60_000;
const due = Date.parse('2026-08-14T12:00:00');

test('görev saatinden 30, 10 ve 5 dakika önce doğru aşamayı seçer', () => {
  assert.equal(getUpcomingMinuteReminder(due - 30 * MINUTE_MS, due), 30);
  assert.equal(getUpcomingMinuteReminder(due - 10 * MINUTE_MS, due), 10);
  assert.equal(getUpcomingMinuteReminder(due - 5 * MINUTE_MS, due), 5);
});

test('uygulama geç açıldığında geçmiş uyarıları topluca üretmez', () => {
  assert.equal(getUpcomingMinuteReminder(due - 8 * MINUTE_MS, due), 10);
  assert.equal(getUpcomingMinuteReminder(due - 4 * MINUTE_MS, due), 5);
});

test('30 dakikadan önce veya görev saati geçtikten sonra uyarı üretmez', () => {
  assert.equal(getUpcomingMinuteReminder(due - 31 * MINUTE_MS, due), null);
  assert.equal(getUpcomingMinuteReminder(due, due), null);
  assert.equal(getUpcomingMinuteReminder(due + MINUTE_MS, due), null);
});
