import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_STATE, changedFields, createSilenceGate } from '../src/render-state.js';

test('EMPTY_STATE는 모든 표시 필드를 가진다', () => {
  const expected = [
    'active', 'note', 'octave', 'frequency', 'cents', 'tuneState',
    'volume', 'a4', 'tuningId', 'activeStringLabel', 'message',
  ];
  assert.deepEqual(Object.keys(EMPTY_STATE).sort(), expected.sort());
});

test('prev가 null이면 모든 필드가 변경된 것으로 본다', () => {
  const changed = changedFields(null, { ...EMPTY_STATE, note: 'A' });
  assert.equal(changed.length, Object.keys(EMPTY_STATE).length);
});

test('같은 상태면 변경 필드가 없다', () => {
  const state = { ...EMPTY_STATE, note: 'A', cents: 3 };
  assert.deepEqual(changedFields(state, { ...state }), []);
});

test('달라진 필드만 돌려준다', () => {
  const prev = { ...EMPTY_STATE, note: 'A', cents: 3, volume: 50 };
  const next = { ...prev, cents: 4 };
  assert.deepEqual(changedFields(prev, next), ['cents']);
});

test('null에서 값으로 바뀐 것도 변경으로 잡는다', () => {
  const prev = { ...EMPTY_STATE };
  const next = { ...EMPTY_STATE, note: 'A' };
  assert.deepEqual(changedFields(prev, next), ['note']);
});

test('무음 게이트는 홀드 시간 안에서는 마지막 값을 유지한다', () => {
  const gate = createSilenceGate(500);
  const pitch = { frequency: 440, clarity: 0.95 };

  assert.deepEqual(gate.update(pitch, 1000), pitch);
  assert.deepEqual(gate.update(null, 1200), pitch, '200ms 후에는 유지되어야 한다');
  assert.deepEqual(gate.update(null, 1499), pitch, '499ms 후에는 유지되어야 한다');
});

test('홀드 시간이 지나면 null을 돌려준다', () => {
  const gate = createSilenceGate(500);
  const pitch = { frequency: 440, clarity: 0.95 };
  gate.update(pitch, 1000);
  assert.equal(gate.update(null, 1500), null);
  assert.equal(gate.update(null, 9999), null);
});

test('새 검출이 들어오면 홀드가 갱신된다', () => {
  const gate = createSilenceGate(500);
  const a = { frequency: 440, clarity: 0.95 };
  const b = { frequency: 220, clarity: 0.9 };
  gate.update(a, 1000);
  gate.update(null, 1400);
  assert.deepEqual(gate.update(b, 1450), b);
  assert.deepEqual(gate.update(null, 1900), b, '홀드 기준이 1450으로 갱신되어야 한다');
  assert.equal(gate.update(null, 1950), null);
});

test('검출 없이 시작하면 null', () => {
  const gate = createSilenceGate(500);
  assert.equal(gate.update(null, 1000), null);
});

test('reset은 보관 중인 값을 버린다', () => {
  const gate = createSilenceGate(500);
  gate.update({ frequency: 440, clarity: 0.95 }, 1000);
  gate.reset();
  assert.equal(gate.update(null, 1100), null);
});
