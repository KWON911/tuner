# 크로매틱 튜너 개선 설계

날짜: 2026-08-24
대상: `index.html` 단일 파일 튜너 → 모듈 구조 + 성능/기능 개선

## 배경

현재 튜너는 단일 `index.html`(약 14.5 KB)로 동작한다. 마이크 입력을 `AnalyserNode`(fftSize 8192)로 받아 시간 영역 자기상관으로 음정을 검출하고, 음이름·옥타브·센트 편차를 표시한다.

세 가지 문제가 있다.

1. **성능** — 자기상관이 이중 루프 O(n²)로 구현되어 있고, 8192 샘플 버퍼에 대해 `requestAnimationFrame`마다 실행된다. 프레임당 약 3,300만 회의 곱셈이 발생한다.
2. **A4 고정** — 기준음 440 Hz가 상수로 하드코딩되어 있어 보정할 수 없다.
3. **불필요한 DOM 갱신** — `resetDisplay()`가 무음 프레임마다 호출되고, 매 프레임 `document.getElementById`로 요소를 다시 조회한다.

## 목표

- 검출 연산량을 O(n log n)으로 낮추고 메인 스레드에서 분리한다.
- 기준음(A4)을 사용자가 조절할 수 있게 한다.
- DOM 갱신을 상태 변경분으로 한정한다.
- 악기 튜닝 프리셋과 기준음 재생 기능을 추가한다.
- 음정 계산과 검출 로직에 자동화된 테스트를 붙인다.

## 비목표

- 빌드 도구(번들러) 도입. `npm`/Vite 없이 브라우저가 직접 읽는 ES 모듈로 유지한다.
  단, `package.json`은 추가한다. `node --test`가 `.js` 파일을 ES 모듈로 읽으려면 `"type": "module"`이 필요하기 때문이다. `dependencies`는 비어 있고 설치 단계도 없으므로 빌드 도구 도입에 해당하지 않는다. 브라우저는 `package.json`을 보지 않는다.
- 설정의 영속 저장(localStorage). 이번 범위에서 제외한다.
- 마이크 이외의 입력 소스(파일, 라인 입력).

## 제약

다중 파일 ES 모듈과 Web Worker는 `file://` 스킴에서 CORS로 차단된다. 따라서 `index.html`을 더블클릭으로 여는 방식은 더 이상 동작하지 않으며, 로컬 확인 시 HTTP 서버가 필요하다(`npx serve` 등). GitHub Pages 배포에는 영향이 없다. 이 제약은 사용자에게 고지되었고 수용되었다.

## 파일 구조

```
package.json           node의 ESM 해석 + 테스트 스크립트 (의존성 없음)
index.html
styles.css
src/
  fft.js              radix-2 복소 FFT (순수)
  pitch.js            FFT 기반 NSDF 음정 검출 (순수)
  notes.js            Hz <-> 음이름/옥타브/센트, A4 보정 (순수)
  tunings.js          악기 프리셋 + 가장 가까운 줄 찾기 (순수)
  pitch-worker.js     Worker 진입점
  audio-engine.js     getUserMedia / AudioContext / 폴링 루프
  tone-player.js      기준음 오실레이터 재생
  ui.js               DOM 캐시 + 상태 비교 렌더
  main.js             부트스트랩, 배선
test/
  fft.test.js
  pitch.test.js
  notes.test.js
  tunings.test.js
README.md
```

`fft.js` / `pitch.js` / `notes.js` / `tunings.js`는 브라우저 API에 의존하지 않는다. 이 네 모듈이 테스트 대상이며, Node에서 그대로 import된다. 나머지 네 모듈이 브라우저 경계(마이크, DOM, 오디오 출력)를 담당한다.

## 모듈 인터페이스

### `fft.js`

```js
fft(re, im)        // Float64Array 두 개를 in-place 변환. 길이는 2의 거듭제곱이어야 한다.
ifft(re, im)       // 역변환
nextPow2(n)        // n 이상인 최소 2의 거듭제곱
```

길이가 2의 거듭제곱이 아니면 `RangeError`를 던진다. 누적 오차를 줄이기 위해 내부 버퍼는 `Float64Array`를 쓴다. 입력이 `Float32Array`인 경우 호출부에서 변환한다.

### `pitch.js`

```js
detectPitch(buffer, sampleRate, opts) -> { frequency, clarity } | null
```

`opts`: `{ minFrequency = 50, maxFrequency = 2000, clarityThreshold = 0.8, rmsThreshold = 0.005 }`

동작 순서:

1. RMS를 계산한다. `rmsThreshold` 미만이면 `null`을 반환한다.
2. 버퍼를 `nextPow2(2 * n)` 길이로 zero-pad하고 FFT를 취한다.
3. 파워 스펙트럼 `|X(k)|²`의 역변환으로 자기상관 `r(tau)`를 얻는다 (Wiener–Khinchin).
4. 누적합으로 `m(tau)`를 O(n)에 계산하고, NSDF `n(tau) = 2*r(tau) / m(tau)`를 구한다.
5. 첫 음(negative) 구간을 지난 뒤의 극대점들을 모으고, 최대값의 `0.9`배를 넘는 첫 극대점을 고른다.
6. 그 지점에 포물선 보간을 적용해 소수점 lag를 얻는다.
7. `frequency = sampleRate / lag`. `[minFrequency, maxFrequency]` 밖이면 `null`.
8. `clarity`(선택된 극대점의 NSDF 값)가 `clarityThreshold` 미만이면 `null`.

NSDF를 쓰는 이유는 정규화 덕분에 하모닉이 강한 신호(톱니파, 기타 저음현)에서 옥타브 아래로 잘못 잡는 현상이 줄기 때문이다.

### `notes.js`

```js
NOTE_NAMES                                  // ['C','C#',...,'B']
frequencyToNote(freq, a4 = 440)
  -> { midi, name, octave, cents, exactFrequency }
noteToFrequency(midi, a4 = 440) -> Hz
```

`midi`는 반올림된 정수 MIDI 노트 번호, `cents`는 -50 이상 50 이하의 정수, `exactFrequency`는 해당 MIDI 노트의 정확한 주파수다.

경계 처리: `diff = exact - midi`는 `[-0.5, 0.5)` 범위이지만 `cents = Math.round(diff * 100)`에 두 번째 반올림이 걸리므로 -50과 +50이 모두 나올 수 있다. 두 반음의 정확한 중간(`diff === -0.5`)에서는 `Math.round`가 위쪽 노트로 올림하므로 `midi`가 위쪽 노트, `cents`가 -50이 된다. `a4`는 415 이상 466 이하를 기대하지만 강제하지 않는다.

### `tunings.js`

```js
TUNINGS  // { chromatic, guitar, bass, ukulele, violin }
```

각 항목은 `{ id, label, strings: [{ label, midi }] }` 형태다. `chromatic`의 `strings`는 빈 배열이며, UI는 이 경우 12키 스트립을 표시한다.

```js
nearestString(midi, tuning) -> { label, midi } | null
```

`tuning.strings`가 비어 있으면 `null`. 동점이면 낮은 `midi` 쪽을 반환한다.

프리셋 값:

| 프리셋 | 줄 (낮은 음 → 높은 음) |
|---|---|
| guitar | E2 A2 D3 G3 B3 E4 |
| bass | E1 A1 D2 G2 |
| ukulele | G4 C4 E4 A4 |
| violin | G3 D4 A4 E5 |

### `pitch-worker.js`

`{ samples: Float32Array, sampleRate: number, opts }`를 받아 `detectPitch` 결과를 그대로 postMessage한다. `samples`는 transferable로 주고받는다.

### `audio-engine.js`

```js
createAudioEngine({ onResult, onError, intervalMs = 33 })
  -> { start(), stop(), get context(), get running() }
```

`start()`는 `getUserMedia` → `AudioContext` → `AnalyserNode`(fftSize 8192, smoothingTimeConstant 0) 체인을 만들고 `setInterval`로 폴링을 시작한다. 각 틱마다 `getFloatTimeDomainData`로 버퍼를 뽑아 Worker에 전달한다. `onResult`는 매 틱 호출되며 인자는 `{ pitch, rms }` 형태다. `pitch`는 `detectPitch`의 반환값 그대로이므로 검출 실패 시 `null`이고, `rms`는 항상 채워진다. 볼륨 바가 무음 구간에서도 계속 움직여야 하기 때문에 두 값을 분리한다.

`AnalyserNode`의 `smoothingTimeConstant`는 0으로 둔다. 이 값은 주파수 영역 데이터에만 적용되지만, 시간 영역만 쓰는 이 코드에서 0.6이라는 값은 오해를 부른다.

`requestAnimationFrame` 대신 `setInterval`을 쓴다. rAF는 디스플레이 주사율에 종속되어 120Hz 화면에서 불필요하게 두 배로 실행된다. 튜너 갱신에는 30Hz면 충분하다.

Worker 생성이 실패하면 같은 `detectPitch`를 메인 스레드에서 호출하는 폴백으로 전환하고, `onError`에 경고 수준으로 알린다.

### `tone-player.js`

```js
createTonePlayer(audioContext) -> { play(frequency, durationMs = 2000), stop() }
```

`OscillatorNode`(sine) + `GainNode`. 게인에 10ms attack, 50ms release 램프를 적용해 클릭음을 없앤다. 재생 중 `play`가 다시 호출되면 이전 음을 정지하고 새로 시작한다.

### `ui.js`

```js
createUI(root) -> { render(state), onControlChange(handler) }
```

생성 시 필요한 DOM 요소를 한 번 조회해 보관한다. `render(next)`는 보관 중인 이전 상태와 필드 단위로 비교해 달라진 항목만 DOM에 반영한다.

상태 형태:

```js
{
  active,        // 마이크 실행 여부
  note,          // 'A' | null
  octave,        // 4 | null
  frequency,     // 440.2 | null
  cents,         // -3 | null
  tuneState,     // 'in-tune' | 'flat' | 'sharp' | null
  volume,        // 0..100
  a4,            // 440
  tuningId,      // 'chromatic' | 'guitar' | ...
  activeString,  // { label, midi } | null
  message        // 상태 줄 문구
}
```

## 데이터 흐름

```
마이크 -> MediaStreamSource -> AnalyserNode
                                   |  33ms 폴링
                                   v
                         getFloatTimeDomainData
                                   |  transfer
                                   v
                    pitch-worker (FFT -> NSDF -> 피크 -> 보간)
                                   |  { frequency, clarity }
                                   v
                    frequencyToNote(freq, a4) -> nearestString
                                   v
                            ui.render(state)
```

## 무음 처리

검출 결과가 `null`인 프레임이 들어와도 즉시 초기화하지 않는다. 마지막 유효 결과의 시각을 기록해두고, **500ms** 동안 결과가 없을 때만 표시를 비운다. 연주 중 음이 잠깐 끊길 때마다 화면이 깜빡이는 것을 막기 위해서다.

볼륨 바는 홀드 대상이 아니며 매 틱 갱신한다.

## UI 변경

기존 레이아웃(음이름 패널, 니들 미터, 주파수/센트 수치, 볼륨 바, 12키 스트립)과 시각 스타일은 유지한다. 컨트롤 행을 추가한다.

**A4 보정** — `range` 입력, 415~466 Hz, 1 Hz 단위, 기본 440. 옆에 현재 값을 숫자로 표시한다. 값이 바뀌면 다음 렌더부터 센트·니들에 반영된다. 440이 아닌 값일 때는 표시를 강조해 보정 중임을 알린다.

**튜닝 프리셋** — `select`. 크로매틱을 고르면 기존 12키 스트립이 보인다. 악기를 고르면 같은 자리에 해당 악기의 줄 목록이 표시되고, 검출된 음에 가장 가까운 줄이 강조된다.

**기준음 재생** — 각 줄(크로매틱에서는 각 키) 옆의 재생 버튼. 누르면 해당 음을 2초 재생한다. 마이크가 켜져 있는 동안에는 "헤드폰 권장" 안내를 표시한다. 스피커로 재생하면 그 소리가 다시 마이크로 들어가기 때문이다.

## 에러 처리

| 상황 | 처리 |
|---|---|
| `NotAllowedError` | "마이크 권한이 거부되었습니다. 브라우저 주소창의 권한 설정을 확인해주세요." |
| `NotFoundError` | "마이크 장치를 찾을 수 없습니다." |
| 그 외 `getUserMedia` 실패 | 오류 이름과 메시지를 그대로 표시 |
| Worker 생성 실패 | 메인 스레드 폴백으로 전환, 상태 줄에 성능 저하 안내 |
| `location.protocol === 'file:'` | 상단에 로컬 서버 안내 배너 표시 |

## 테스트 전략

`node --test`로 실행한다. 외부 의존성은 없다.

**`fft.test.js`**
- 임펄스 입력의 스펙트럼이 모든 빈에서 크기 1인지
- 단일 사인의 에너지가 해당 빈에 집중되는지
- FFT → IFFT 왕복이 원본과 일치하는지 (허용 오차 1e-5)
- 길이가 2의 거듭제곱이 아니면 `RangeError`

**`pitch.test.js`**
- 순수 사인 E2(82.41), A4(440), A5(880) 검출. 허용 오차 ±1 cent
- 하모닉이 있는 파형은 허용 오차 ±5 cent. NSDF 피크에 포물선 보간을 적용해도 하모닉이 피크 모양을 비대칭으로 만들기 때문에 순수 사인만큼의 정밀도는 나오지 않는다
- 톱니파·구형파에서 기본 주파수를 잡는지 (옥타브 아래위로 벗어나지 않는지)
- 백색잡음 입력 시 `null`
- 무음(모두 0) 입력 시 `null`
- `minFrequency`/`maxFrequency` 밖의 신호는 `null`

**`notes.test.js`**
- A4 = 440에서 440 Hz → A4, 0 cent
- A4 = 432, 415에서의 왕복 일치
- `noteToFrequency(frequencyToNote(f).midi)`가 `exactFrequency`와 일치
- 센트 경계: 두 반음의 정확한 중간 주파수에서 위쪽 노트 + `cents === -50`
- 센트 상한: `diff`가 0.5에 근접한 주파수에서 `cents === 50`

**`tunings.test.js`**
- 각 프리셋 줄의 MIDI 번호가 표의 값과 일치
- `nearestString`이 경계에서 올바른 줄을 고르는지
- 크로매틱에서 `null` 반환

## 기존 문제 대응 정리

| 문제 | 해결 |
|---|---|
| O(n²) 자기상관 | Wiener–Khinchin으로 O(n log n), Web Worker로 이전 |
| A4 하드코딩 | `notes.js`가 `a4`를 인자로 받고 UI 슬라이더와 연결 |
| `resetDisplay()` 과다 호출 | 상태 필드 단위 비교 렌더 + 무음 500ms 홀드 + DOM 참조 캐시 |
