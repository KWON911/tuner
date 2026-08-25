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
