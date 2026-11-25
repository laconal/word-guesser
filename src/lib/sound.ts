// Tiny Web Audio beeper — no assets needed, works in the Android WebView.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, ms: number, delay = 0, volume = 0.2, type: OscillatorType = "sine") {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay / 1000;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

export const sound = {
  /** Call from a user gesture so the audio context is allowed to start. */
  unlock: () => void audio(),
  guessed: () => {
    tone(660, 90);
    tone(990, 120, 80);
  },
  skipped: () => tone(220, 160, 0, 0.18, "triangle"),
  timeout: () => tone(180, 300, 0, 0.25, "square"),
  tick: () => tone(1200, 40, 0, 0.08),
  roundEnd: () => {
    tone(523, 180);
    tone(392, 180, 200);
    tone(262, 420, 400);
  },
};
