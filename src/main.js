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
// warn 메시지를 화면에 붙잡아두는 시간. 사용자가 실제로 읽을 시간을 주려는
// 것이지 영구 고정이 아니므로, 이 시간이 지나면 자동으로 풀려야 한다.
const WARN_MESSAGE_HOLD_MS = 3000;
// 기준음 재생 시간(tone-player.js의 기본 durationMs와 맞춘다). 재생 중에는
// 스피커 소리가 마이크로 들어와 오검출될 수 있어 그 사이 검출 결과를 무시한다.
const TONE_PLAYBACK_MS = 2000;

let state = { ...EMPTY_STATE };
let tonePlayer = null;
// warn 레벨 onError 메시지가 화면에 떠 있는 동안, handleResult의 매 33ms 틱이
// 곧바로 그 메시지를 일상 상태 문구로 덮어써버리지 않도록 잠그는 플래그.
// WARN_MESSAGE_HOLD_MS가 지나면 자동으로 풀리고, error 레벨 처리나 마이크
// 재시작/정지로도 즉시 풀린다.
let messageLocked = false;
let messageLockTimer = null;
// 기준음을 재생 중인 동안 마이크 검출 결과를 무시할 마감 시각(performance.now() 기준).
let suppressDetectionUntil = 0;

function unlockMessage() {
  messageLocked = false;
  clearTimeout(messageLockTimer);
  messageLockTimer = null;
}

const gate = createSilenceGate(SILENCE_HOLD_MS);

// iOS Safari는 페이지에 터치 이벤트 리스너가 하나도 없으면 :active 의사
// 클래스를 아예 발동시키지 않는다. 빈 리스너 하나로 버튼 눌림 효과를 켠다.
document.addEventListener('touchstart', () => {}, { passive: true });

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

// file:// 배너는 index.html의 일반 스크립트가 직접 띄운다(main.js는 모듈
// 스크립트라 Chrome/Firefox의 file:// 출처에서는 애초에 실행되지 않는다).

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
    unlockMessage();
    update({ active: false, ...clearedDisplay(0), message: IDLE_MESSAGE });
    return;
  }

  unlockMessage();
  update({ active: true, message: '마이크를 여는 중...' });
  // getUserMedia 권한 프롬프트가 떠 있는 동안 engine.isRunning()은 계속
  // false다. 그 사이 시작 버튼을 다시 눌러도 toggleMic이 이 START 분기로
  // 다시 들어와 조용히 아무 일도 안 하고 끝나버리므로(버튼은 "중지"로 보이는
  // 채 그대로 멈춤), 요청이 끝날 때까지 버튼 자체를 비활성화해 둔다.
  ui.setBusy(true);
  engine
    .start()
    .then(() => {
      ui.setBusy(false);
      if (engine.isRunning() && !messageLocked) update({ message: LISTENING_MESSAGE });
    })
    .catch((err) => {
      // getUserMedia 자체의 실패는 audio-engine.js 내부에서 onError로 이미 처리된다.
      // 여기서 잡는 것은 그 이후 단계(AudioContext resume, createAnalyser 등)에서
      // 발생해 start()의 반환 프로미스가 그대로 reject되는 경우다. 처리하지 않으면
      // active:true로 낙관적으로 켜둔 상태가 영영 풀리지 않고 UI가 멈춘다.
      ui.setBusy(false);
      handleError({
        level: 'error',
        message: `마이크를 열 수 없습니다: ${err.name} — ${err.message}`,
      });
    });
}

function handleResult({ pitch, rms }) {
  const volume = Math.min(100, Math.round(rms * 500));

  // 기준음이 재생되는 동안에는 스피커 소리가 마이크로 들어와 오검출될 수
  // 있으므로 그 사이 검출 결과는 그대로 버린다. 표시는 정지 상태와 동일하게
  // 비우되, 이유를 알 수 있는 문구를 보여준다.
  if (performance.now() < suppressDetectionUntil) {
    update({ ...clearedDisplay(volume), message: '기준음 재생 중 (마이크 대기)' });
    return;
  }

  const held = gate.update(pitch, performance.now());

  if (!held) {
    update({ ...clearedDisplay(volume), ...(messageLocked ? {} : { message: LISTENING_MESSAGE }) });
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
    ...(messageLocked
      ? {}
      : {
          message:
            tuneState === 'in-tune'
              ? '✓ 정확한 음정입니다!'
              : tuneState === 'flat'
                ? '♭ 음이 낮습니다'
                : '♯ 음이 높습니다',
        }),
  });
}

function handleError({ level, message }) {
  if (level === 'error') {
    engine.stop();
    gate.reset();
    unlockMessage();
    update({ active: false, ...clearedDisplay(0), message });
    return;
  }
  // warn 레벨: 다음 handleResult 틱(최대 33ms 후)이 이 메시지를 즉시 덮어쓰지
  // 않도록 잠근다. WARN_MESSAGE_HOLD_MS 동안 사용자가 실제로 읽을 시간을 준
  // 뒤 자동으로 풀린다. 그 전에 error 처리나 마이크 재시작/정지, 또는 다음
  // onError 호출이 오면 그쪽이 먼저 해제한다.
  messageLocked = true;
  clearTimeout(messageLockTimer);
  messageLockTimer = setTimeout(unlockMessage, WARN_MESSAGE_HOLD_MS);
  update({ message });
}

async function playTone(midi) {
  const context = getAudioContext();
  if (context.state === 'suspended') await context.resume();
  tonePlayer ??= createTonePlayer(context);
  tonePlayer.play(noteToFrequency(midi, state.a4));

  if (engine.isRunning()) {
    suppressDetectionUntil = performance.now() + TONE_PLAYBACK_MS;
    gate.reset();
    update({ ...clearedDisplay(state.volume), message: '기준음 재생 중 (마이크 대기)' });
  }
}
