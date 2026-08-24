import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNINGS, TUNING_IDS, nearestString } from '../src/tunings.js';
import { frequencyToNote, noteToFrequency } from '../src/notes.js';

test('TUNING_IDS는 크로매틱으로 시작하고 모든 프리셋을 담는다', () => {
  assert.equal(TUNING_IDS[0], 'chromatic');
  assert.deepEqual([...TUNING_IDS].sort(), Object.keys(TUNINGS).sort());
});

test('각 프리셋의 id가 키와 일치하고 label이 비어 있지 않다', () => {
  for (const [key, tuning] of Object.entries(TUNINGS)) {
    assert.equal(tuning.id, key);
    assert.ok(tuning.label.length > 0, key);
    assert.ok(Array.isArray(tuning.strings), key);
  }
});

test('기타 표준 튜닝은 E2 A2 D3 G3 B3 E4', () => {
  assert.deepEqual(TUNINGS.guitar.strings.map((s) => s.midi), [40, 45, 50, 55, 59, 64]);
});

test('베이스는 E1 A1 D2 G2', () => {
  assert.deepEqual(TUNINGS.bass.strings.map((s) => s.midi), [28, 33, 38, 43]);
});

test('우쿨렐레는 재진입 튜닝 G4 C4 E4 A4', () => {
  assert.deepEqual(TUNINGS.ukulele.strings.map((s) => s.midi), [67, 60, 64, 69]);
});

test('바이올린은 G3 D4 A4 E5', () => {
  assert.deepEqual(TUNINGS.violin.strings.map((s) => s.midi), [55, 62, 69, 76]);
});

test('프리셋 줄의 MIDI 번호가 이름과 맞는다', () => {
  for (const tuning of Object.values(TUNINGS)) {
    for (const string of tuning.strings) {
      const note = frequencyToNote(noteToFrequency(string.midi, 440), 440);
      const expected = `${note.name}${note.octave}`;
      assert.ok(
        string.label.includes(expected),
        `${tuning.id}: label "${string.label}"에 ${expected}가 없음`
      );
    }
  }
});

test('nearestString은 가장 가까운 줄을 고른다', () => {
  assert.equal(nearestString(40, TUNINGS.guitar).midi, 40);
  assert.equal(nearestString(41, TUNINGS.guitar).midi, 40);
  assert.equal(nearestString(44, TUNINGS.guitar).midi, 45);
  assert.equal(nearestString(100, TUNINGS.guitar).midi, 64);
  assert.equal(nearestString(0, TUNINGS.guitar).midi, 40);
});

test('동점이면 낮은 쪽 줄', () => {
  // 기타 6번(40)과 5번(45) 사이 정확한 중간
  assert.equal(nearestString(42.5, TUNINGS.guitar).midi, 40);
});

test('크로매틱은 줄이 없으므로 null', () => {
  assert.equal(TUNINGS.chromatic.strings.length, 0);
  assert.equal(nearestString(60, TUNINGS.chromatic), null);
});

test('tuning이 없으면 null', () => {
  assert.equal(nearestString(60, null), null);
  assert.equal(nearestString(60, undefined), null);
});
