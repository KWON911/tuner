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
    const totalSec = durationMs / 1000;
    const end = now + totalSec;

    // Clamp attack and release to fit within available duration
    const attack = Math.min(ATTACK_SEC, totalSec / 2);
    const release = Math.min(RELEASE_SEC, totalSec / 2);

    oscillator = context.createOscillator();
    gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + attack);
    gain.gain.setValueAtTime(PEAK_GAIN, end - release);
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
