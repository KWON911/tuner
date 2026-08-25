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
  let starting = false;

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
    // getUserMedia의 권한 프롬프트가 떠 있는 동안에는 running이 여전히 false이므로,
    // 그 사이에 start()가 다시 호출되면(예: 사용자의 연속 클릭) 위의 running 체크만으로는
    // 걸러지지 않는다. starting 플래그로 "설정이 진행 중"인 구간 전체를 보호해서
    // 두 번째 호출이 마이크 스트림/AudioContext/Worker/타이머를 중복 생성하지 않게 한다.
    if (running || starting) return;
    starting = true;
    try {
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
        // worker.onmessage/onerror는 클로저로 캡처한 thisWorker와 현재의
        // worker(모듈 상태)가 같은 인스턴스일 때만 처리한다. stop() 직후 start()가
        // 다시 호출되면 새 worker가 생기는데, 방금 terminate()된 이전 worker가
        // terminate 직전에 이미 postMessage해둔 결과가 뒤늦게 도착할 수 있다.
        // running만 검사하면 그 시점엔 새 세션이 running=true라 통과해버려서
        // 오래된 결과가 현재 세션의 onResult로 새어 들어간다. 인스턴스 동일성을
        // 함께 검사하면 그 메시지는 thisWorker !== worker(새 worker)이므로 걸러진다.
        const thisWorker = worker;
        worker.onmessage = (event) => {
          if (worker !== thisWorker) return;
          pending = false;
          if (running) onResult?.(event.data);
        };
        worker.onerror = () => {
          if (worker !== thisWorker) return;
          onError?.({
            level: 'warn',
            code: 'WORKER_ERROR',
            message: '백그라운드 검출이 중단되어 메인 스레드로 전환합니다.',
          });
          thisWorker.terminate();
          worker = null;
          pending = false;
        };
      }

      running = true;
      timer = setInterval(tick, intervalMs);
    } finally {
      starting = false;
    }
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
