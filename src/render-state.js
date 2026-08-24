/** 렌더러가 다루는 표시 상태의 초기값. */
export const EMPTY_STATE = Object.freeze({
  active: false,
  note: null,
  octave: null,
  frequency: null,
  cents: null,
  tuneState: null,
  volume: 0,
  a4: 440,
  tuningId: 'chromatic',
  activeStringLabel: null,
  message: '버튼을 눌러 마이크를 활성화하세요',
});

/**
 * 두 상태에서 값이 달라진 필드 이름을 돌려준다.
 * prev가 null이면 전체 필드를 변경으로 본다(최초 렌더).
 */
export function changedFields(prev, next) {
  const keys = Object.keys(EMPTY_STATE);
  if (prev === null || prev === undefined) return keys;
  return keys.filter((key) => prev[key] !== next[key]);
}

/**
 * 검출이 끊겨도 holdMs 동안 마지막 결과를 유지한다.
 * 연주 중 음이 잠깐 끊길 때마다 표시가 초기화되며 깜빡이는 것을 막는다.
 * now는 호출자가 넘긴다(테스트 가능하도록).
 */
export function createSilenceGate(holdMs = 500) {
  let last = null;
  let lastAt = 0;

  return {
    update(pitch, now) {
      if (pitch) {
        last = pitch;
        lastAt = now;
        return pitch;
      }
      if (last !== null && now - lastAt < holdMs) return last;
      last = null;
      return null;
    },
    reset() {
      last = null;
      lastAt = 0;
    },
  };
}
