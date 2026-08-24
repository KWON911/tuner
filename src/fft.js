/** n 이상인 최소의 2의 거듭제곱. */
export function nextPow2(n) {
  if (!Number.isFinite(n) || n < 1) {
    throw new RangeError(`nextPow2: n은 1 이상이어야 합니다 (받은 값: ${n})`);
  }
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function isPow2(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * 반복형 radix-2 Cooley-Tukey FFT. re와 im을 제자리에서 변환한다.
 * 누적 오차를 줄이기 위해 Float64Array를 기대한다.
 */
export function fft(re, im) {
  transform(re, im, false);
}

/** 역변환. 1/n 정규화까지 수행한다. */
export function ifft(re, im) {
  transform(re, im, true);
}

function transform(re, im, inverse) {
  const n = re.length;
  if (im.length !== n) {
    throw new RangeError(`fft: re(${n})와 im(${im.length})의 길이가 같아야 합니다`);
  }
  if (!isPow2(n)) {
    throw new RangeError(`fft: 길이는 2의 거듭제곱이어야 합니다 (받은 값: ${n})`);
  }
  if (n === 1) return;

  // 비트 반전 순열
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const stepR = Math.cos(angle);
    const stepI = Math.sin(angle);
    const half = len >> 1;

    for (let start = 0; start < n; start += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < half; k++) {
        const aR = re[start + k];
        const aI = im[start + k];
        const bR = re[start + k + half];
        const bI = im[start + k + half];

        const tR = bR * wR - bI * wI;
        const tI = bR * wI + bI * wR;

        re[start + k] = aR + tR;
        im[start + k] = aI + tI;
        re[start + k + half] = aR - tR;
        im[start + k + half] = aI - tI;

        const nextR = wR * stepR - wI * stepI;
        wI = wR * stepI + wI * stepR;
        wR = nextR;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}
