import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_NAMES, A4_MIDI, noteToFrequency, frequencyToNote } from '../src/notes.js';

test('NOTE_NAMES는 C부터 시작하는 12개 반음', () => {
  assert.equal(NOTE_NAMES.length, 12);
  assert.equal(NOTE_NAMES[0], 'C');
  assert.equal(NOTE_NAMES[9], 'A');
});

test('A4 = 440에서 440Hz는 A4, 0 cent', () => {
  const n = frequencyToNote(440, 440);
  assert.equal(n.midi, A4_MIDI);
  assert.equal(n.name, 'A');
  assert.equal(n.octave, 4);
  assert.equal(n.cents, 0);
});

test('C4는 MIDI 60, 옥타브 4', () => {
  const n = frequencyToNote(noteToFrequency(60, 440), 440);
  assert.equal(n.midi, 60);
  assert.equal(n.name, 'C');
  assert.equal(n.octave, 4);
});

test('기준음을 바꾸면 같은 주파수가 다른 센트로 읽힌다', () => {
  const at440 = frequencyToNote(440, 440);
  const at432 = frequencyToNote(440, 432);
  assert.equal(at440.cents, 0);
  assert.ok(at432.cents > 0, `432 기준에서는 440Hz가 높게 읽혀야 하는데 ${at432.cents}`);
});

test('보정된 기준음에서도 왕복이 일치한다', () => {
  for (const a4 of [440, 432, 415, 466]) {
    for (const midi of [28, 40, 60, 69, 76, 100]) {
      const n = frequencyToNote(noteToFrequency(midi, a4), a4);
      assert.equal(n.midi, midi, `a4=${a4} midi=${midi}`);
      assert.equal(n.cents, 0, `a4=${a4} midi=${midi}`);
      assert.ok(Math.abs(n.exactFrequency - noteToFrequency(midi, a4)) < 1e-9);
    }
  }
});

test('두 반음의 정확한 중간은 위쪽 노트로 올림되고 cents는 -50', () => {
  const mid = noteToFrequency(69.5, 440);
  const n = frequencyToNote(mid, 440);
  assert.equal(n.midi, 70);
  assert.equal(n.cents, -50);
});

test('cents 상한은 50', () => {
  const nearlyHalf = noteToFrequency(69 + 0.4999, 440);
  const n = frequencyToNote(nearlyHalf, 440);
  assert.equal(n.midi, 69);
  assert.equal(n.cents, 50);
});

test('cents는 항상 -50 이상 50 이하의 정수', () => {
  for (let i = 0; i < 2000; i++) {
    const f = 60 + (1900 * i) / 2000;
    const { cents } = frequencyToNote(f, 440);
    assert.ok(Number.isInteger(cents), `${f}Hz -> ${cents}`);
    assert.ok(cents >= -50 && cents <= 50, `${f}Hz -> ${cents}`);
  }
});
