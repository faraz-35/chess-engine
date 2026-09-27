/* Tiny synthesized board sounds. Created lazily so the first user click unlocks audio. */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, delay: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0, ac.currentTime + delay);
  amp.gain.linearRampToValueAtTime(gain, ac.currentTime + delay + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + delay + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(ac.currentTime + delay);
  osc.stop(ac.currentTime + delay + dur + 0.02);
}

function noise(delay: number, dur: number, gain: number) {
  const ac = audio();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  const amp = ac.createGain();
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  amp.gain.value = gain;
  src.buffer = buffer;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(ac.currentTime + delay);
}

export const sfx = {
  move() {
    tone(340, 0, 0.06, 0.05, "triangle");
    tone(170, 0, 0.08, 0.06);
  },
  capture() {
    tone(190, 0, 0.09, 0.08, "triangle");
    noise(0, 0.06, 0.09);
  },
  check() {
    tone(720, 0, 0.09, 0.05);
    tone(950, 0.1, 0.12, 0.05);
  },
  win() {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.13, 0.22, 0.06));
  },
  lose() {
    [392, 311, 262].forEach((f, i) => tone(f, i * 0.15, 0.25, 0.05));
  },
  draw() {
    tone(440, 0, 0.18, 0.05);
    tone(440, 0.2, 0.25, 0.04);
  },
};
