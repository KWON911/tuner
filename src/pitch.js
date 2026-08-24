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
