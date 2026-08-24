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
