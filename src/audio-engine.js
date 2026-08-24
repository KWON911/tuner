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
