import { useRef, useEffect, useState, useCallback } from 'react';
import {
  playShoot, playStarCollect, playBombHit, playBombDestroy,
  playCountdown, playCountdownGo, playLevelUp, playGameOver,
} from '@/lib/sfx';

// ── Config (all per-second units) ───────────────────
const GAME_DURATION   = 30_000;          // ms
const PLAYER_SPEED    = 360;             // px/s  (was 6 px/frame × 60fps)
const MAX_LIVES       = 2;
const STAR_POINTS     = 10;

// ── Types ────────────────────────────────────────────
interface Vec2 { x: number; y: number; }
interface Bullet extends Vec2 { w: number; h: number; level: number; hue: number; trail: Vec2[]; }
interface FallingObj extends Vec2 {
  type: 'star' | 'bomb';
  size: number;
  speed: number;   // px/s
  rotation: number;
  vx: number;      // px/s
  sineAmp: number;
  sineFreq: number; // cycles/s
  originX: number;
  age: number;      // seconds
}
interface Particle extends Vec2 { vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface BgStar extends Vec2 { size: number; brightness: number; speed: number; }  // speed px/s

type GamePhase = 'demo' | 'instructions' | 'countdown' | 'playing' | 'gameover' | 'waiting' | 'done';

interface ShooterGameProps {
  gameType: string;
  tableName: string;
  maxTime?: number;
  onGameEnd: (score: number) => void;
}

const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const hsl = (h: number, s: number, l: number, a = 1) =>
  a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`;

// Bullet level config — speeds in px/s, intervals in seconds
function getBulletConfig(level: number) {
  const configs = [
    { w: 4,  h: 12, speed: 420, color: 190, name: 'Basic',      interval: 0.220 },
    { w: 6,  h: 16, speed: 480, color: 200, name: 'Rapid',      interval: 0.180 },
    { w: 9,  h: 20, speed: 540, color: 280, name: 'Plasma',     interval: 0.140 },
    { w: 12, h: 26, speed: 600, color: 320, name: 'Nova',       interval: 0.110 },
    { w: 16, h: 32, speed: 660, color: 45,  name: 'Solar',      interval: 0.080 },
    { w: 20, h: 36, speed: 720, color: 0,   name: 'Inferno',    interval: 0.060 },
    { w: 26, h: 42, speed: 780, color: 290, name: 'Machinegun', interval: 0.040 },
    { w: 32, h: 48, speed: 840, color: 180, name: 'GODMODE',    interval: 0.030 },
  ];
  return configs[Math.min(level, configs.length - 1)];
}

export default function ShooterGame({ maxTime = 45, onGameEnd }: ShooterGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('demo');
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [elapsed, setElapsed] = useState(0);
  const [bulletLevel, setBulletLevel] = useState(0);

  const gs = useRef({
    player: { x: 0, y: 0, w: 44, h: 44 },
    bullets:   [] as Bullet[],
    objects:   [] as FallingObj[],
    particles: [] as Particle[],
    bgStars:   [] as BgStar[],
    score: 0,
    lives: MAX_LIVES,
    startTime: 0,        // performance.now() ms
    lastBullet: 0,       // seconds since startTime
    lastStar:   0,       // seconds since startTime
    lastBomb:   0,       // seconds since startTime
    keys: new Set<string>(),
    touchX: null as number | null,
    touchY: null as number | null,
    phase: 'demo' as GamePhase,
    maxTimeMs: maxTime * 1000,
    gameplayEnded: false,
    loopRunning: false,   // guard against duplicate RAF
    W: 0,
    H: 0,
    prevBulletLevel: 0,
    shipHue: 0,
    shakeAmount: 0,
    hitFlashTimer: 0,    // seconds
    lastFrameTime: 0,    // performance.now() of last RAF
    evolveFlash: { timer: 0, label: '', hue: 190 }, // evolution flash
    demoAiTarget: { x: 0, y: 0 },                   // AI pilot target in demo
  });

  const initBgStars = useCallback((w: number, h: number) => {
    const stars: BgStar[] = [];
    for (let i = 0; i < 120; i++) {
      stars.push({ x: rand(0, w), y: rand(0, h), size: rand(0.5, 2.5), brightness: rand(0.2, 1), speed: rand(18, 72) }); // px/s
    }
    gs.current.bgStars = stars;
  }, []);

  const spawnParticles = useCallback((x: number, y: number, color: string, count: number) => {
    const g = gs.current;
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const spd   = rand(60, 300);   // px/s
      g.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: rand(0.35, 0.85),       // seconds
        maxLife: 0.85,
        color,
        size: rand(1, 4),
      });
    }
  }, []);

  // ── Drawing ───────────────────────────────────────
  const drawBgStars = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => {
    gs.current.bgStars.forEach(s => {
      s.y += s.speed * dt;
      if (s.y > h) { s.y = 0; s.x = rand(0, w); }
      const twinkle = 0.5 + Math.sin(t * 0.003 + s.x) * 0.5;
      ctx.fillStyle = hsl(200, 100, 95, s.brightness * 0.5 * twinkle);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  const drawShip = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, level: number) => {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);

    const shipHue = 190 + level * 20;
    const pulse = 1 + Math.sin(t * 0.006) * 0.15;

    if (level >= 1) {
      const fieldSize = (w * 0.8 + level * 4) * pulse;
      const field = ctx.createRadialGradient(0, 0, 0, 0, 0, fieldSize);
      field.addColorStop(0, hsl(shipHue, 100, 70, 0.15 + level * 0.03));
      field.addColorStop(0.5, hsl(shipHue + 30, 100, 60, 0.05));
      field.addColorStop(1, hsl(shipHue, 100, 50, 0));
      ctx.fillStyle = field;
      ctx.beginPath();
      ctx.arc(0, 0, fieldSize, 0, Math.PI * 2);
      ctx.fill();
    }

    const flameH = (h * 0.5 + level * 6) * (0.8 + Math.random() * 0.4);
    const flameGrad = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.3 + flameH);
    flameGrad.addColorStop(0, hsl(shipHue, 100, 90, 0.9));
    flameGrad.addColorStop(0.3, hsl(shipHue + 20, 100, 60, 0.6));
    flameGrad.addColorStop(1, hsl(shipHue + 40, 100, 50, 0));
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.moveTo(-w * 0.2, h * 0.3);
    ctx.quadraticCurveTo(0, h * 0.3 + flameH, w * 0.2, h * 0.3);
    ctx.fill();

    if (level >= 2) {
      [-1, 1].forEach(side => {
        const sFlameH = flameH * 0.6 * (0.7 + Math.random() * 0.3);
        ctx.fillStyle = hsl(shipHue + 60, 100, 70, 0.4);
        ctx.beginPath();
        ctx.moveTo(side * w * 0.35, h * 0.2);
        ctx.quadraticCurveTo(side * w * 0.4, h * 0.2 + sFlameH, side * w * 0.3, h * 0.2);
        ctx.fill();
      });
    }

    const bodyGrad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    bodyGrad.addColorStop(0, hsl(shipHue, 80, 80));
    bodyGrad.addColorStop(0.5, hsl(shipHue, 70, 50));
    bodyGrad.addColorStop(1, hsl(230, 40, 25));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(-w * 0.45, h * 0.35);
    ctx.lineTo(-w * 0.2, h * 0.25);
    ctx.lineTo(0, h * 0.4);
    ctx.lineTo(w * 0.2, h * 0.25);
    ctx.lineTo(w * 0.45, h * 0.35);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = hsl(shipHue, 100, 70, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w * 0.15, 0);
    ctx.lineTo(-w * 0.4, h * 0.3);
    ctx.moveTo(w * 0.15, 0);
    ctx.lineTo(w * 0.4, h * 0.3);
    ctx.stroke();

    const cockpitGrad = ctx.createRadialGradient(0, -h * 0.08, 0, 0, -h * 0.08, w * 0.15);
    cockpitGrad.addColorStop(0, hsl(shipHue, 100, 95, 0.9));
    cockpitGrad.addColorStop(1, hsl(shipHue, 100, 60, 0.5));
    ctx.fillStyle = cockpitGrad;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.08, w * 0.12, h * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    if (level >= 1) {
      for (let i = 0; i < Math.min(level, 5); i++) {
        const lx = (i - (Math.min(level, 5) - 1) / 2) * 6;
        ctx.fillStyle = hsl(shipHue + i * 30, 100, 70, 0.7 + Math.sin(t * 0.01 + i) * 0.3);
        ctx.beginPath();
        ctx.arc(lx, h * 0.15, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }, []);

  const drawStar = useCallback((ctx: CanvasRenderingContext2D, obj: FallingObj, t: number) => {
    ctx.save();
    ctx.translate(obj.x, obj.y);
    ctx.rotate(obj.rotation + t * 0.003);
    const s = obj.size;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2);
    glow.addColorStop(0, hsl(45, 100, 70, 0.5));
    glow.addColorStop(1, hsl(45, 100, 70, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hsl(45, 100, 65);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s : s * 0.45;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }, []);

  const drawBomb = useCallback((ctx: CanvasRenderingContext2D, obj: FallingObj, t: number) => {
    ctx.save();
    ctx.translate(obj.x, obj.y);
    const s = obj.size;
    const pulse = 1 + Math.sin(t * 0.012) * 0.12;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.2 * pulse);
    glow.addColorStop(0, hsl(0, 85, 55, 0.35));
    glow.addColorStop(1, hsl(0, 85, 55, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 2.2 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hsl(0, 10, 12);
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hsl(0, 85, 60, 0.8);
    ctx.beginPath();
    ctx.arc(-s * 0.25, -s * 0.15, s * 0.18, 0, Math.PI * 2);
    ctx.arc(s * 0.25, -s * 0.15, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hsl(0, 85, 60, 0.6);
    ctx.fillRect(-s * 0.2, s * 0.15, s * 0.4, s * 0.08);
    ctx.strokeStyle = hsl(30, 50, 40);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.3, -s - 6, 0, -s - 10);
    ctx.stroke();
    const sparkSize = 3 + Math.sin(t * 0.02) * 2;
    ctx.fillStyle = hsl(40 + Math.sin(t * 0.05) * 30, 100, 75);
    ctx.beginPath();
    ctx.arc(0, -s - 10, sparkSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, []);

  const drawBullet = useCallback((ctx: CanvasRenderingContext2D, b: Bullet, t: number) => {
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    const cfg = getBulletConfig(b.level);

    if (b.trail.length > 1 && b.level >= 1) {
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < b.trail.length - 1; i++) {
        const alpha = i / b.trail.length;
        const tw = b.w * alpha * 0.8;
        ctx.fillStyle = hsl(cfg.color, 100, 70, alpha * 0.4);
        const tx = b.trail[i].x - (b.x + b.w / 2);
        const ty = b.trail[i].y - (b.y + b.h / 2);
        ctx.beginPath();
        ctx.arc(tx, ty, tw / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const glowSize = (b.w + b.level * 3) * (1 + Math.sin(t * 0.015 + b.y * 0.1) * 0.3);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
    glow.addColorStop(0, hsl(cfg.color, 100, 80, 0.5 + b.level * 0.05));
    glow.addColorStop(0.5, hsl(cfg.color + 30, 100, 60, 0.15));
    glow.addColorStop(1, hsl(cfg.color, 100, 50, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowSize, 0, Math.PI * 2);
    ctx.fill();

    const coreGrad = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
    coreGrad.addColorStop(0, hsl(cfg.color, 100, 95));
    coreGrad.addColorStop(0.5, hsl(cfg.color, 100, 70));
    coreGrad.addColorStop(1, hsl(cfg.color + 20, 100, 50));
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, b.w / 2);
    ctx.fill();

    if (b.level >= 3) {
      ctx.fillStyle = hsl(cfg.color, 50, 95, 0.8);
      ctx.beginPath();
      ctx.roundRect(-b.w * 0.2, -b.h * 0.4, b.w * 0.4, b.h * 0.8, b.w * 0.2);
      ctx.fill();
    }

    ctx.restore();
  }, []);

  const drawHUD = useCallback((ctx: CanvasRenderingContext2D, w: number, score: number, lives: number, elapsedMs: number, bLevel: number) => {
    const pad = 15;
    const totalSec = Math.floor(elapsedMs / 1000);
    const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const secs = String(totalSec % 60).padStart(2, '0');
    const timeStr = `${mins}:${secs}`;

    ctx.font = '700 22px Orbitron, monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(timeStr).width + 30;
    ctx.fillStyle = hsl(230, 30, 6, 0.5);
    ctx.beginPath();
    ctx.roundRect(w / 2 - tw / 2, pad - 4, tw, 32, 8);
    ctx.fill();
    ctx.fillStyle = hsl(190, 100, 80, 0.9);
    ctx.fillText(timeStr, w / 2, pad + 20);

    ctx.font = '600 18px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = hsl(45, 100, 70);
    ctx.fillText(`★ ${score}`, pad, pad + 18);

    ctx.textAlign = 'right';
    const heartSize = 28;
    const heartPad  = 8;
    const heartsStartX = w - pad;
    const heartsY   = pad + 16;
    for (let i = 0; i < MAX_LIVES; i++) {
      const hx    = heartsStartX - (MAX_LIVES - 1 - i) * (heartSize + heartPad);
      const alive = i < lives;
      if (alive) {
        const glow = ctx.createRadialGradient(hx, heartsY, 0, hx, heartsY, heartSize);
        glow.addColorStop(0, hsl(0, 100, 60, 0.4));
        glow.addColorStop(1, hsl(0, 100, 60, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(hx, heartsY, heartSize, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(hx, heartsY);
      const hs = heartSize * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, hs * 0.4);
      ctx.bezierCurveTo(-hs, -hs * 0.2, -hs, -hs * 0.9, 0, -hs * 0.5);
      ctx.bezierCurveTo(hs, -hs * 0.9, hs, -hs * 0.2, 0, hs * 0.4);
      ctx.closePath();
      if (alive) {
        const hGrad = ctx.createLinearGradient(0, -hs, 0, hs);
        hGrad.addColorStop(0, hsl(350, 100, 65));
        hGrad.addColorStop(1, hsl(0, 100, 45));
        ctx.fillStyle = hGrad;
      } else {
        ctx.fillStyle = hsl(0, 0, 25, 0.6);
      }
      ctx.fill();
      if (alive) {
        ctx.strokeStyle = hsl(0, 100, 80, 0.6);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }

    if (bLevel > 0) {
      const cfg = getBulletConfig(bLevel);
      ctx.font = '500 12px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = hsl(cfg.color, 100, 70, 0.8);
      ctx.fillText(`⚡ ${cfg.name.toUpperCase()} LV.${bLevel + 1}`, w / 2, pad + 48);
    }
  }, []);

  // ── Main Game Loop (delta-time based) ────────────────
  const gameLoop = useCallback((ctx: CanvasRenderingContext2D, timestamp: number) => {
    const g = gs.current;
    const { W: w, H: h } = g;

    // ── Delta time (clamped to 33ms to avoid tab-switch spikes) ──
    const dtMs = g.lastFrameTime === 0 ? 16.67 : Math.min(timestamp - g.lastFrameTime, 33);
    g.lastFrameTime = timestamp;
    const dt = dtMs / 1000; // seconds

    // Screen shake (decay per second)
    ctx.save();
    if (g.shakeAmount > 0.5) {
      const sx = (Math.random() - 0.5) * g.shakeAmount * 2;
      const sy = (Math.random() - 0.5) * g.shakeAmount * 2;
      ctx.translate(sx, sy);
      g.shakeAmount *= Math.pow(0.9, dt * 60); // frame-rate-independent decay
    } else {
      g.shakeAmount = 0;
    }

    // Clear
    ctx.fillStyle = hsl(225, 25, 12);
    ctx.fillRect(0, 0, w, h);
    drawBgStars(ctx, w, h, timestamp, dt);

    if (g.phase !== 'playing' && g.phase !== 'demo') { ctx.restore(); return; }

    // Initialize demo startTime lazily
    if (g.phase === 'demo' && g.startTime === 0) g.startTime = timestamp;

    const elapsedMs = timestamp - g.startTime;
    const elapsedSec = elapsedMs / 1000;
    const bLevel = Math.min(Math.floor(elapsedMs / 4_000), 7);
    const gameplayActive = elapsedMs < GAME_DURATION && g.lives > 0;

    // Level up notification
    if (bLevel > g.prevBulletLevel && bLevel <= 7) {
      g.prevBulletLevel = bLevel;
      setBulletLevel(bLevel);
      playLevelUp();
      const cfg = getBulletConfig(bLevel);
      for (let i = 0; i < 30; i++) {
        spawnParticles(rand(0, w), rand(0, h), hsl(cfg.color, 100, 70), 3);
      }
      const labels = ['EAGLE EVOLVED!', 'RAPID FIRE!', 'PLASMA MODE!', 'NOVA BURST!', 'SOLAR FLARE!', 'INFERNO!', 'MACHINEGUN!', 'GOD MODE!!!'];
      g.evolveFlash = { timer: 1.6, label: labels[bLevel] ?? 'EVOLVED!', hue: cfg.color };
    }

    setElapsed(elapsedMs);

    // Difficulty: speed multiplier
    const difficultyMult = 1 + (elapsedMs / GAME_DURATION) * 2.0;

    // ── Player movement ──
    if (gameplayActive) {
      if (g.phase === 'demo') {
        // ── AI pilot: seek nearest star, repel from bombs ──
        let aiX = g.player.x + g.player.w / 2;
        let aiY = h * 0.65;
        let minDist = Infinity;
        g.objects.forEach(obj => {
          if (obj.type === 'star') {
            const d = Math.hypot(obj.x - (g.player.x + g.player.w / 2), obj.y - (g.player.y + g.player.h / 2));
            if (d < minDist) { minDist = d; aiX = obj.x; aiY = obj.y; }
          }
        });
        g.objects.forEach(obj => {
          if (obj.type === 'bomb') {
            const d = Math.hypot(obj.x - (g.player.x + g.player.w / 2), obj.y - (g.player.y + g.player.h / 2));
            if (d < 160) {
              const repel = (160 - d) / 160 * 4;
              aiX += (g.player.x + g.player.w / 2 - obj.x) * repel;
              aiY += (g.player.y + g.player.h / 2 - obj.y) * repel;
            }
          }
        });
        g.demoAiTarget = { x: aiX, y: aiY };
        const adx = g.demoAiTarget.x - (g.player.x + g.player.w / 2);
        const ady = g.demoAiTarget.y - (g.player.y + g.player.h / 2);
        const lerpAI = 1 - Math.pow(0.84, dt * 60);
        g.player.x += adx * lerpAI;
        g.player.y += ady * lerpAI;
      } else {
        const spd = PLAYER_SPEED * dt;
        if (g.keys.has('ArrowLeft') || g.keys.has('a')) g.player.x -= spd;
        if (g.keys.has('ArrowRight') || g.keys.has('d')) g.player.x += spd;
        if (g.keys.has('ArrowUp') || g.keys.has('w')) g.player.y -= spd;
        if (g.keys.has('ArrowDown') || g.keys.has('s')) g.player.y += spd;

        if (g.touchX !== null && g.touchY !== null) {
          const dx = g.touchX - (g.player.x + g.player.w / 2);
          const dy = g.touchY - (g.player.y + g.player.h / 2);
          const lerpFactor = 1 - Math.pow(0.88, dt * 60);
          g.player.x += dx * lerpFactor;
          g.player.y += dy * lerpFactor;
        }
      }

      g.player.x = Math.max(0, Math.min(w - g.player.w, g.player.x));
      g.player.y = Math.max(h * 0.2, Math.min(h - g.player.h - 10, g.player.y));

      // Auto-fire — intervals in seconds now
      const cfg = getBulletConfig(bLevel);
      const timeSinceLastBullet = elapsedSec - g.lastBullet;
      if (timeSinceLastBullet > cfg.interval) {
        const bulletCount = bLevel >= 5 ? 4 : bLevel >= 3 ? 3 : bLevel >= 1 ? 2 : 1;
        const spread = bLevel >= 1 ? 14 + bLevel * 2 : 0;
        for (let i = 0; i < bulletCount; i++) {
          const offsetX = bulletCount === 1 ? 0 : (i - (bulletCount - 1) / 2) * spread;
          g.bullets.push({
            x: g.player.x + g.player.w / 2 - cfg.w / 2 + offsetX,
            y: g.player.y - cfg.h,
            w: cfg.w, h: cfg.h,
            level: bLevel,
            hue: cfg.color,
            trail: [],
          });
        }
        g.lastBullet = elapsedSec;
        playShoot(bLevel);
      }

      // Spawn stars — intervals in seconds
      const starInterval = Math.max(0.07, 0.25 - elapsedMs * 0.000003);
      const timeSinceLastStar = elapsedSec - g.lastStar;
      if (timeSinceLastStar > starInterval) {
        g.objects.push({
          x: rand(20, w - 20), y: -20, type: 'star',
          size:  rand(10, 16),
          speed: rand(120, 240) * difficultyMult,  // px/s
          rotation: rand(0, Math.PI * 2),
          vx: 0, sineAmp: 0, sineFreq: 0, originX: 0, age: 0,
        });
        g.lastStar = elapsedSec;
      }

      // Spawn bombs — intervals in seconds
      const bombInterval = Math.max(0.025, 0.12 - elapsedMs * 0.000003);
      const timeSinceLastBomb = elapsedSec - g.lastBomb;
      if (timeSinceLastBomb > bombInterval) {
        const bx = rand(20, w - 20);
        const pattern = Math.random();
        let vx = 0, sineAmp = 0, sineFreq = 0;
        if (pattern < 0.3) {
          vx = rand(-150, 150);          // px/s
        } else if (pattern < 0.6) {
          sineAmp  = rand(30, 80);
          sineFreq = rand(1.2, 3.6);    // cycles/s
        } else if (pattern < 0.8) {
          vx = rand(-90, 90);
          sineAmp  = rand(15, 40);
          sineFreq = rand(1.8, 3.0);
        }
        g.objects.push({
          x: bx, y: -20, type: 'bomb',
          size:  rand(12, 18),
          speed: rand(120, 270) * difficultyMult,  // px/s
          rotation: 0,
          vx, sineAmp, sineFreq, originX: bx, age: 0,
        });
        g.lastBomb = elapsedSec;
      }
    }

    // ── Update bullets ──
    g.bullets = g.bullets.filter(b => {
      const cfg = getBulletConfig(b.level);
      b.trail.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      if (b.trail.length > 8) b.trail.shift();
      b.y -= cfg.speed * dt;
      return b.y + b.h > 0;
    });

    // ── Update objects & collision ──
    const pcx = g.player.x + g.player.w / 2;
    const pcy = g.player.y + g.player.h / 2;
    const pr  = g.player.w * 0.38;

    g.objects = g.objects.filter(obj => {
      obj.age += dt;
      obj.y   += obj.speed * dt;
      if (obj.vx)      obj.x  = obj.x + obj.vx * dt;
      if (obj.sineAmp) obj.x  = obj.originX + Math.sin(obj.age * obj.sineFreq * Math.PI * 2) * obj.sineAmp;
      if (obj.x < 10)      { obj.x = 10;     obj.vx =  Math.abs(obj.vx || 0); }
      if (obj.x > w - 10)  { obj.x = w - 10; obj.vx = -Math.abs(obj.vx || 0); }
      if (obj.y > h + 30) return false;

      if (gameplayActive) {
        const dx = obj.x - pcx;
        const dy = obj.y - pcy;
        if (Math.sqrt(dx * dx + dy * dy) < pr + obj.size) {
          if (obj.type === 'star') {
            g.score += STAR_POINTS;
            setScore(g.score);
            spawnParticles(obj.x, obj.y, hsl(45, 100, 70), 15);
            playStarCollect();
          } else {
            g.lives--;
            setLives(g.lives);
            spawnParticles(obj.x, obj.y, hsl(0, 85, 55), 40);
            playBombHit();
            g.shakeAmount    = 18;
            g.hitFlashTimer  = 0.25; // seconds
            if (g.lives <= 0) g.gameplayEnded = true;
          }
          return false;
        }
      }

      // Bullet–bomb collision
      if (obj.type === 'bomb') {
        for (let i = g.bullets.length - 1; i >= 0; i--) {
          const b  = g.bullets[i];
          const bx = b.x + b.w / 2;
          const by = b.y + b.h / 2;
          if (Math.sqrt((obj.x - bx) ** 2 + (obj.y - by) ** 2) < obj.size + b.w) {
            g.score += 5;
            setScore(g.score);
            spawnParticles(obj.x, obj.y, hsl(30, 100, 60), 12);
            playBombDestroy();
            g.bullets.splice(i, 1);
            return false;
          }
        }
      }
      return true;
    });

    // ── Update particles ──
    g.particles = g.particles.filter(p => {
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.vx *= Math.pow(0.98, dt * 60);
      p.vy *= Math.pow(0.98, dt * 60);
      p.life -= dt;
      return p.life > 0;
    });

    // ── Draw ──
    g.bullets.forEach(b => drawBullet(ctx, b, timestamp));
    g.objects.forEach(obj => obj.type === 'star' ? drawStar(ctx, obj, timestamp) : drawBomb(ctx, obj, timestamp));

    g.particles.forEach(p => {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (g.lives > 0) drawShip(ctx, g.player.x, g.player.y, g.player.w, g.player.h, timestamp, bLevel);

    // Hit flash overlay
    if (g.hitFlashTimer > 0) {
      const flashAlpha = (g.hitFlashTimer / 0.25) * 0.4;
      const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8);
      vignette.addColorStop(0, hsl(0, 100, 50, 0));
      vignette.addColorStop(1, hsl(0, 100, 30, flashAlpha));
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = hsl(0, 100, 50, flashAlpha * 1.5);
      ctx.lineWidth = 6;
      ctx.strokeRect(0, 0, w, h);
      g.hitFlashTimer = Math.max(0, g.hitFlashTimer - dt);
    }

    drawHUD(ctx, w, g.score, g.lives, elapsedMs, bLevel);

    // ── Evolve flash ──
    if (g.evolveFlash.timer > 0) {
      const ef = g.evolveFlash;
      const progress = ef.timer / 1.6; // 1 → 0
      // scale: zoom in fast then hold
      const scale = progress > 0.75
        ? 0.5 + (1 - progress) / 0.25 * 0.65   // 0.5 → 1.15 (zoom-in phase)
        : 1.15;                                   // hold
      const alpha = progress > 0.2 ? 1 : progress / 0.2; // fade out at end
      const cy = h * 0.42;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(w / 2, cy);
      ctx.scale(scale, scale);

      // Glow backdrop
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 220);
      grd.addColorStop(0, hsl(ef.hue, 100, 50, 0.28 * alpha));
      grd.addColorStop(1, hsl(ef.hue, 100, 50, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, 220, 0, Math.PI * 2);
      ctx.fill();

      // Sub-label: "LEVEL UP"
      ctx.font = '700 22px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = hsl(ef.hue, 100, 85, alpha);
      ctx.letterSpacing = '6px';
      ctx.fillText('LEVEL UP', 0, -36);

      // Main label
      ctx.font = '900 52px Orbitron, monospace';
      ctx.fillStyle = hsl(ef.hue, 100, 95, alpha);
      ctx.shadowColor = hsl(ef.hue, 100, 60);
      ctx.shadowBlur = 30;
      ctx.fillText(ef.label, 0, 18);
      ctx.shadowBlur = 0;

      ctx.restore();
      ef.timer = Math.max(0, ef.timer - dt);
    }

    // ── Phase transitions ──
    if (!g.gameplayEnded && (elapsedMs >= GAME_DURATION || g.lives <= 0)) {
      g.gameplayEnded = true;
      playGameOver();
      if (g.lives <= 0) {
        setPhase('done');
        g.phase = 'done';
        onGameEnd(g.score);
        ctx.restore();
        return;
      }
      setPhase('waiting');
      g.phase = 'waiting';
    }

    if (elapsedMs >= g.maxTimeMs) {
      setPhase('done');
      g.phase = 'done';
      onGameEnd(g.score);
    }

    ctx.restore();
  }, [drawBgStars, drawBullet, drawBomb, drawStar, drawShip, drawHUD, spawnParticles, onGameEnd]);

  // ── Canvas & input setup ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      gs.current.W  = canvas.width;
      gs.current.H  = canvas.height;
      gs.current.player.x = canvas.width / 2 - 22;
      gs.current.player.y = canvas.height - 90;
      if (gs.current.bgStars.length === 0) initBgStars(canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const onKD = (e: KeyboardEvent) => { e.preventDefault(); gs.current.keys.add(e.key); };
    const onKU = (e: KeyboardEvent) => gs.current.keys.delete(e.key);
    const onTS = (e: TouchEvent) => { gs.current.touchX = e.touches[0].clientX; gs.current.touchY = e.touches[0].clientY; };
    const onTM = (e: TouchEvent) => { e.preventDefault(); gs.current.touchX = e.touches[0].clientX; gs.current.touchY = e.touches[0].clientY; };
    const onTE = () => { gs.current.touchX = null; gs.current.touchY = null; };

    window.addEventListener('keydown', onKD);
    window.addEventListener('keyup', onKU);
    canvas.addEventListener('touchstart', onTS, { passive: false });
    canvas.addEventListener('touchmove', onTM, { passive: false });
    canvas.addEventListener('touchend', onTE);

    // ── Single RAF loop — guarded by loopRunning ──
    let rafId = 0;
    const loop = (ts: number) => {
      gameLoop(ctx, ts);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKD);
      window.removeEventListener('keyup', onKU);
      canvas.removeEventListener('touchstart', onTS);
      canvas.removeEventListener('touchmove', onTM);
      canvas.removeEventListener('touchend', onTE);
    };
  }, [gameLoop, initBgStars]);

  // ── Countdown ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      const now = performance.now();
      const g = gs.current;
      g.phase          = 'playing';
      g.startTime      = now;
      g.lastBullet     = 0;
      g.lastStar       = 0;
      g.lastBomb       = 0;
      g.lastFrameTime  = 0;  // reset so first dt is clean
      g.prevBulletLevel = 0;
      setPhase('playing');
      playCountdownGo();
      return;
    }
    playCountdown();
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // ── Waiting → maxTime redirect ────────────────────
  useEffect(() => {
    if (phase !== 'waiting') return;
    const g = gs.current;
    const remaining = g.maxTimeMs - (performance.now() - g.startTime);
    if (remaining <= 0) { setPhase('done'); g.phase = 'done'; onGameEnd(g.score); return; }
    const t = setTimeout(() => { setPhase('done'); g.phase = 'done'; onGameEnd(g.score); }, remaining);
    return () => clearTimeout(t);
  }, [phase, onGameEnd]);

  // ── Auto-start: show instructions then auto-countdown ──
  useEffect(() => {
    if (phase !== 'instructions') return;
    const t = setTimeout(() => { setPhase('countdown'); setCountdown(3); }, 3000);
    return () => clearTimeout(t);
  }, [phase]);

  const startGame = () => { setPhase('countdown'); setCountdown(3); };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-game-bg select-none">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Instructions */}
      {phase === 'instructions' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/80 backdrop-blur-md px-6">
          <h1 className="font-game text-3xl md:text-5xl text-primary text-glow mb-6 animate-pulse-glow">
            SPACE SHOOTER
          </h1>
          <div className="max-w-md space-y-3 text-center font-game-body text-lg text-foreground/90">
            <p className="text-accent text-glow-accent text-xl font-semibold">How to Play</p>
            <p>🚀 Move with <span className="text-primary">Arrow Keys / WASD</span> or <span className="text-primary">Touch</span></p>
            <p>🔫 Auto-fire — bullets <span className="text-secondary">evolve every 4s!</span></p>
            <p>⭐ Collect <span className="text-accent">Stars</span> for points</p>
            <p>💣 Avoid <span className="text-destructive">Bombs</span> — 2 lives!</p>
            <p>🎯 Shoot bombs to destroy them</p>
            <p className="text-muted-foreground text-sm">Difficulty increases over time</p>
          </div>
          <button onClick={startGame} className="mt-8 font-game text-lg px-8 py-3 rounded-lg bg-primary text-primary-foreground box-glow hover:brightness-110 transition-all animate-pulse-glow">
            START GAME
          </button>
        </div>
      )}

      {/* Countdown */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/30">
          <p className="font-game text-lg text-primary/60 mb-2">00:00</p>
          <span className="font-game text-9xl md:text-[12rem] text-primary/80 text-glow animate-pulse" style={{ textShadow: '0 0 60px hsl(190 100% 50% / 0.6), 0 0 120px hsl(190 100% 50% / 0.3)' }}>
            {countdown}
          </span>
          <p className="font-game text-lg text-muted-foreground/60 mt-4">GET READY</p>
        </div>
      )}

      {/* Waiting - big score */}
      {phase === 'waiting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/70 backdrop-blur-md">
          <p className="font-game text-4xl md:text-5xl text-destructive mb-6 animate-pulse" style={{ textShadow: '0 0 30px hsl(0 100% 50% / 0.6)' }}>
            GAME OVER
          </p>
          <p className="font-game text-7xl md:text-9xl text-accent mb-4" style={{ textShadow: '0 0 40px hsl(45 100% 50% / 0.5), 0 0 80px hsl(45 100% 50% / 0.3)' }}>
            {score}
          </p>
          <p className="font-game text-xl text-accent/70 mb-6">POINTS</p>
          {bulletLevel > 0 && (
            <p className="font-game text-lg text-primary/80 mb-4">⚡ MAX WEAPON: LV.{bulletLevel + 1}</p>
          )}
          <p className="font-game-body text-lg text-muted-foreground animate-pulse">
            Waiting for other players...
          </p>
        </div>
      )}
    </div>
  );
}
