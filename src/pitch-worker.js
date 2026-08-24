import { detectPitch } from './pitch.js';

self.onmessage = (event) => {
  const { samples, sampleRate, options, rms } = event.data;
  const pitch = detectPitch(samples, sampleRate, options);
  self.postMessage({ pitch, rms });
};
