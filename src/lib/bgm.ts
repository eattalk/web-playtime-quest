// ── Procedural BGM Engine (Web Audio API) ──────────────
// Synthesizes looping background music for Space Shooter
// Three modes: 'intro' (ambient, calm), 'play' (driving beat), 'gameover' (tense fade)

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let stopFns: Array<() => void> = [];
let currentMode: string | null = null;
let pendingMode: string | null = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.38, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return { ctx: audioCtx, master: masterGain! };
}

// ── Unlock audio on first user gesture (required for mobile browsers) ─────
export function unlockAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.38, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      // If a mode was queued before unlock, start it now
      if (pendingMode === 'intro') { pendingMode = null; startIntroBGM(); }
      else if (pendingMode === 'play') { pendingMode = null; startGameBGM(); }
    });
  }
}

function stopAll() {
  stopFns.forEach(fn => { try { fn(); } catch(_) {} });
  stopFns = [];
  currentMode = null;
}

// ── Helpers ───────────────────────────────────────────
function osc(ctx: AudioContext, type: OscillatorType, freq: number, dest: AudioNode, vol: number, startAt: number, stopAt?: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, startAt);
  g.gain.setValueAtTime(vol, startAt);
  o.connect(g); g.connect(dest);
  o.start(startAt);
  if (stopAt !== undefined) o.stop(stopAt);
  return { osc: o, gain: g };
}

function reverb(ctx: AudioContext, dest: AudioNode, decay = 2.5): AudioNode {
  const len = Math.floor(ctx.sampleRate * decay);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  const wet = ctx.createGain();
  wet.gain.setValueAtTime(0.28, ctx.currentTime);
  conv.connect(wet); wet.connect(dest);
  return conv;
}

// ── Note frequencies ─────────────────────────────────
const NOTE = {
  C2: 65.4, D2: 73.4, E2: 82.4, G2: 98.0, A2: 110.0, B2: 123.5,
  C3: 130.8, D3: 146.8, E3: 164.8, F3: 174.6, G3: 196.0, A3: 220.0, B3: 246.9,
  C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392.0, A4: 440.0, B4: 493.9,
  C5: 523.3, D5: 587.3, E5: 659.3,
};

// ── INTRO BGM — Ambient space pad with slow melody ───
export function startIntroBGM() {
  if (currentMode === 'intro') return;
  stopAll();
  currentMode = 'intro';
  const { ctx, master } = getCtx();
  const rev = reverb(ctx, master, 3.5);

  // Slow drone pad: C minor chord layers
  const dronePad = [NOTE.C2, NOTE.G2, NOTE.C3, NOTE.E2 * 0.97] as const;
  const droneOscs = dronePad.map((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = i % 2 === 0 ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    // slow wobble
    o.frequency.setValueAtTime(freq * 1.002, ctx.currentTime + 3);
    o.frequency.setValueAtTime(freq, ctx.currentTime + 6);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.06 + i * 0.01, ctx.currentTime + 2);
    o.connect(g);
    g.connect(rev);
    g.connect(master);
    o.start(ctx.currentTime);
    return { o, g };
  });

  // Slow arpeggio melody
  const melody = [NOTE.C4, NOTE.E4 * 0.97, NOTE.G4, NOTE.A4, NOTE.G4, NOTE.E4 * 0.97, NOTE.C4, NOTE.D4];
  const BPM = 72;
  const STEP = 60 / BPM * 0.5; // 8th note
  let scheduledUntil = ctx.currentTime;
  let melodyIdx = 0;
  let running = true;

  const scheduleMelody = () => {
    if (!running) return;
    const lookAhead = 0.25;
    while (scheduledUntil < ctx.currentTime + lookAhead) {
      const freq = melody[melodyIdx % melody.length];
      const at = scheduledUntil;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, at);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.07, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, at + STEP * 0.85);
      o.connect(g);
      g.connect(rev);
      o.start(at);
      o.stop(at + STEP * 0.9);
      scheduledUntil += STEP;
      melodyIdx++;
    }
    const tid = setTimeout(scheduleMelody, 100);
    stopFns.push(() => { clearTimeout(tid); });
  };
  scheduleMelody();

  // Slow hi-hat shimmer
  let shimmerRunning = true;
  const shimmer = () => {
    if (!shimmerRunning) return;
    const at = ctx.currentTime;
    const bufSize = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.018, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(at);
    const tid = setTimeout(shimmer, 750 + Math.random() * 500);
    stopFns.push(() => clearTimeout(tid));
  };
  shimmer();

  stopFns.push(() => {
    running = false;
    shimmerRunning = false;
    droneOscs.forEach(({ o, g }) => {
      try { g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8); o.stop(ctx.currentTime + 0.8); } catch (_) {}
    });
  });
}

// ── GAMEPLAY BGM — Driving electronic beat ────────────
export function startGameBGM() {
  if (currentMode === 'play') return;
  stopAll();
  currentMode = 'play';
  const { ctx, master } = getCtx();
  const rev = reverb(ctx, master, 1.2);

  const BPM = 138;
  const BAR = 60 / BPM * 4;  // 4 beats
  const BEAT = 60 / BPM;
  const STEP = BEAT / 2;     // 8th note

  // Bass sequence (repeating 8-bar pattern)
  const bassSeq = [
    NOTE.C2, 0, NOTE.C2, NOTE.G2, NOTE.C2, 0, NOTE.A2, 0,
    NOTE.C2, 0, NOTE.C2, NOTE.G2, NOTE.D2, 0, NOTE.D2, NOTE.A2,
  ];

  // Lead melody sequence
  const leadSeq = [
    NOTE.C4, 0, NOTE.E4 * 0.97, 0, NOTE.G4, 0, NOTE.G4, NOTE.A4,
    0, NOTE.G4, 0, NOTE.E4 * 0.97, NOTE.C4, 0, NOTE.D4, 0,
  ];

  let running = true;
  let scheduledUntil = ctx.currentTime + 0.05;
  let beatIdx = 0;

  const scheduleLoop = () => {
    if (!running) return;
    while (scheduledUntil < ctx.currentTime + 0.5) {
      const idx = beatIdx % bassSeq.length;
      const at = scheduledUntil;

      // ── KICK DRUM ──
      if (beatIdx % 4 === 0 || beatIdx % 4 === 2) {
        const kickOsc = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(150, at);
        kickOsc.frequency.exponentialRampToValueAtTime(40, at + 0.08);
        kickGain.gain.setValueAtTime(0.6, at);
        kickGain.gain.exponentialRampToValueAtTime(0.001, at + 0.15);
        kickOsc.connect(kickGain); kickGain.connect(master);
        kickOsc.start(at); kickOsc.stop(at + 0.15);
      }

      // ── SNARE (on 2 & 4) ──
      if (beatIdx % 4 === 2) {
        const snSize = Math.floor(ctx.sampleRate * 0.1);
        const snBuf = ctx.createBuffer(1, snSize, ctx.sampleRate);
        const snData = snBuf.getChannelData(0);
        for (let i = 0; i < snSize; i++) snData[i] = (Math.random() * 2 - 1) * (1 - i / snSize) * 0.7;
        const snSrc = ctx.createBufferSource();
        snSrc.buffer = snBuf;
        const snFilt = ctx.createBiquadFilter();
        snFilt.type = 'bandpass'; snFilt.frequency.value = 1500; snFilt.Q.value = 0.5;
        const snGain = ctx.createGain();
        snGain.gain.setValueAtTime(0.3, at);
        snGain.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
        snSrc.connect(snFilt); snFilt.connect(snGain); snGain.connect(master);
        snSrc.start(at); snSrc.stop(at + 0.1);
      }

      // ── HI-HAT (every 8th) ──
      const hhSize = Math.floor(ctx.sampleRate * 0.025);
      const hhBuf = ctx.createBuffer(1, hhSize, ctx.sampleRate);
      const hhData = hhBuf.getChannelData(0);
      for (let i = 0; i < hhSize; i++) hhData[i] = (Math.random() * 2 - 1) * (1 - i / hhSize);
      const hhSrc = ctx.createBufferSource();
      hhSrc.buffer = hhBuf;
      const hhFilt = ctx.createBiquadFilter();
      hhFilt.type = 'highpass'; hhFilt.frequency.value = 9000;
      const hhGain = ctx.createGain();
      const openHH = beatIdx % 4 === 3;
      hhGain.gain.setValueAtTime(openHH ? 0.12 : 0.07, at);
      hhGain.gain.exponentialRampToValueAtTime(0.001, at + (openHH ? 0.08 : 0.02));
      hhSrc.connect(hhFilt); hhFilt.connect(hhGain); hhGain.connect(master);
      hhSrc.start(at); hhSrc.stop(at + 0.1);

      // ── SYNTH BASS ──
      const bassFreq = bassSeq[idx];
      if (bassFreq) {
        const bo = ctx.createOscillator();
        const bg = ctx.createGain();
        bo.type = 'sawtooth';
        bo.frequency.setValueAtTime(bassFreq, at);
        // slight pitch slide up
        bo.frequency.exponentialRampToValueAtTime(bassFreq * 1.01, at + STEP * 0.3);
        const bFilt = ctx.createBiquadFilter();
        bFilt.type = 'lowpass';
        bFilt.frequency.setValueAtTime(600, at);
        bFilt.frequency.exponentialRampToValueAtTime(200, at + STEP * 0.7);
        bg.gain.setValueAtTime(0.18, at);
        bg.gain.exponentialRampToValueAtTime(0.001, at + STEP * 0.85);
        bo.connect(bFilt); bFilt.connect(bg); bg.connect(master);
        bo.start(at); bo.stop(at + STEP * 0.9);
      }

      // ── LEAD SYNTH ──
      const leadFreq = leadSeq[idx];
      if (leadFreq) {
        const lo = ctx.createOscillator();
        const lg = ctx.createGain();
        lo.type = 'square';
        lo.frequency.setValueAtTime(leadFreq, at);
        lg.gain.setValueAtTime(0.06, at);
        lg.gain.exponentialRampToValueAtTime(0.001, at + STEP * 0.8);
        lo.connect(lg); lg.connect(rev); lg.connect(master);
        lo.start(at); lo.stop(at + STEP * 0.85);
      }

      // ── PAD chord (every bar) ──
      if (beatIdx % 8 === 0) {
        const padFreqs = [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3];
        padFreqs.forEach(f => {
          const po = ctx.createOscillator();
          const pg = ctx.createGain();
          po.type = 'sine';
          po.frequency.setValueAtTime(f, at);
          pg.gain.setValueAtTime(0, at);
          pg.gain.linearRampToValueAtTime(0.025, at + 0.05);
          pg.gain.exponentialRampToValueAtTime(0.001, at + BAR * 0.9);
          po.connect(pg); pg.connect(rev); pg.connect(master);
          po.start(at); po.stop(at + BAR);
        });
      }

      scheduledUntil += STEP;
      beatIdx++;
    }
    const tid = setTimeout(scheduleLoop, 80);
    stopFns.push(() => clearTimeout(tid));
  };

  scheduleLoop();
  stopFns.push(() => { running = false; });
}

// ── Fade out & stop ───────────────────────────────────
export function stopBGM(fadeSec = 1.2) {
  const { ctx, master } = getCtx();
  if (masterGain) {
    masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeSec);
  }
  setTimeout(() => {
    stopAll();
    // Reset master volume for next track
    if (masterGain) masterGain.gain.setValueAtTime(0.38, ctx.currentTime);
  }, fadeSec * 1000 + 100);
}

// ── Volume control ────────────────────────────────────
export function setBGMVolume(vol: number) {
  const { master } = getCtx();
  master.gain.setValueAtTime(Math.max(0, Math.min(1, vol)), audioCtx!.currentTime);
}
