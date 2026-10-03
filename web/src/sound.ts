/* Tiny synthesized board sounds. Created lazily so the first user click unlocks audio. */

// Full volume drives tones to roughly full scale; the tanh soft-clipper after
// the master gain holds every peak at its ceiling, so loud never turns into
// hard digital clipping.
const DRIVE = 12;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 1;

function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(1024 * 4));
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(3 * x);
  }
  return curve;
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      const softClip = ctx.createWaveShaper();
      softClip.curve = softClipCurve();
      softClip.oversample = "2x";
      master.gain.value = volume * DRIVE;
      master.connect(softClip).connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  if (master) master.gain.value = volume * DRIVE;
}

function tone(freq: number, delay: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const ac = audio();
  if (!ac || !master) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0, ac.currentTime + delay);
  amp.gain.linearRampToValueAtTime(gain, ac.currentTime + delay + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + delay + dur);
  osc.connect(amp).connect(master);
  osc.start(ac.currentTime + delay);
  osc.stop(ac.currentTime + delay + dur + 0.02);
}

function noise(delay: number, dur: number, gain: number) {
  const ac = audio();
  if (!ac || !master) return;
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
  src.connect(filter).connect(amp).connect(master);
  src.start(ac.currentTime + delay);
}

// A piece landing on wood: a sine that drops in pitch and dies out fast.
// One knock — the drive saturation only shapes the attack, the falling pitch
// keeps it a thump instead of a fixed-frequency buzz.
function thump() {
  const ac = audio();
  if (!ac || !master) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(190, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.1);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.4, t + 0.003);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  osc.connect(amp).connect(master);
  osc.start(t);
  osc.stop(t + 0.15);
}

export const sfx = {
  move() {
    thump();
  },
  capture() {
    tone(190, 0, 0.09, 0.08, "triangle");
    noise(0, 0.06, 0.09);
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
