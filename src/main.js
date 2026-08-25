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
// warn 레벨 onError 메시지가 화면에 떠 있는 동안, handleResult의 매 33ms 틱이
// 곧바로 그 메시지를 일상 상태 문구로 덮어써버리지 않도록 잠그는 플래그.
// error 레벨 처리, 재생 시작/정지, 또는 새 onError 호출로만 풀린다.
let messageLocked = false;

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
    messageLocked = false;
    update({ active: false, ...clearedDisplay(0), message: IDLE_MESSAGE });
    return;
  }

  messageLocked = false;
  update({ active: true, message: '마이크를 여는 중...' });
  engine
    .start()
    .then(() => {
      if (engine.isRunning() && !messageLocked) update({ message: LISTENING_MESSAGE });
    })
    .catch((err) => {
      // getUserMedia 자체의 실패는 audio-engine.js 내부에서 onError로 이미 처리된다.
      // 여기서 잡는 것은 그 이후 단계(AudioContext resume, createAnalyser 등)에서
      // 발생해 start()의 반환 프로미스가 그대로 reject되는 경우다. 처리하지 않으면
      // active:true로 낙관적으로 켜둔 상태가 영영 풀리지 않고 UI가 멈춘다.
      handleError({
        level: 'error',
        message: `마이크를 열 수 없습니다: ${err.name} — ${err.message}`,
      });
    });
}

function handleResult({ pitch, rms }) {
  const held = gate.update(pitch, performance.now());
  const volume = Math.min(100, Math.round(rms * 500));

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
    messageLocked = false;
    update({ active: false, ...clearedDisplay(0), message });
    return;
  }
  // warn 레벨: 다음 handleResult 틱(최대 33ms 후)이 이 메시지를 즉시 덮어쓰지
  // 않도록 잠근다. 사용자가 실제로 읽을 시간을 준 뒤, error 처리나 마이크
  // 재시작/정지, 또는 다음 onError 호출로만 해제된다.
  messageLocked = true;
  update({ message });
}

function playTone(midi) {
  tonePlayer ??= createTonePlayer(getAudioContext());
  tonePlayer.play(noteToFrequency(midi, state.a4));
}
