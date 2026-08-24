# 크로매틱 튜너 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 `index.html` 튜너를 빌드 없는 ES 모듈 구조로 재편하고, 음정 검출을 O(n log n) FFT 기반 NSDF로 교체해 Web Worker로 옮기며, 기준음 보정·튜닝 프리셋·기준음 재생을 추가한다.

**Architecture:** 브라우저 API에 의존하지 않는 순수 모듈(`fft` / `pitch` / `notes` / `tunings` / `render-state`)과 브라우저 경계 모듈(`audio-engine` / `tone-player` / `ui` / `main`)을 분리한다. 순수 모듈은 `node --test`로 검증하고, 경계 모듈은 브라우저에서 수동 확인한다. 마이크 → `AnalyserNode` → 33ms 폴링 → Worker 검출 → 상태 비교 렌더의 단방향 흐름을 따른다.

**Tech Stack:** 바닐라 JS(ES2022 모듈), Web Audio API, Web Worker(`type: "module"`), `node --test`. 런타임 의존성 없음. 번들러 없음.

## Global Constraints

- 런타임 의존성 0개. `package.json`의 `dependencies`와 `devDependencies`는 비어 있어야 한다.
- 번들러·트랜스파일러 금지. 브라우저가 소스를 그대로 읽는다.
- `package.json`에 `"type": "module"` 필수. `node --test`가 `.js`를 ESM으로 읽기 위해서다.
- 모든 UI 문구는 한국어. 기존 표기(`▶ 마이크 시작`, `■ 중지`, `¢`, `♭`, `♯`)를 유지한다.
- 기존 시각 스타일(색상 변수, 폰트, 레이아웃)을 유지한다. `:root` 색상 변수는 변경 금지.
- MIDI 기준: C4 = 60, A4 = 69.
- `cents` 범위는 -50 이상 50 이하의 정수.
- 음정 검출 허용 오차: 순수 사인 ±1 cent, 하모닉이 있는 파형 ±5 cent.
- 커밋은 각 Task 끝에서 한 번씩. 브랜치는 `tuner-improvements`.

## 스펙 대비 추가 사항

스펙에 없던 파일 두 개를 추가한다. 근거를 함께 남긴다.

- `package.json` — 위 제약 참고. 빌드 단계는 생기지 않는다.
- `src/render-state.js` — 스펙은 상태 비교 렌더와 무음 홀드를 `ui.js`/`main.js`에 두었으나, 두 로직 모두 순수 함수로 뽑아낼 수 있고 이것이 원래 문제 3번(`resetDisplay()` 과다 호출)의 핵심이다. DOM 없이 테스트하기 위해 분리한다. `ui.js`는 이 모듈을 써서 DOM에 반영만 한다.

## 파일 구조

```
package.json            node ESM 해석 + test/serve 스크립트
index.html              마크업만. CSS/JS는 외부 파일
styles.css              기존 <style> 전체 + 신규 컨트롤 스타일
src/
  fft.js                radix-2 복소 FFT (순수)
  pitch.js              FFT 기반 NSDF 검출 (순수, fft.js 의존)
  notes.js              Hz <-> 음이름/센트, A4 보정 (순수)
  tunings.js            악기 프리셋 + nearestString (순수)
  render-state.js       상태 diff + 무음 홀드 게이트 (순수)
  pitch-worker.js       Worker 진입점 (pitch.js 의존)
  audio-engine.js       getUserMedia / AudioContext / 폴링
  tone-player.js        기준음 오실레이터
  ui.js                 DOM 캐시 + 렌더
  main.js               부트스트랩, 배선
test/
  fft.test.js  pitch.test.js  notes.test.js
  tunings.test.js  render-state.test.js
README.md
```

의존 방향은 항상 순수 모듈 쪽으로만 향한다. 순수 모듈은 다른 순수 모듈 외에는 아무것도 import하지 않는다.

---

### Task 1: 프로젝트 뼈대와 `notes.js`

**Files:**
- Create: `package.json`
- Create: `src/notes.js`
- Test: `test/notes.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `NOTE_NAMES: string[]` (길이 12, `'C'` 시작)
  - `A4_MIDI: 69`
  - `noteToFrequency(midi: number, a4?: number) -> number`
  - `frequencyToNote(frequency: number, a4?: number) -> { midi: number, name: string, octave: number, cents: number, exactFrequency: number }`

- [ ] **Step 1: `package.json` 생성**

```json
{
  "name": "tuner",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "브라우저 크로매틱 튜너",
  "scripts": {
    "test": "node --test",
    "serve": "npx --yes serve ."
  }
}
```

`dependencies` 항목 자체를 넣지 않는다. `npm install`은 실행하지 않는다.

`node --test`에 경로를 붙이지 않는 것은 의도된 것이다. 인자 없이 실행하면 Node가 `*.test.js` 파일을 자동으로 찾는다. `node --test test/`처럼 디렉터리를 넘기는 형태는 Windows에서 디렉터리를 모듈로 해석하려다 실패한다(Node 24.18 확인).

- [ ] **Step 2: 실패하는 테스트 작성**

`test/notes.test.js`:

```js
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
```

`noteToFrequency`에 소수 MIDI 값(69.5)을 넘기는 것은 의도된 사용이다. 반음 사이의 정확한 중간 주파수를 만들기 위한 것으로, 함수는 정수를 강제하지 않는다.

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
node --test test/notes.test.js
```

기대: `Cannot find module .../src/notes.js` 로 실패.

- [ ] **Step 4: `src/notes.js` 구현**

```js
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
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
node --test test/notes.test.js
```

기대: 8개 테스트 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add package.json src/notes.js test/notes.test.js
git commit -m "Add notes module with adjustable A4 reference"
```

---

### Task 2: `fft.js`

**Files:**
- Create: `src/fft.js`
- Test: `test/fft.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `nextPow2(n: number) -> number`
  - `fft(re: Float64Array, im: Float64Array) -> void` (in-place)
  - `ifft(re: Float64Array, im: Float64Array) -> void` (in-place, 1/n 정규화 포함)

- [ ] **Step 1: 실패하는 테스트 작성**

`test/fft.test.js`:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
node --test test/fft.test.js
```

기대: 모듈을 찾지 못해 실패.

- [ ] **Step 3: `src/fft.js` 구현**

```js
/** n 이상인 최소의 2의 거듭제곱. */
export function nextPow2(n) {
  if (!Number.isFinite(n) || n < 1) {
    throw new RangeError(`nextPow2: n은 1 이상이어야 합니다 (받은 값: ${n})`);
  }
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function isPow2(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * 반복형 radix-2 Cooley-Tukey FFT. re와 im을 제자리에서 변환한다.
 * 누적 오차를 줄이기 위해 Float64Array를 기대한다.
 */
export function fft(re, im) {
  transform(re, im, false);
}

/** 역변환. 1/n 정규화까지 수행한다. */
export function ifft(re, im) {
  transform(re, im, true);
}

function transform(re, im, inverse) {
  const n = re.length;
  if (im.length !== n) {
    throw new RangeError(`fft: re(${n})와 im(${im.length})의 길이가 같아야 합니다`);
  }
  if (!isPow2(n)) {
    throw new RangeError(`fft: 길이는 2의 거듭제곱이어야 합니다 (받은 값: ${n})`);
  }
  if (n === 1) return;

  // 비트 반전 순열
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const stepR = Math.cos(angle);
    const stepI = Math.sin(angle);
    const half = len >> 1;

    for (let start = 0; start < n; start += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < half; k++) {
        const aR = re[start + k];
        const aI = im[start + k];
        const bR = re[start + k + half];
        const bI = im[start + k + half];

        const tR = bR * wR - bI * wI;
        const tI = bR * wI + bI * wR;

        re[start + k] = aR + tR;
        im[start + k] = aI + tI;
        re[start + k + half] = aR - tR;
        im[start + k + half] = aI - tI;

        const nextR = wR * stepR - wI * stepI;
        wI = wR * stepI + wI * stepR;
        wR = nextR;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
node --test test/fft.test.js
```

기대: 6개 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/fft.js test/fft.test.js
git commit -m "Add radix-2 FFT with in-place transform and inverse"
```

---

### Task 3: `pitch.js`

**Files:**
- Create: `src/pitch.js`
- Test: `test/pitch.test.js`

**Interfaces:**
- Consumes: `fft`, `ifft`, `nextPow2` (Task 2)
- Produces:
  - `DEFAULT_PITCH_OPTIONS: { minFrequency, maxFrequency, clarityThreshold, rmsThreshold, peakRatio }`
  - `detectPitch(buffer: Float32Array | Float64Array | number[], sampleRate: number, options?: object) -> { frequency: number, clarity: number } | null`

**배경 (구현 전 읽을 것):** 자기상관 `r(tau) = sum_j x[j] * x[j+tau]`는 Wiener-Khinchin 정리에 따라 파워 스펙트럼의 역변환으로 얻는다. 신호를 2n 이상으로 zero-pad해야 순환 자기상관이 아닌 선형 자기상관이 나온다.

MPM의 NSDF는 `n(tau) = 2 * r(tau) / m(tau)`이고, `m(tau) = sum_j (x[j]^2 + x[j+tau]^2)`이다. `m`은 `m(0) = 2P` (P는 전체 파워)에서 시작해 `m(tau) = m(tau-1) - x[n-tau]^2 - x[tau-1]^2`로 O(1) 갱신된다. 이 정규화가 하모닉이 강한 신호에서 옥타브 오검출을 줄인다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/pitch.test.js`:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
node --test test/pitch.test.js
```

기대: 모듈을 찾지 못해 실패.

- [ ] **Step 3: `src/pitch.js` 구현**

```js
import { fft, ifft, nextPow2 } from './fft.js';

export const DEFAULT_PITCH_OPTIONS = {
  minFrequency: 50,
  maxFrequency: 2000,
  clarityThreshold: 0.8,
  rmsThreshold: 0.005,
  peakRatio: 0.9,
};

/**
 * FFT 기반 NSDF(McLeod Pitch Method)로 기본 주파수를 검출한다.
 * 검출에 실패하면 null을 돌려준다.
 */
export function detectPitch(buffer, sampleRate, options = {}) {
  const opts = { ...DEFAULT_PITCH_OPTIONS, ...options };
  const n = buffer.length;
  if (n < 64) return null;

  let power = 0;
  for (let i = 0; i < n; i++) power += buffer[i] * buffer[i];
  const rms = Math.sqrt(power / n);
  if (rms < opts.rmsThreshold) return null;

  const autocorr = autocorrelate(buffer, n);

  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / opts.minFrequency));
  const minLag = Math.max(1, Math.floor(sampleRate / opts.maxFrequency));
  if (maxLag <= minLag + 2) return null;

  // NSDF: 2 * r(tau) / m(tau)
  const nsdf = new Float64Array(maxLag + 1);
  let m = 2 * power;
  nsdf[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
    m -= buffer[n - tau] * buffer[n - tau] + buffer[tau - 1] * buffer[tau - 1];
    nsdf[tau] = m > 1e-12 ? (2 * autocorr[tau]) / m : 0;
  }

  const peak = pickPeak(nsdf, maxLag, opts.peakRatio);
  if (peak === null) return null;

  const { position, value } = interpolatePeak(nsdf, peak);
  if (position <= 0) return null;

  const clarity = Math.max(0, Math.min(1, value));
  if (clarity < opts.clarityThreshold) return null;

  const frequency = sampleRate / position;
  if (frequency < opts.minFrequency || frequency > opts.maxFrequency) return null;

  return { frequency, clarity };
}

/** Wiener-Khinchin: 선형 자기상관을 FFT로 계산한다. */
function autocorrelate(buffer, n) {
  const size = nextPow2(2 * n);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = buffer[i];

  fft(re, im);
  for (let i = 0; i < size; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  ifft(re, im);

  return re;
}

/**
 * 첫 음수 구간을 지난 뒤의 극대점을 모아, 최대값의 peakRatio배를 넘는
 * 첫 극대점을 고른다. 최대값 자체를 고르면 옥타브 위로 잘못 잡기 쉽다.
 */
function pickPeak(nsdf, maxLag, peakRatio) {
  let pos = 1;
  while (pos < maxLag && nsdf[pos] > 0) pos++;
  while (pos < maxLag && nsdf[pos] <= 0) pos++;
  if (pos >= maxLag) return null;

  const maxima = [];
  let current = 0;

  while (pos < maxLag) {
    if (nsdf[pos] > nsdf[pos - 1] && nsdf[pos] >= nsdf[pos + 1]) {
      if (current === 0 || nsdf[pos] > nsdf[current]) current = pos;
    }
    pos++;
    if (pos < maxLag && nsdf[pos] <= 0) {
      if (current > 0) {
        maxima.push(current);
        current = 0;
      }
      while (pos < maxLag && nsdf[pos] <= 0) pos++;
    }
  }
  if (current > 0) maxima.push(current);
  if (maxima.length === 0) return null;

  let highest = maxima[0];
  for (const candidate of maxima) {
    if (nsdf[candidate] > nsdf[highest]) highest = candidate;
  }

  const threshold = peakRatio * nsdf[highest];
  for (const candidate of maxima) {
    if (nsdf[candidate] >= threshold) return candidate;
  }
  return highest;
}

/** 극대점 주변 3점에 포물선을 맞춰 소수점 lag와 정점 값을 구한다. */
function interpolatePeak(y, i) {
  if (i <= 0 || i >= y.length - 1) return { position: i, value: y[i] };
  const y0 = y[i - 1];
  const y1 = y[i];
  const y2 = y[i + 1];
  const denom = y0 - 2 * y1 + y2;
  if (denom === 0) return { position: i, value: y1 };
  const delta = (0.5 * (y0 - y2)) / denom;
  return { position: i + delta, value: y1 - 0.25 * (y0 - y2) * delta };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
node --test test/pitch.test.js
```

기대: 9개 테스트 전부 PASS. 실패하면 실제 검출값이 assert 메시지에 찍히므로 옥타브 오검출인지 정밀도 문제인지 구분할 수 있다.

- [ ] **Step 5: 연산량이 실제로 줄었는지 확인**

임시 스크립트로 실행 시간을 잰다. 기존 O(n^2) 구현은 8192 샘플에서 프레임당 3,300만 회 곱셈이었다.

```bash
node --input-type=module -e "import { detectPitch } from './src/pitch.js'; const n = 8192, sr = 44100; const buf = new Float32Array(n); for (let i = 0; i < n; i++) buf[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); detectPitch(buf, sr); const t0 = performance.now(); for (let i = 0; i < 200; i++) detectPitch(buf, sr); console.log('평균', ((performance.now() - t0) / 200).toFixed(3), 'ms');"
```

기대: 프레임당 5ms 미만. 33ms 폴링 주기 안에 충분히 들어가야 한다. 넘으면 다음 Task로 넘어가지 말고 원인을 찾는다.

참고로 이 계획을 세우면서 같은 조건(Node 24.18, 8192 샘플, 44.1kHz)으로 실측한 값이다.

| 구현 | 프레임당 시간 |
|---|---|
| 기존 O(n²) 자기상관 | 164.5 ms |
| 신규 FFT 기반 NSDF | 2.18 ms |

기존 구현은 `requestAnimationFrame`(약 16ms 주기)마다 164ms짜리 작업을 걸고 있었다.
메인 스레드가 포화 상태였다는 뜻이다.

- [ ] **Step 6: 커밋**

```bash
git add src/pitch.js test/pitch.test.js
git commit -m "Replace O(n^2) autocorrelation with FFT-based NSDF detection"
```

---

### Task 4: `tunings.js`

**Files:**
- Create: `src/tunings.js`
- Test: `test/tunings.test.js`

**Interfaces:**
- Consumes: `frequencyToNote`, `noteToFrequency` (Task 1) — 테스트에서만 사용
- Produces:
  - `TUNINGS: Record<string, { id: string, label: string, strings: Array<{ label: string, midi: number }> }>`
  - `TUNING_IDS: string[]` (셀렉트 표시 순서)
  - `nearestString(midi: number, tuning: object) -> { label: string, midi: number } | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/tunings.test.js`:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
node --test test/tunings.test.js
```

기대: 모듈을 찾지 못해 실패.

- [ ] **Step 3: `src/tunings.js` 구현**

```js
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
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
node --test test/tunings.test.js
```

기대: 11개 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/tunings.js test/tunings.test.js
git commit -m "Add instrument tuning presets and nearest-string lookup"
```

---

### Task 5: `render-state.js` — 상태 diff와 무음 홀드

원래 문제 3번(`resetDisplay()`가 무음 프레임마다 호출됨)을 실제로 고치는 로직이다. DOM 없이 검증할 수 있도록 순수 함수로 분리한다.

**Files:**
- Create: `src/render-state.js`
- Test: `test/render-state.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `EMPTY_STATE: object` (아래 11개 필드를 가진 동결된 객체)
  - `changedFields(prev: object | null, next: object) -> string[]`
  - `createSilenceGate(holdMs?: number) -> { update(pitch: object | null, now: number): object | null, reset(): void }`

상태 필드: `active`, `note`, `octave`, `frequency`, `cents`, `tuneState`, `volume`, `a4`, `tuningId`, `activeStringLabel`, `message`.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/render-state.test.js`:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
node --test test/render-state.test.js
```

기대: 모듈을 찾지 못해 실패.

- [ ] **Step 3: `src/render-state.js` 구현**

```js
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
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
node --test test/render-state.test.js
```

기대: 10개 테스트 전부 PASS.

- [ ] **Step 5: 전체 테스트 실행**

```bash
npm test
```

기대: 5개 파일, 44개 테스트 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/render-state.js test/render-state.test.js
git commit -m "Add state diffing and silence hold gate"
```

---

### Task 6: `pitch-worker.js`와 `audio-engine.js`

**Files:**
- Create: `src/pitch-worker.js`
- Create: `src/audio-engine.js`

**Interfaces:**
- Consumes: `detectPitch`, `DEFAULT_PITCH_OPTIONS` (Task 3)
- Produces:
  - `getAudioContext() -> AudioContext` (싱글턴, 최초 호출 시 생성)
  - `createAudioEngine({ onResult, onError, intervalMs?, fftSize?, pitchOptions? }) -> { start(): Promise<void>, stop(): void, isRunning(): boolean }`
  - `onResult` 인자: `{ pitch: { frequency, clarity } | null, rms: number }`
  - `onError` 인자: `{ level: 'error' | 'warn', code: string, message: string }`

브라우저 전용이라 자동 테스트가 없다. Step 5의 수동 확인이 이 Task의 검증이다.

- [ ] **Step 1: `src/pitch-worker.js` 작성**

```js
import { detectPitch } from './pitch.js';

self.onmessage = (event) => {
  const { samples, sampleRate, options, rms } = event.data;
  const pitch = detectPitch(samples, sampleRate, options);
  self.postMessage({ pitch, rms });
};
```

- [ ] **Step 2: `src/audio-engine.js` 작성**

```js
import { detectPitch, DEFAULT_PITCH_OPTIONS } from './pitch.js';

let sharedContext = null;

/**
 * 앱 전체가 공유하는 AudioContext. 마이크 입력과 기준음 재생이 같은
 * 컨텍스트를 쓴다. 사용자 제스처 안에서 처음 호출해야 한다.
 */
export function getAudioContext() {
  if (!sharedContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    sharedContext = new Ctor();
  }
  return sharedContext;
}

/**
 * 마이크에서 주기적으로 버퍼를 읽어 음정 검출 결과를 흘려보낸다.
 * 검출은 Web Worker에서 수행하고, Worker를 만들 수 없으면
 * 같은 함수를 메인 스레드에서 호출하는 폴백으로 돌아간다.
 */
export function createAudioEngine({
  onResult,
  onError,
  intervalMs = 33,
  fftSize = 8192,
  pitchOptions = DEFAULT_PITCH_OPTIONS,
} = {}) {
  let analyser = null;
  let stream = null;
  let timer = null;
  let worker = null;
  let buffer = null;
  let running = false;
  let pending = false;

  function createWorker() {
    try {
      return new Worker(new URL('./pitch-worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      onError?.({
        level: 'warn',
        code: 'WORKER_UNAVAILABLE',
        message: '백그라운드 검출을 쓸 수 없어 메인 스레드에서 처리합니다.',
      });
      return null;
    }
  }

  function measureRms() {
    let power = 0;
    for (let i = 0; i < buffer.length; i++) power += buffer[i] * buffer[i];
    return Math.sqrt(power / buffer.length);
  }

  function tick() {
    if (!running) return;
    analyser.getFloatTimeDomainData(buffer);
    const rms = measureRms();

    if (!worker) {
      onResult?.({ pitch: detectPitch(buffer, sharedContext.sampleRate, pitchOptions), rms });
      return;
    }

    // 이전 요청이 아직 안 끝났으면 이번 틱은 건너뛴다.
    // O(n log n) 검출은 보통 1ms 안에 끝나므로 거의 발생하지 않는다.
    if (pending) return;
    pending = true;

    const samples = new Float32Array(buffer);
    worker.postMessage(
      { samples, sampleRate: sharedContext.sampleRate, options: pitchOptions, rms },
      [samples.buffer]
    );
  }

  async function start() {
    if (running) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      onError?.({ level: 'error', code: err.name, message: describeMicError(err) });
      return;
    }

    const context = getAudioContext();
    if (context.state === 'suspended') await context.resume();

    analyser = context.createAnalyser();
    analyser.fftSize = fftSize;
    // 시간 영역 데이터만 쓰므로 주파수 영역 평활화는 의미가 없다. 0으로 둔다.
    analyser.smoothingTimeConstant = 0;
    context.createMediaStreamSource(stream).connect(analyser);

    buffer = new Float32Array(analyser.fftSize);

    worker = createWorker();
    if (worker) {
      worker.onmessage = (event) => {
        pending = false;
        if (running) onResult?.(event.data);
      };
      worker.onerror = () => {
        onError?.({
          level: 'warn',
          code: 'WORKER_ERROR',
          message: '백그라운드 검출이 중단되어 메인 스레드로 전환합니다.',
        });
        worker.terminate();
        worker = null;
        pending = false;
      };
    }

    running = true;
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    running = false;
    pending = false;
    clearInterval(timer);
    timer = null;

    stream?.getTracks().forEach((track) => track.stop());
    stream = null;

    analyser?.disconnect();
    analyser = null;

    worker?.terminate();
    worker = null;

    // AudioContext는 닫지 않는다. 기준음 재생이 같은 컨텍스트를 쓰고,
    // 다시 시작할 때 재생성 비용을 치를 이유가 없다.
  }

  return { start, stop, isRunning: () => running };
}

function describeMicError(err) {
  if (err.name === 'NotAllowedError') {
    return '마이크 권한이 거부되었습니다. 브라우저 주소창의 권한 설정을 확인해주세요.';
  }
  if (err.name === 'NotFoundError') {
    return '마이크 장치를 찾을 수 없습니다.';
  }
  return `마이크를 열 수 없습니다: ${err.name} — ${err.message}`;
}
```

- [ ] **Step 3: `requestAnimationFrame`을 쓰지 않는지 확인**

```bash
grep -rn "requestAnimationFrame" src/
```

기대: 출력 없음. rAF는 디스플레이 주사율에 종속되어 120Hz 화면에서 두 배로 실행된다.

- [ ] **Step 4: 순수 모듈이 브라우저 API를 참조하지 않는지 확인**

```bash
grep -nE "window|document|navigator|self\." src/fft.js src/pitch.js src/notes.js src/tunings.js src/render-state.js
```

기대: 출력 없음. 하나라도 걸리면 Node 테스트가 깨진다.

- [ ] **Step 5: 임시 하네스로 수동 확인**

`scratch-engine.html`을 만들어 브라우저에서 연다. 이 파일은 Task 11에서 지운다.

```html
<!DOCTYPE html>
<meta charset="UTF-8">
<button id="go">시작</button>
<pre id="out">대기 중</pre>
<script type="module">
  import { createAudioEngine } from './src/audio-engine.js';
  const out = document.getElementById('out');
  const engine = createAudioEngine({
    onResult: ({ pitch, rms }) => {
      out.textContent = pitch
        ? `${pitch.frequency.toFixed(2)} Hz  clarity=${pitch.clarity.toFixed(3)}  rms=${rms.toFixed(4)}`
        : `검출 없음  rms=${rms.toFixed(4)}`;
    },
    onError: (e) => { out.textContent = `[${e.level}] ${e.message}`; },
  });
  document.getElementById('go').onclick = () => engine.start();
</script>
```

```bash
npm run serve
```

브라우저에서 표시된 주소의 `/scratch-engine.html`을 열고 확인한다.

- 시작을 누르면 마이크 권한을 묻는다
- 목소리나 악기 소리에 주파수가 반응한다
- 조용할 때 `검출 없음`이 뜨고 `rms`는 계속 갱신된다
- DevTools Performance에서 30fps 근처로 폴링되고 메인 스레드가 대체로 비어 있다
- Sources 패널에 `pitch-worker.js`가 Worker로 로드되어 있다

- [ ] **Step 6: 커밋**

```bash
git add src/pitch-worker.js src/audio-engine.js
git commit -m "Move pitch detection off the main thread into a module worker"
```

`scratch-engine.html`은 커밋하지 않는다.

---

### Task 7: `tone-player.js`

**Files:**
- Create: `src/tone-player.js`

**Interfaces:**
- Consumes: 없음 (컨텍스트를 인자로 받는다)
- Produces: `createTonePlayer(context: AudioContext) -> { play(frequency: number, durationMs?: number): void, stop(): void }`

- [ ] **Step 1: `src/tone-player.js` 작성**

```js
const PEAK_GAIN = 0.2;
const ATTACK_SEC = 0.01;
const RELEASE_SEC = 0.05;

/**
 * 기준음을 사인파로 재생한다. 게인에 짧은 attack/release 램프를 걸어
 * 오실레이터 시작·정지에서 나는 클릭음을 없앤다.
 */
export function createTonePlayer(context) {
  let oscillator = null;
  let gain = null;

  function stop() {
    if (!oscillator) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + RELEASE_SEC);
    oscillator.stop(now + RELEASE_SEC + 0.01);
    oscillator = null;
    gain = null;
  }

  function play(frequency, durationMs = 2000) {
    stop();

    const now = context.currentTime;
    const end = now + durationMs / 1000;

    oscillator = context.createOscillator();
    gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + ATTACK_SEC);
    gain.gain.setValueAtTime(PEAK_GAIN, end - RELEASE_SEC);
    gain.gain.linearRampToValueAtTime(0, end);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(end + 0.01);

    const started = oscillator;
    started.onended = () => {
      if (oscillator === started) {
        oscillator = null;
        gain = null;
      }
    };
  }

  return { play, stop };
}
```

- [ ] **Step 2: 임시 하네스로 수동 확인**

`scratch-tone.html`을 만든다. Task 11에서 지운다.

```html
<!DOCTYPE html>
<meta charset="UTF-8">
<button id="a4">A4 440</button>
<button id="e2">E2</button>
<button id="stop">정지</button>
<script type="module">
  import { getAudioContext } from './src/audio-engine.js';
  import { createTonePlayer } from './src/tone-player.js';
  import { noteToFrequency } from './src/notes.js';
  let player = null;
  const ensure = () => (player ??= createTonePlayer(getAudioContext()));
  document.getElementById('a4').onclick = () => ensure().play(440);
  document.getElementById('e2').onclick = () => ensure().play(noteToFrequency(40));
  document.getElementById('stop').onclick = () => ensure().stop();
</script>
```

확인 항목:

- A4를 누르면 2초간 440Hz 사인파가 들리고, 시작·끝에 딸깍 소리가 없다
- 재생 중 다른 버튼을 눌러도 딸깍 소리 없이 새 음으로 넘어간다
- 정지를 누르면 부드럽게 끊긴다
- 연속으로 20번 눌러도 소리가 겹쳐 커지지 않는다

- [ ] **Step 3: 커밋**

```bash
git add src/tone-player.js
git commit -m "Add reference tone player with click-free envelope"
```

---

### Task 8: `index.html` / `styles.css` 분리와 신규 마크업

**Files:**
- Create: `styles.css`
- Modify: `index.html` (전체 재작성)

**Interfaces:**
- Consumes: 없음
- Produces (DOM 계약 — Task 9의 `ui.js`가 이 id들을 조회한다):
  `noteName`, `octave`, `freqDisplay`, `needle`, `centsDisplay`, `volFill`,
  `keyboard`, `startBtn`, `status`, `tuningSelect`, `a4Slider`, `a4Value`,
  `a4Reset`, `feedbackWarning`, `fileBanner`

- [ ] **Step 1: CSS를 별도 파일로 옮긴다**

`index.html`의 `<style>`(8행)과 `</style>`(289행) 사이 내용을 그대로 `styles.css`로 옮긴다. 규칙 하나도 바꾸지 않는다.

```bash
sed -n '9,288p' index.html > styles.css
```

확인:

```bash
head -3 styles.css
```

기대: `:root {` 로 시작하는 기존 변수 블록이 보인다.

- [ ] **Step 2: 신규 컨트롤 스타일을 `styles.css` 끝에 덧붙인다**

기존 색상 변수(`--bg`, `--panel`, `--border`, `--accent`, `--text`, `--dim`, `--green`, `--yellow`)를 그대로 쓴다.

```css

/* ---------- 컨트롤 패널 ---------- */

.controls-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.control-label {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.15em;
  color: var(--dim);
  text-transform: uppercase;
  flex: 0 0 60px;
}

.control-select {
  flex: 1;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 0.85rem;
}

.control-slider {
  flex: 1;
  accent-color: var(--accent);
  min-width: 0;
}

.control-value {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.85rem;
  color: var(--text);
  flex: 0 0 66px;
  text-align: right;
}

.control-value.adjusted {
  color: var(--yellow);
}

.control-reset {
  background: transparent;
  color: var(--dim);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 4px 8px;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.7rem;
  cursor: pointer;
}

.control-reset:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* ---------- 줄 목록 (프리셋 선택 시 키보드 자리) ---------- */

.string-btn {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 10px 6px;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: center;
  transition: color 0.1s, border-color 0.1s;
}

.string-btn:hover {
  border-color: var(--accent);
}

.string-btn.active {
  color: var(--accent);
  border-color: var(--accent);
}

.string-btn.active.in-tune {
  color: var(--green);
  border-color: var(--green);
}

/* 키를 button으로 만들기 때문에 브라우저 기본 스타일을 눌러준다 */
.key-btn {
  background: var(--bg);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

/* ---------- 안내 문구 ---------- */

.feedback-warning,
.file-banner {
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 0.75rem;
  line-height: 1.5;
  text-align: center;
}

.feedback-warning {
  border: 1px solid var(--border);
  color: var(--dim);
}

.file-banner {
  border: 1px solid var(--yellow);
  color: var(--yellow);
}

.feedback-warning[hidden],
.file-banner[hidden] {
  display: none;
}
```

- [ ] **Step 3: `index.html`을 다시 쓴다**

`<style>` 블록과 `<script>` 블록을 모두 제거하고 외부 파일을 참조한다. `onclick` 속성도 제거한다. 모듈 스코프에서는 전역 함수가 보이지 않기 때문이다.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>크로매틱 튜너</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Noto+Sans+KR:wght@300;400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
</head>
<body>

<h1>Chromatic Tuner</h1>

<div class="tuner-wrap">

  <div class="file-banner" id="fileBanner" hidden>
    이 페이지는 로컬 서버에서 열어야 동작합니다.
    터미널에서 <code>npm run serve</code> 실행 후 표시되는 주소로 접속해주세요.
  </div>

  <div class="note-panel">
    <div class="note-name silent" id="noteName">—</div>
    <div class="octave" id="octave"></div>
    <div class="freq-display" id="freqDisplay">— Hz</div>
  </div>

  <div class="meter-panel">
    <div class="meter-label">
      <span>♭ -50</span>
      <span>튜닝</span>
      <span>+50 ♯</span>
    </div>
    <div class="meter-track">
      <div class="meter-center"></div>
      <div class="meter-needle" id="needle"></div>
    </div>
    <div class="cents-display" id="centsDisplay">— ¢</div>
  </div>

  <div class="vol-panel">
    <span class="vol-label">입력 레벨</span>
    <div class="vol-track"><div class="vol-fill" id="volFill"></div></div>
  </div>

  <div class="controls-panel">
    <div class="control-row">
      <label class="control-label" for="tuningSelect">튜닝</label>
      <select class="control-select" id="tuningSelect"></select>
    </div>
    <div class="control-row">
      <label class="control-label" for="a4Slider">기준음</label>
      <input class="control-slider" id="a4Slider" type="range" min="415" max="466" step="1" value="440">
      <output class="control-value" id="a4Value" for="a4Slider">440 Hz</output>
      <button class="control-reset" id="a4Reset" type="button">440</button>
    </div>
  </div>

  <div class="keyboard-panel" id="keyboard"></div>

  <div class="feedback-warning" id="feedbackWarning" hidden>
    스피커로 기준음을 재생하면 그 소리가 다시 마이크로 들어갑니다. 헤드폰 사용을 권합니다.
  </div>

  <button class="btn-start" id="startBtn" type="button">▶ 마이크 시작</button>
  <div class="status-msg" id="status">버튼을 눌러 마이크를 활성화하세요</div>

</div>

<script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 4: 인라인 스타일과 스크립트가 남아 있지 않은지 확인**

```bash
grep -n "<style\|<script>\|onclick" index.html
```

기대: 출력 없음.

- [ ] **Step 5: 브라우저에서 레이아웃 확인**

```bash
npm run serve
```

`src/main.js`가 아직 없으므로 콘솔에 404가 뜬다. 정상이다. 확인할 것은 레이아웃뿐이다.

- 기존 패널(음이름, 미터, 볼륨, 시작 버튼)이 개선 전과 같은 모습으로 보인다
- 컨트롤 패널이 볼륨 바 아래에 들어가 있다
- 슬라이더를 움직일 수 있다(아직 아무 일도 일어나지 않는다)
- 창 폭을 375px로 줄여도 레이아웃이 깨지지 않는다

- [ ] **Step 6: 커밋**

```bash
git add index.html styles.css
git commit -m "Split CSS out of index.html and add control markup"
```

---

### Task 9: `ui.js`

**Files:**
- Create: `src/ui.js`

**Interfaces:**
- Consumes: `changedFields` (Task 5), `NOTE_NAMES` (Task 1), `TUNINGS`, `TUNING_IDS` (Task 4)
- Produces:
  - `createUI(handlers: { onToggleMic(): void, onTuningChange(id: string): void, onA4Change(value: number): void, onPlayTone(midi: number): void }) -> { render(state: object): void, showBanner(): void }`

`render`는 이전 상태와 비교해 달라진 필드만 DOM에 반영한다. 크로매틱에서 키를 누르면 4옥타브 음(C4~B4)을 재생한다.

- [ ] **Step 1: `src/ui.js` 작성**

```js
import { changedFields } from './render-state.js';
import { NOTE_NAMES } from './notes.js';
import { TUNINGS, TUNING_IDS } from './tunings.js';

/** 크로매틱 키를 눌렀을 때 재생할 옥타브의 시작. C4 = MIDI 60. */
const CHROMATIC_OCTAVE_BASE = 60;

export function createUI(handlers) {
  // DOM 참조는 여기서 한 번만 조회한다.
  // 기존 구현은 매 프레임 getElementById를 호출했다.
  const el = {
    noteName: document.getElementById('noteName'),
    octave: document.getElementById('octave'),
    freqDisplay: document.getElementById('freqDisplay'),
    needle: document.getElementById('needle'),
    centsDisplay: document.getElementById('centsDisplay'),
    volFill: document.getElementById('volFill'),
    keyboard: document.getElementById('keyboard'),
    startBtn: document.getElementById('startBtn'),
    status: document.getElementById('status'),
    tuningSelect: document.getElementById('tuningSelect'),
    a4Slider: document.getElementById('a4Slider'),
    a4Value: document.getElementById('a4Value'),
    a4Reset: document.getElementById('a4Reset'),
    feedbackWarning: document.getElementById('feedbackWarning'),
    fileBanner: document.getElementById('fileBanner'),
  };

  let previous = null;
  let keyNodes = new Map(); // 표시 라벨 -> 버튼 엘리먼트

  buildTuningOptions();
  buildKeyboard('chromatic');
  wireControls();

  function buildTuningOptions() {
    el.tuningSelect.replaceChildren(
      ...TUNING_IDS.map((id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = TUNINGS[id].label;
        return option;
      })
    );
  }

  function wireControls() {
    el.startBtn.addEventListener('click', () => handlers.onToggleMic());

    el.tuningSelect.addEventListener('change', (e) => handlers.onTuningChange(e.target.value));

    el.a4Slider.addEventListener('input', (e) => handlers.onA4Change(Number(e.target.value)));

    el.a4Reset.addEventListener('click', () => {
      el.a4Slider.value = '440';
      handlers.onA4Change(440);
    });
  }

  /** 크로매틱이면 12키, 아니면 해당 악기의 줄 목록을 만든다. */
  function buildKeyboard(tuningId) {
    const tuning = TUNINGS[tuningId] ?? TUNINGS.chromatic;
    keyNodes = new Map();

    const nodes =
      tuning.strings.length === 0
        ? NOTE_NAMES.map((name, index) => makeKey(name, CHROMATIC_OCTAVE_BASE + index, 'key-btn'))
        : tuning.strings.map((string) => makeKey(string.label, string.midi, 'string-btn'));

    el.keyboard.replaceChildren(...nodes);
  }

  function makeKey(label, midi, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.title = '눌러서 기준음 재생';
    button.addEventListener('click', () => handlers.onPlayTone(midi));
    keyNodes.set(label, button);
    return button;
  }

  /** 상태에서 달라진 필드만 DOM에 반영한다. */
  function render(next) {
    const changed = changedFields(previous, next);
    if (changed.length === 0) return;
    const touched = new Set(changed);

    // 튜닝이 바뀌면 키보드를 다시 만든다. 강조는 아래에서 다시 계산된다.
    if (touched.has('tuningId')) {
      buildKeyboard(next.tuningId);
      touched.add('note');
      touched.add('activeStringLabel');
      touched.add('tuneState');
    }

    if (touched.has('note') || touched.has('tuneState')) {
      el.noteName.textContent = next.note ?? '—';
      el.noteName.className = `note-name ${next.note ? next.tuneState : 'silent'}`;
    }

    if (touched.has('octave')) {
      el.octave.textContent = next.octave ?? '';
    }

    if (touched.has('frequency')) {
      el.freqDisplay.textContent =
        next.frequency === null ? '— Hz' : `${next.frequency.toFixed(1)} Hz`;
    }

    if (touched.has('cents') || touched.has('tuneState')) {
      el.centsDisplay.textContent =
        next.cents === null ? '— ¢' : `${next.cents >= 0 ? '+' : ''}${next.cents} ¢`;

      const percent = next.cents === null ? 50 : 50 + (next.cents / 50) * 50;
      el.needle.style.left = `${Math.max(2, Math.min(98, percent))}%`;
      el.needle.className = `meter-needle ${next.cents === null ? '' : next.tuneState}`.trim();
    }

    if (touched.has('volume')) {
      el.volFill.style.width = `${next.volume}%`;
    }

    if (touched.has('note') || touched.has('activeStringLabel') || touched.has('tuneState')) {
      highlight(next);
    }

    if (touched.has('active')) {
      el.startBtn.textContent = next.active ? '■ 중지' : '▶ 마이크 시작';
      el.startBtn.classList.toggle('active', next.active);
      el.feedbackWarning.hidden = !next.active;
    }

    if (touched.has('message')) {
      el.status.textContent = next.message;
    }

    if (touched.has('a4')) {
      el.a4Value.textContent = `${next.a4} Hz`;
      el.a4Value.classList.toggle('adjusted', next.a4 !== 440);
      if (Number(el.a4Slider.value) !== next.a4) el.a4Slider.value = String(next.a4);
    }

    previous = next;
  }

  function highlight(state) {
    const target = state.tuningId === 'chromatic' ? state.note : state.activeStringLabel;
    const base = state.tuningId === 'chromatic' ? 'key-btn' : 'string-btn';

    for (const [label, node] of keyNodes) {
      if (target === null || label !== target) {
        node.className = base;
        continue;
      }
      node.className = `${base} active${state.tuneState === 'in-tune' ? ' in-tune' : ''}`;
    }
  }

  function showBanner() {
    el.fileBanner.hidden = false;
  }

  return { render, showBanner };
}
```

- [ ] **Step 2: `getElementById`가 렌더 경로에 남아 있지 않은지 확인**

```bash
grep -n "getElementById" src/ui.js
```

기대: `createUI` 최상단의 `el` 객체 정의 안에서만 나온다(15줄). `render`나 `highlight` 안에는 없어야 한다.

- [ ] **Step 3: 커밋**

```bash
git add src/ui.js
git commit -m "Add diff-based UI renderer with cached DOM references"
```

---

### Task 10: `main.js` 배선

**Files:**
- Create: `src/main.js`

**Interfaces:**
- Consumes: 앞선 모든 모듈
- Produces: 없음 (진입점)

- [ ] **Step 1: `src/main.js` 작성**

```js
import { createAudioEngine, getAudioContext } from './audio-engine.js';
import { createTonePlayer } from './tone-player.js';
import { createUI } from './ui.js';
import { EMPTY_STATE, createSilenceGate } from './render-state.js';
import { frequencyToNote, noteToFrequency } from './notes.js';
import { TUNINGS, nearestString } from './tunings.js';

const SILENCE_HOLD_MS = 500;
const IN_TUNE_CENTS = 5;
const IDLE_MESSAGE = '버튼을 눌러 마이크를 활성화하세요';
const LISTENING_MESSAGE = '실시간 음정 감지 중...';

let state = { ...EMPTY_STATE };
let tonePlayer = null;

const gate = createSilenceGate(SILENCE_HOLD_MS);

const ui = createUI({
  onToggleMic: toggleMic,
  onTuningChange: (tuningId) => update({ tuningId }),
  onA4Change: (a4) => update({ a4 }),
  onPlayTone: playTone,
});

const engine = createAudioEngine({
  onResult: handleResult,
  onError: handleError,
});

if (location.protocol === 'file:') ui.showBanner();

ui.render(state);

function update(patch) {
  state = { ...state, ...patch };
  ui.render(state);
}

/** 검출 표시를 비운다. 볼륨은 별도로 계속 갱신된다. */
function clearedDisplay(volume) {
  return {
    note: null,
    octave: null,
    frequency: null,
    cents: null,
    tuneState: null,
    activeStringLabel: null,
    volume,
  };
}

function toggleMic() {
  if (engine.isRunning()) {
    engine.stop();
    gate.reset();
    update({ active: false, ...clearedDisplay(0), message: IDLE_MESSAGE });
    return;
  }

  update({ active: true, message: '마이크를 여는 중...' });
  engine.start().then(() => {
    if (engine.isRunning()) update({ message: LISTENING_MESSAGE });
  });
}

function handleResult({ pitch, rms }) {
  const held = gate.update(pitch, performance.now());
  const volume = Math.min(100, Math.round(rms * 500));

  if (!held) {
    update({ ...clearedDisplay(volume), message: LISTENING_MESSAGE });
    return;
  }

  const note = frequencyToNote(held.frequency, state.a4);
  const tuneState =
    Math.abs(note.cents) <= IN_TUNE_CENTS ? 'in-tune' : note.cents < 0 ? 'flat' : 'sharp';
  const string = nearestString(note.midi, TUNINGS[state.tuningId]);

  update({
    note: note.name,
    octave: note.octave,
    frequency: held.frequency,
    cents: note.cents,
    tuneState,
    activeStringLabel: string ? string.label : null,
    volume,
    message:
      tuneState === 'in-tune'
        ? '✓ 정확한 음정입니다!'
        : tuneState === 'flat'
          ? '♭ 음이 낮습니다'
          : '♯ 음이 높습니다',
  });
}

function handleError({ level, message }) {
  if (level === 'error') {
    engine.stop();
    gate.reset();
    update({ active: false, ...clearedDisplay(0), message });
    return;
  }
  update({ message });
}

function playTone(midi) {
  tonePlayer ??= createTonePlayer(getAudioContext());
  tonePlayer.play(noteToFrequency(midi, state.a4));
}
```

기준음 재생은 `state.a4`를 반영한다. 보정을 415Hz로 두면 재생되는 음도 그 기준을 따른다.

- [ ] **Step 2: 브라우저에서 전체 동작 확인**

```bash
npm run serve
```

표시된 주소를 열고 순서대로 확인한다.

1. 콘솔에 오류가 없다
2. `▶ 마이크 시작`을 누르면 권한을 묻고, 버튼이 `■ 중지`로 바뀐다
3. 헤드폰 안내 문구가 나타난다
4. 소리를 내면 음이름·주파수·센트·니들이 반응한다
5. 소리를 멈추면 약 0.5초 뒤에 표시가 비워진다. **소리가 끊길 때마다 깜빡이지 않는다**
6. 볼륨 바는 무음 구간에서도 계속 움직인다
7. 기준음 슬라이더를 415로 내리면 같은 소리의 센트 값이 바뀌고, 값 표시가 노란색이 된다
8. `440` 버튼을 누르면 슬라이더와 표시가 되돌아온다
9. 튜닝을 `기타`로 바꾸면 12키 대신 6개 줄이 보이고, 소리를 내면 가장 가까운 줄이 강조된다
10. 줄이나 키를 클릭하면 기준음이 재생된다
11. `■ 중지`를 누르면 마이크 표시가 꺼지고 화면이 초기 상태로 돌아간다
12. 다시 시작해도 정상 동작한다(컨텍스트 재사용 확인)

- [ ] **Step 3: 메인 스레드 부하 확인**

DevTools > Performance에서 마이크를 켠 채 5초를 기록한다.

기대: 메인 스레드가 대부분 유휴 상태이고, 33ms 간격으로 짧은 작업만 보인다. 개선 전에는 프레임마다 수 ms에서 수십 ms의 스크립트 블록이 이어졌다.

- [ ] **Step 4: 권한 거부 경로 확인**

브라우저 설정에서 이 사이트의 마이크 권한을 차단한 뒤 새로고침하고 시작을 누른다.

기대: `마이크 권한이 거부되었습니다...` 문구가 뜨고, 버튼이 `▶ 마이크 시작`으로 되돌아온다.

- [ ] **Step 5: 커밋**

```bash
git add src/main.js
git commit -m "Wire modules together in the app entry point"
```

---

### Task 11: `README.md`와 마무리

**Files:**
- Create: `README.md`
- Delete: `scratch-engine.html`, `scratch-tone.html` (있는 경우)

- [ ] **Step 1: 임시 하네스 파일 삭제**

```bash
rm -f scratch-engine.html scratch-tone.html
```

- [ ] **Step 2: `README.md` 작성**

````markdown
# 크로매틱 튜너

브라우저에서 동작하는 크로매틱 튜너. 마이크 입력의 기본 주파수를 검출해
음이름·옥타브·센트 편차를 표시한다.

## 실행

빌드 단계는 없지만, ES 모듈과 Web Worker가 `file://`에서 차단되므로
로컬 서버가 필요하다.

```bash
npm run serve
```

표시된 주소를 브라우저에서 연다. `index.html`을 더블클릭으로 여는 방식은
동작하지 않는다.

## 테스트

```bash
npm test
```

의존성 설치가 필요 없다. Node 내장 테스트 러너를 쓴다.

## 기능

- 실시간 음정 검출 (50–2000 Hz)
- 기준음(A4) 보정 415–466 Hz
- 튜닝 프리셋: 크로매틱 / 기타 / 베이스 / 우쿨렐레 / 바이올린
- 키나 줄을 클릭해 기준음 재생

## 구조

순수 모듈과 브라우저 경계 모듈을 분리한다. 순수 모듈은 브라우저 API를
참조하지 않으므로 Node에서 그대로 테스트된다.

| 파일 | 역할 | 순수 |
|---|---|---|
| `src/fft.js` | radix-2 복소 FFT | O |
| `src/pitch.js` | FFT 기반 NSDF 음정 검출 | O |
| `src/notes.js` | Hz ↔ 음이름/센트 변환 | O |
| `src/tunings.js` | 악기 프리셋 | O |
| `src/render-state.js` | 상태 diff, 무음 홀드 | O |
| `src/pitch-worker.js` | Worker 진입점 | |
| `src/audio-engine.js` | 마이크 입력과 폴링 | |
| `src/tone-player.js` | 기준음 재생 | |
| `src/ui.js` | DOM 렌더 | |
| `src/main.js` | 배선 | |

## 검출 방식

자기상관을 Wiener–Khinchin 정리로 계산한다. 파워 스펙트럼의 역변환이
자기상관이므로 O(n²)가 O(n log n)이 된다. 여기에 MPM의 정규화 함수(NSDF)를
적용해 하모닉이 강한 신호에서 옥타브를 잘못 잡는 것을 줄인다.

검출은 Web Worker에서 수행하고, Worker를 만들 수 없는 환경에서는 같은
함수를 메인 스레드에서 호출하는 폴백으로 동작한다.

설계 문서는 `docs/superpowers/specs/2026-08-24-tuner-improvements-design.md`에 있다.
````

- [ ] **Step 3: 전체 테스트 실행**

```bash
npm test
```

기대: 5개 파일, 44개 테스트 전부 PASS.

- [ ] **Step 4: 남은 정리 확인**

```bash
git status --short
```

기대: 추적되지 않은 임시 파일이 없다.

```bash
grep -rn "requestAnimationFrame\|resetDisplay" src/ index.html
```

기대: 출력 없음.

- [ ] **Step 5: 커밋**

```bash
git add README.md
git commit -m "Add README and remove scratch harnesses"
```

---

## 완료 기준

- `npm test`가 5개 파일 44개 테스트를 모두 통과한다
- `npm run serve` 후 브라우저에서 Task 10 Step 2의 12개 항목이 모두 확인된다
- DevTools Performance에서 마이크 동작 중 메인 스레드가 대체로 유휴 상태다
- `src/`에 `requestAnimationFrame`이 없다
- 순수 모듈 5개가 브라우저 API를 참조하지 않는다
- 기존 시각 스타일이 유지된다
