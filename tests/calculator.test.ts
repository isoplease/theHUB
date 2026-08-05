import assert from 'node:assert/strict';
import test from 'node:test';
import { CalculatorError, evaluateCalculatorExpression } from '../src/services/calculator.ts';

function result(expression: string, mode: 'DEG' | 'RAD' = 'DEG'): string {
  return evaluateCalculatorExpression(expression, mode).display;
}

test('işlem önceliğini ve parantezleri doğru hesaplar', () => {
  assert.equal(result('2+3*4'), '14');
  assert.equal(result('(2+3)*4'), '20');
});

test('ondalık işlemlerde kayan nokta hatasını önler', () => {
  assert.equal(result('0.1+0.2'), '0.3');
  assert.equal(result('1/3'), '0.33333333333333');
});

test('üs, kök, logaritma ve faktöriyeli hesaplar', () => {
  assert.equal(result('2^10'), '1024');
  assert.equal(result('sqrt(144)'), '12');
  assert.equal(result('log10(1000)'), '3');
  assert.equal(result('log(e)'), '1');
  assert.equal(result('5!'), '120');
});

test('derece modunda trigonometrik fonksiyonları hesaplar', () => {
  assert.equal(result('sin(30)'), '0.5');
  assert.equal(result('cos(60)'), '0.5');
  assert.equal(result('tan(45)'), '1');
  assert.equal(result('asin(0.5)'), '30');
});

test('radyan modunda trigonometrik fonksiyonları hesaplar', () => {
  assert.equal(result('sin(pi/2)', 'RAD'), '1');
  assert.equal(result('cos(pi)', 'RAD'), '-1');
});

test('tanjantın tanımsız olduğu açıları reddeder', () => {
  assert.throws(() => result('tan(90)'), CalculatorError);
  assert.throws(() => result('tan(pi/2)', 'RAD'), CalculatorError);
});

test('geçersiz ve riskli ifadeleri reddeder', () => {
  assert.throws(() => result('a=2'), CalculatorError);
  assert.throws(() => result('[1,2]'), CalculatorError);
  assert.throws(() => result('sqrt(-1)'), CalculatorError);
  assert.throws(() => result('1/0'), CalculatorError);
  assert.throws(() => result('501!'), CalculatorError);
  assert.throws(() => result('(501)!'), CalculatorError);
  assert.throws(() => result('5!!'), CalculatorError);
  assert.throws(() => result('2^10001'), CalculatorError);
  assert.throws(() => result('2^(10001)'), CalculatorError);
});
