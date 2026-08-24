import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../src/pitch.js';

const SAMPLE_RATE = 44100;
const N = 8192;

function synth(frequency, shape = 'sine', n = N, sampleRate = SAMPLE_RATE) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const phase = (i * frequency) / sampleRate;
    const t = phase - Math.floor(phase);
    if (shape === 'sine') buf[i] = Math.sin(2 * Math.PI * phase);
    else if (shape === 'saw') buf[i] = 2 * t - 1;
    else if (shape === 'square') buf[i] = t < 0.5 ? 1 : -1;
    else throw new Error(`알 수 없는 파형: ${shape}`);
    buf[i] *= 0.5;
  }
  return buf;
}

function centsBetween(actual, expected) {
  return 1200 * Math.log2(actual / expected);
}

test('순수 사인을 ±1 cent 이내로 검출', () => {
  for (const f of [82.41, 220, 440, 880]) {
    const result = detectPitch(synth(f), SAMPLE_RATE);
    assert.ok(result, `${f}Hz 검출 실패`);
    const err = centsBetween(result.frequency, f);
    assert.ok(Math.abs(err) <= 1, `${f}Hz -> ${result.frequency.toFixed(3)}Hz (${err.toFixed(2)} cent)`);
  }
});

test('톱니파에서 기본 주파수를 잡는다 (옥타브 오검출 없음)', () => {
  for (const f of [98, 196, 440]) {
    const result = detectPitch(synth(f, 'saw'), SAMPLE_RATE);
    assert.ok(result, `saw ${f}Hz 검출 실패`);
    const err = centsBetween(result.frequency, f);
    assert.ok(Math.abs(err) <= 5, `saw ${f}Hz -> ${result.frequency.toFixed(3)}Hz (${err.toFixed(2)} cent)`);
  }
});

test('구형파에서 기본 주파수를 잡는다', () => {
  for (const f of [110, 330]) {
    const result = detectPitch(synth(f, 'square'), SAMPLE_RATE);
    assert.ok(result, `square ${f}Hz 검출 실패`);
    const err = centsBetween(result.frequency, f);
    assert.ok(Math.abs(err) <= 5, `square ${f}Hz -> ${result.frequency.toFixed(3)}Hz (${err.toFixed(2)} cent)`);
  }
});

test('무음은 null', () => {
  assert.equal(detectPitch(new Float32Array(N), SAMPLE_RATE), null);
});

test('rms 문턱 아래의 아주 작은 신호는 null', () => {
  const quiet = synth(440);
  for (let i = 0; i < quiet.length; i++) quiet[i] *= 0.001;
  assert.equal(detectPitch(quiet, SAMPLE_RATE), null);
});

test('백색잡음은 null (clarity 문턱)', () => {
  let seed = 12345;
  const noise = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  assert.equal(detectPitch(noise, SAMPLE_RATE), null);
});

test('검출 범위 밖의 주파수는 null', () => {
  const tooLow = detectPitch(synth(30), SAMPLE_RATE);
  assert.equal(tooLow, null);
  const tooHigh = detectPitch(synth(3000), SAMPLE_RATE);
  assert.equal(tooHigh, null);
});

test('clarity는 0과 1 사이이며 깨끗한 사인에서 높다', () => {
  const result = detectPitch(synth(440), SAMPLE_RATE);
  assert.ok(result.clarity > 0.9 && result.clarity <= 1, `clarity=${result.clarity}`);
});

test('버퍼가 너무 짧으면 null', () => {
  assert.equal(detectPitch(new Float32Array(1), SAMPLE_RATE), null);
});
