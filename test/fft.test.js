import test from 'node:test';
import assert from 'node:assert/strict';
import { fft, ifft, nextPow2 } from '../src/fft.js';

test('nextPow2', () => {
  assert.equal(nextPow2(1), 1);
  assert.equal(nextPow2(2), 2);
  assert.equal(nextPow2(3), 4);
  assert.equal(nextPow2(1000), 1024);
  assert.equal(nextPow2(1024), 1024);
  assert.throws(() => nextPow2(0), RangeError);
});

test('임펄스의 스펙트럼은 모든 빈에서 크기 1', () => {
  const n = 16;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re[0] = 1;
  fft(re, im);
  for (let i = 0; i < n; i++) {
    const mag = Math.hypot(re[i], im[i]);
    assert.ok(Math.abs(mag - 1) < 1e-12, `bin ${i} -> ${mag}`);
  }
});

test('단일 사인의 에너지는 해당 빈에 모인다', () => {
  const n = 64;
  const k = 5;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * k * i) / n);
  fft(re, im);
  const mag = (i) => Math.hypot(re[i], im[i]);
  assert.ok(Math.abs(mag(k) - n / 2) < 1e-9, `bin ${k} -> ${mag(k)}`);
  assert.ok(Math.abs(mag(n - k) - n / 2) < 1e-9);
  for (let i = 0; i < n; i++) {
    if (i === k || i === n - k) continue;
    assert.ok(mag(i) < 1e-9, `bin ${i} 누설 ${mag(i)}`);
  }
});

test('FFT -> IFFT 왕복이 원본과 일치', () => {
  const n = 256;
  const original = new Float64Array(n);
  for (let i = 0; i < n; i++) original[i] = Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7);
  const re = Float64Array.from(original);
  const im = new Float64Array(n);
  fft(re, im);
  ifft(re, im);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(re[i] - original[i]) < 1e-10, `index ${i}`);
    assert.ok(Math.abs(im[i]) < 1e-10, `index ${i} 허수부 ${im[i]}`);
  }
});

test('길이가 2의 거듭제곱이 아니면 RangeError', () => {
  assert.throws(() => fft(new Float64Array(3), new Float64Array(3)), RangeError);
});

test('re와 im의 길이가 다르면 RangeError', () => {
  assert.throws(() => fft(new Float64Array(4), new Float64Array(8)), RangeError);
});
