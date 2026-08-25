# 크로매틱 튜너

브라우저에서 동작하는 크로매틱 튜너. 마이크 입력의 기본 주파수를 검출해
음이름·옥타브·센트 편차를 표시한다.

화면 사용법은 [USAGE.md](USAGE.md)를 참고한다.

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
