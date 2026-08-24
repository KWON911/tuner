export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A4의 MIDI 노트 번호. */
export const A4_MIDI = 69;

/**
 * MIDI 노트 번호를 주파수로 변환한다.
 * midi는 정수가 아니어도 되며, 반음 사이 값을 넘기면 그 사이 주파수를 돌려준다.
 */
export function noteToFrequency(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * 주파수를 가장 가까운 반음과 그로부터의 센트 편차로 변환한다.
 * cents는 -50 이상 50 이하의 정수다. Math.round가 두 번 걸리므로
 * 양 끝값이 모두 나올 수 있다.
 */
export function frequencyToNote(frequency, a4 = 440) {
  const exact = A4_MIDI + 12 * Math.log2(frequency / a4);
  const midi = Math.round(exact);
  const cents = Math.round((exact - midi) * 100);
  const index = ((midi % 12) + 12) % 12;

  return {
    midi,
    name: NOTE_NAMES[index],
    octave: Math.floor(midi / 12) - 1,
    cents,
    exactFrequency: noteToFrequency(midi, a4),
  };
}
