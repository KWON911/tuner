/**
 * 악기 튜닝 프리셋. midi는 MIDI 노트 번호(C4 = 60, A4 = 69).
 * strings는 UI에 표시되는 순서대로 나열한다.
 */
export const TUNINGS = {
  chromatic: {
    id: 'chromatic',
    label: '크로매틱',
    strings: [],
  },
  guitar: {
    id: 'guitar',
    label: '기타',
    strings: [
      { label: '6 E2', midi: 40 },
      { label: '5 A2', midi: 45 },
      { label: '4 D3', midi: 50 },
      { label: '3 G3', midi: 55 },
      { label: '2 B3', midi: 59 },
      { label: '1 E4', midi: 64 },
    ],
  },
  bass: {
    id: 'bass',
    label: '베이스',
    strings: [
      { label: '4 E1', midi: 28 },
      { label: '3 A1', midi: 33 },
      { label: '2 D2', midi: 38 },
      { label: '1 G2', midi: 43 },
    ],
  },
  ukulele: {
    id: 'ukulele',
    label: '우쿨렐레',
    // 재진입(reentrant) 튜닝: 4번 줄이 3번보다 높다
    strings: [
      { label: '4 G4', midi: 67 },
      { label: '3 C4', midi: 60 },
      { label: '2 E4', midi: 64 },
      { label: '1 A4', midi: 69 },
    ],
  },
  violin: {
    id: 'violin',
    label: '바이올린',
    strings: [
      { label: 'G3', midi: 55 },
      { label: 'D4', midi: 62 },
      { label: 'A4', midi: 69 },
      { label: 'E5', midi: 76 },
    ],
  },
};

export const TUNING_IDS = ['chromatic', 'guitar', 'bass', 'ukulele', 'violin'];

/**
 * 주어진 MIDI 값에 가장 가까운 줄을 돌려준다.
 * 거리가 같으면 낮은 음의 줄을 고른다. 줄이 없으면 null.
 */
export function nearestString(midi, tuning) {
  if (!tuning || !Array.isArray(tuning.strings) || tuning.strings.length === 0) {
    return null;
  }

  let best = null;
  let bestDistance = Infinity;
  for (const string of tuning.strings) {
    const distance = Math.abs(string.midi - midi);
    if (distance < bestDistance || (distance === bestDistance && string.midi < best.midi)) {
      best = string;
      bestDistance = distance;
    }
  }
  return best;
}
