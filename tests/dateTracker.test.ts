import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDateKey,
  calendarDaysElapsedSince,
  calendarDaysRemaining,
  formatTrackedDate,
  isValidDateKey,
  localDateKey,
  sortTrackedDateEvents,
} from '../src/services/dateTracker.ts';
import type { DateEventItem } from '../src/types/app.ts';

test('geçerli ve geçersiz takvim tarihlerini ayırt eder', () => {
  assert.equal(isValidDateKey('2028-02-29'), true);
  assert.equal(isValidDateKey('2027-02-29'), false);
  assert.equal(isValidDateKey('2026-13-01'), false);
  assert.equal(isValidDateKey('26-08-01'), false);
});

test('tarih alanlarından güvenli kayıt anahtarı üretir', () => {
  assert.equal(buildDateKey(2027, 3, 5), '2027-03-05');
});

test('kalan günü saat ve yaz saati farklarından etkilenmeden hesaplar', () => {
  const today = new Date(2026, 7, 26, 23, 59, 59);
  assert.equal(calendarDaysRemaining('2026-08-26', today), 0);
  assert.equal(calendarDaysRemaining('2026-09-20', today), 25);
  assert.equal(calendarDaysRemaining('2026-08-25', today), -1);
});

test('süresiz başlangıç tarihinden itibaren geçen günü hesaplar', () => {
  const today = new Date(2026, 8, 2, 23, 59, 59);
  assert.equal(calendarDaysElapsedSince('2026-09-02', today), 0);
  assert.equal(calendarDaysElapsedSince('2026-08-03', today), 30);
});

test('iki tarih gösterim biçimini destekler', () => {
  assert.equal(formatTrackedDate('2027-03-05', 'dmy'), '05/03/2027');
  assert.equal(formatTrackedDate('2027-03-05', 'mdy'), '03/05/2027');
});

test('yerel tarihi saat dilimini koruyarak anahtara çevirir', () => {
  assert.equal(localDateKey(new Date(2026, 7, 6, 1)), '2026-08-06');
});

test('tarihleri eklenme sırasından bağımsız olarak en yakından en uzağa sıralar', () => {
  const items: DateEventItem[] = [
    { id: 'far', title: 'Uzak', date: '2029-02-10', format: 'dmy', createdAt: '2026-08-26T10:00:00.000Z' },
    { id: 'near', title: 'Yakın', date: '2026-09-01', format: 'dmy', createdAt: '2026-08-26T12:00:00.000Z' },
    { id: 'middle', title: 'Orta', date: '2027-04-15', format: 'mdy', createdAt: '2026-08-26T11:00:00.000Z' },
  ];

  assert.deepEqual(sortTrackedDateEvents(items).map((item) => item.id), ['near', 'middle', 'far']);
  assert.deepEqual(items.map((item) => item.id), ['far', 'near', 'middle']);
});

test('normal tarihleri korur ve süresiz kayıtları başlangıç tarihine göre ardından sıralar', () => {
  const items: DateEventItem[] = [
    { id: 'old-contract', title: 'Eski sözleşme', date: '2020-01-01', format: 'dmy', indefinite: true, createdAt: '2026-08-26T10:00:00.000Z' },
    { id: 'deadline', title: 'Lisans', date: '2026-10-01', format: 'dmy', createdAt: '2026-08-26T12:00:00.000Z' },
    { id: 'new-contract', title: 'Yeni sözleşme', date: '2025-01-01', format: 'dmy', indefinite: true, createdAt: '2026-08-26T11:00:00.000Z' },
  ];

  assert.deepEqual(
    sortTrackedDateEvents(items).map((item) => item.id),
    ['deadline', 'new-contract', 'old-contract'],
  );
});
