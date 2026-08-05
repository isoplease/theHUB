import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampTimerPart,
  formatStopwatch,
  formatTimer,
  timerPartsToMilliseconds,
} from '../src/services/timeTools.ts';

test('kronometreyi dakika, saniye ve salise biçiminde gösterir', () => {
  assert.equal(formatStopwatch(0), '00:00.00');
  assert.equal(formatStopwatch(61_239), '01:01.23');
  assert.equal(formatStopwatch(3_600_000), '60:00.00');
});

test('zamanlayıcıyı 24 saat biçiminde gösterir', () => {
  assert.equal(formatTimer(0), '00:00:00');
  assert.equal(formatTimer(3_661_000), '01:01:01');
  assert.equal(formatTimer(86_399_000), '23:59:59');
});

test('zamanlayıcı parçalarını geçerli sınırlarda tutar', () => {
  assert.equal(clampTimerPart(-4, 59), 0);
  assert.equal(clampTimerPart(72, 59), 59);
  assert.equal(clampTimerPart(12.8, 59), 12);
  assert.equal(timerPartsToMilliseconds(23, 59, 59), 86_399_000);
  assert.equal(timerPartsToMilliseconds(24, 70, -1), 86_340_000);
});
