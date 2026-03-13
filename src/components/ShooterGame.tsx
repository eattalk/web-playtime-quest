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
type BombPattern = 'straight' | 'sine' | 'zigzag' | 'diagonal' | 'boomerang' | 'spiral' | 'homing' | 'burst';
interface FallingObj extends Vec2 {
  type: 'star' | 'bomb';
  size: number;
  speed: number;   // px/s
  rotation: number;
  vx: number;      // px/s
  vy: number;      // px/s (for diagonal/boomerang)
  sineAmp: number;
  sineFreq: number; // cycles/s
  originX: number;
  originY: number;
  age: number;      // seconds
  pattern: BombPattern;
  accelX: number;   // px/s² (boomerang)
  accelY: number;
  spiralR: number;  // spiral radius
  spiralSpeed: number; // rad/s
  spiralAngle: number;
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

// ── AI demo waypoints (relative to canvas) ───────────
const DEMO_WAYPOINTS = [
  [0.5, 0.8], [0.2, 0.6], [0.7, 0.4], [0.4, 0.7],
  [0.8, 0.5], [0.3, 0.3], [0.6, 0.75], [0.5, 0.5],
  [0.15, 0.65], [0.85, 0.35], [0.5, 0.8],
] as const;

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
    loopRunning: false,
    W: 0,
    H: 0,
    prevBulletLevel: 0,
    shipHue: 0,
    shakeAmount: 0,
    hitFlashTimer: 0,    // seconds
    lastFrameTime: 0,    // performance.now() of last RAF
    evolveFlash: { timer: 0, label: '', hue: 190 },
    // demo AI state
    demoStartTime: 0,    // performance.now()
    demoWaypointIdx: 0,
    demoElapsed: 0,      // seconds
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

    // ── DEMO phase: AI-piloted preview ──────────────────
    if (g.phase === 'demo') {
      const DEMO_DUR = 8; // seconds
      if (g.demoStartTime === 0) g.demoStartTime = timestamp;
      g.demoElapsed = (timestamp - g.demoStartTime) / 1000;

      // AI movement: gentle left-right sine drift near bottom center
      const t = g.demoElapsed;
      const targetX = w / 2 - g.player.w / 2
        + Math.sin(t * 0.55) * w * 0.22
        + Math.sin(t * 0.23) * w * 0.08;
      const targetY = h * 0.78 - g.player.h / 2;
      const lf = 1 - Math.pow(0.92, dt * 60);
      g.player.x += (targetX - g.player.x) * lf;
      g.player.y += (targetY - g.player.y) * lf;

      // Clamp
      g.player.x = Math.max(0, Math.min(w - g.player.w, g.player.x));
      g.player.y = Math.max(h * 0.5, Math.min(h - g.player.h - 10, g.player.y));

      // Spawn & update objects (same as playing)
      const demoDiff = 1 + g.demoElapsed * 0.06;
      const starI = Math.max(0.12, 0.3 - g.demoElapsed * 0.002);
      const bombI = Math.max(0.06, 0.16 - g.demoElapsed * 0.002);
      if (g.demoElapsed - g.lastStar > starI) {
        g.objects.push({ x: rand(20, w-20), y: -20, type:'star', size:rand(10,16),
          speed: rand(100,200)*demoDiff, rotation:rand(0,Math.PI*2),
          vx:0, vy:0, sineAmp:0, sineFreq:0, originX:0, originY:0, age:0,
          pattern:'straight', accelX:0, accelY:0, spiralR:0, spiralSpeed:0, spiralAngle:0 });
        g.lastStar = g.demoElapsed;
      }
      if (g.demoElapsed - g.lastBomb > bombI) {
        const bx = rand(20, w-20);
        const patterns: BombPattern[] = ['straight','sine','zigzag','diagonal'];
        const pat = patterns[Math.floor(Math.random()*patterns.length)];
        let vx = 0, sineAmp = 0, sineFreq = 0;
        if (pat==='sine')    { sineAmp=rand(40,100); sineFreq=rand(1.0,3.0); }
        if (pat==='zigzag')  { vx=rand(-200,200); sineAmp=rand(20,50); sineFreq=rand(2,4); }
        if (pat==='diagonal'){ vx=rand(-200,200); }
        g.objects.push({ x:bx, y:-20, type:'bomb', size:rand(12,18),
          speed:rand(100,220)*demoDiff, rotation:0,
          vx, vy:0, sineAmp, sineFreq, originX:bx, originY:-20, age:0, pattern:pat,
          accelX:0, accelY:0, spiralR:0, spiralSpeed:0, spiralAngle:0 });
        g.lastBomb = g.demoElapsed;
      }

      // Auto-fire (demo)
      const cfg = getBulletConfig(Math.min(Math.floor(g.demoElapsed / 2), 3));
      if (g.demoElapsed - g.lastBullet > cfg.interval) {
        const bc = cfg.interval < 0.14 ? 3 : cfg.interval < 0.18 ? 2 : 1;
        const spread = bc > 1 ? 16 : 0;
        for (let i = 0; i < bc; i++) {
          g.bullets.push({ x: g.player.x + g.player.w/2 - cfg.w/2 + (i-(bc-1)/2)*spread,
            y: g.player.y - cfg.h, w:cfg.w, h:cfg.h,
            level: Math.min(Math.floor(g.demoElapsed/2),3), hue:cfg.color, trail:[] });
        }
        g.lastBullet = g.demoElapsed;
        playShoot(0);
      }

      // Update bullets
      g.bullets = g.bullets.filter(b => {
        const c = getBulletConfig(b.level);
        b.trail.push({ x: b.x+b.w/2, y: b.y+b.h/2 });
        if (b.trail.length > 8) b.trail.shift();
        b.y -= c.speed * dt;
        return b.y + b.h > 0;
      });

      // Update objects (simplified — no player collision in demo)
      g.objects = g.objects.filter(obj => {
        obj.age += dt;
        switch (obj.pattern) {
          case 'sine':     obj.y+=obj.speed*dt; obj.x=obj.originX+Math.sin(obj.age*obj.sineFreq*Math.PI*2)*obj.sineAmp; break;
          case 'zigzag':   obj.y+=obj.speed*dt; obj.x+=obj.vx*dt; break;
          case 'diagonal': obj.y+=obj.speed*dt; obj.x+=obj.vx*dt; break;
          default:         obj.y+=obj.speed*dt; break;
        }
        if (obj.x < 0) obj.x = 0; if (obj.x > w) obj.x = w;
        if (obj.y > h + 30) return false;
        // Bullet–bomb
        if (obj.type === 'bomb') {
          for (let i = g.bullets.length-1; i >= 0; i--) {
            const b = g.bullets[i];
            if (Math.sqrt((obj.x-b.x-b.w/2)**2+(obj.y-b.y-b.h/2)**2) < obj.size+b.w) {
              spawnParticles(obj.x, obj.y, hsl(30,100,60), 10);
              playBombDestroy();
              g.bullets.splice(i,1);
              return false;
            }
          }
        }
        return true;
      });

      g.particles = g.particles.filter(p => {
        p.x+=p.vx*dt; p.y+=p.vy*dt;
        p.vx*=Math.pow(0.98,dt*60); p.vy*=Math.pow(0.98,dt*60);
        p.life-=dt; return p.life>0;
      });

      // Draw scene
      g.bullets.forEach(b => drawBullet(ctx, b, timestamp));
      g.objects.forEach(obj => obj.type==='star' ? drawStar(ctx,obj,timestamp) : drawBomb(ctx,obj,timestamp));
      g.particles.forEach(p => {
        const alpha = p.life/p.maxLife;
        ctx.globalAlpha=alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size*(0.5+alpha*0.5),0,Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      drawShip(ctx, g.player.x, g.player.y, g.player.w, g.player.h, timestamp, Math.min(Math.floor(g.demoElapsed/2),3));

      // Dark overlay
      ctx.fillStyle = hsl(225,30,5,0.45);
      ctx.fillRect(0,0,w,h);

      // Pulse ring
      const ringR = 140 + Math.sin(timestamp*0.002)*20;
      const ring = ctx.createRadialGradient(w/2,h/2,ringR*0.6,w/2,h/2,ringR);
      ring.addColorStop(0,hsl(190,100,60,0));
      ring.addColorStop(0.85,hsl(190,100,60,0.12));
      ring.addColorStop(1,hsl(190,100,60,0));
      ctx.fillStyle=ring; ctx.beginPath(); ctx.arc(w/2,h/2,ringR,0,Math.PI*2); ctx.fill();

      // Title
      ctx.save();
      ctx.textAlign='center';
      const titleScale = 1 + Math.sin(timestamp*0.0015)*0.03;
      ctx.translate(w/2, h*0.28);
      ctx.scale(titleScale,titleScale);
      ctx.font='900 clamp(28px,6vw,64px) Orbitron,monospace';
      ctx.shadowColor=hsl(190,100,60); ctx.shadowBlur=40;
      ctx.fillStyle=hsl(190,100,90);
      ctx.fillText('SPACE SHOOTER',0,0);
      ctx.shadowBlur=0;
      ctx.font='600 clamp(12px,2.5vw,22px) Orbitron,monospace';
      ctx.fillStyle=hsl(190,100,70,0.8);
      ctx.fillText('TAP ANYWHERE TO PLAY',0, Math.max(36, Math.min(5*h/100, 56)));
      ctx.restore();

      // Tap to start — pulsing
      const tapAlpha = 0.6 + Math.sin(timestamp * 0.004) * 0.4;
      ctx.font = `700 clamp(14px,3vw,26px) Orbitron,monospace`;
      ctx.textAlign = 'center';
      const tapTxt = '👆 TAP TO START';
      const tapTw = ctx.measureText(tapTxt).width;
      ctx.fillStyle = hsl(225,30,10,0.65);
      ctx.beginPath(); ctx.roundRect(w/2-tapTw/2-24, h*0.88-22, tapTw+48, 38, 19); ctx.fill();
      ctx.fillStyle = hsl(190,100,80,tapAlpha);
      ctx.shadowColor = hsl(190,100,60); ctx.shadowBlur = 18;
      ctx.fillText(tapTxt, w/2, h*0.88);
      ctx.shadowBlur = 0;

      ctx.restore();
      return;
    }

    if (g.phase !== 'playing') { ctx.restore(); return; }

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
      const spd = PLAYER_SPEED * dt;
      if (g.keys.has('ArrowLeft') || g.keys.has('a')) g.player.x -= spd;
      if (g.keys.has('ArrowRight') || g.keys.has('d')) g.player.x += spd;
      if (g.keys.has('ArrowUp') || g.keys.has('w')) g.player.y -= spd;
      if (g.keys.has('ArrowDown') || g.keys.has('s')) g.player.y += spd;

      if (g.touchX !== null && g.touchY !== null) {
        const dx = g.touchX - (g.player.x + g.player.w / 2);
        const dy = g.touchY - (g.player.y + g.player.h / 2);
        // dt-based lerp: factor = 1 - (1-0.12)^(dt*60)
        const lerpFactor = 1 - Math.pow(0.88, dt * 60);
        g.player.x += dx * lerpFactor;
        g.player.y += dy * lerpFactor;
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
          size: rand(10, 16),
          speed: rand(120, 240) * difficultyMult,
          rotation: rand(0, Math.PI * 2),
          vx: 0, vy: 0, sineAmp: 0, sineFreq: 0,
          originX: 0, originY: 0, age: 0, pattern: 'straight',
          accelX: 0, accelY: 0, spiralR: 0, spiralSpeed: 0, spiralAngle: 0,
        });
        g.lastStar = elapsedSec;
      }

      // Spawn bombs — intervals in seconds
      const bombInterval = Math.max(0.015, 0.09 - elapsedMs * 0.000003);
      const timeSinceLastBomb = elapsedSec - g.lastBomb;
      if (timeSinceLastBomb > bombInterval) {
        const diffRatio = elapsedMs / GAME_DURATION; // 0→1
        const burstCount = elapsedMs > 20000 ? (Math.random() < 0.5 ? 3 : 2) :
                           elapsedMs > 10000 ? (Math.random() < 0.45 ? 2 : 1) : 1;

        for (let b = 0; b < burstCount; b++) {
          // 40% chance to aim directly at player — punishes standing still
          const targeted = Math.random() < 0.40;
          const bx = targeted
            ? g.player.x + g.player.w / 2 + rand(-30, 30)
            : rand(20, w - 20);
          const by = b === 0 ? -20 : rand(-60, -20);
          const spd = rand(160, 340) * difficultyMult;

          // Pick pattern weighted by difficulty
          const roll = Math.random();
          let pattern: BombPattern;
          if (targeted && diffRatio > 0.3)           pattern = 'homing';
          else if (targeted)                         pattern = 'straight';
          else if (roll < 0.12)                      pattern = 'straight';
          else if (roll < 0.27)                      pattern = 'sine';
          else if (roll < 0.41)                      pattern = 'zigzag';
          else if (roll < 0.54)                      pattern = 'diagonal';
          else if (roll < 0.65 && diffRatio > 0.15) pattern = 'boomerang';
          else if (roll < 0.77 && diffRatio > 0.30) pattern = 'spiral';
          else if (roll < 0.90 && diffRatio > 0.45) pattern = 'homing';
          else                                       pattern = 'sine';

          let vx = 0, vy = 0, sineAmp = 0, sineFreq = 0;
          let accelX = 0, accelY = 0;
          let spiralR = 0, spiralSpeed = 0, spiralAngle = 0;

          switch (pattern) {
            case 'straight':
              break;
            case 'sine':
              sineAmp  = rand(40, 110);
              sineFreq = rand(1.0, 3.2);
              break;
            case 'zigzag':
              vx = (Math.random() < 0.5 ? 1 : -1) * rand(180, 320);
              sineAmp  = rand(20, 50);
              sineFreq = rand(2.5, 5.0);
              break;
            case 'diagonal':
              vx = rand(-240, 240);
              break;
            case 'boomerang':
              vx = rand(-280, 280);
              accelX = -vx * rand(1.2, 2.2);
              break;
            case 'spiral':
              spiralR = rand(50, 130);
              spiralSpeed = rand(3.0, 6.0) * (Math.random() < 0.5 ? 1 : -1);
              spiralAngle = rand(0, Math.PI * 2);
              break;
            case 'homing':
              // Stronger initial aim toward player
              vx = (g.player.x + g.player.w / 2 - bx) * rand(0.8, 1.4);
              break;
          }

          g.objects.push({
            x: bx, y: by, type: 'bomb',
            size: rand(12, 20),
            speed: spd,
            rotation: 0,
            vx, vy, sineAmp, sineFreq,
            originX: bx, originY: by,
            age: 0, pattern,
            accelX, accelY,
            spiralR, spiralSpeed, spiralAngle,
          });
        }
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

      // Pattern-specific movement
      switch (obj.pattern) {
        case 'straight':
          obj.y += obj.speed * dt;
          break;
        case 'sine':
          obj.y += obj.speed * dt;
          obj.x = obj.originX + Math.sin(obj.age * obj.sineFreq * Math.PI * 2) * obj.sineAmp;
          break;
        case 'zigzag':
          obj.y += obj.speed * dt;
          obj.x += obj.vx * dt;
          obj.x = obj.originX + Math.sin(obj.age * obj.sineFreq * Math.PI * 2) * obj.sineAmp + (obj.vx > 0 ? obj.age * 30 : -obj.age * 30);
          break;
        case 'diagonal':
          obj.y += obj.speed * dt;
          obj.x += obj.vx * dt;
          break;
        case 'boomerang':
          obj.vx += obj.accelX * dt;
          obj.x  += obj.vx * dt;
          obj.y  += obj.speed * dt;
          break;
        case 'spiral':
          obj.spiralAngle += obj.spiralSpeed * dt;
          obj.x = obj.originX + Math.cos(obj.spiralAngle) * obj.spiralR;
          obj.y = obj.originY + obj.age * obj.speed;
          break;
        case 'homing': {
          // Gradually steer toward player
          const tx = pcx - obj.x;
          const ty = pcy - obj.y;
          const dist = Math.sqrt(tx * tx + ty * ty) || 1;
          const homingStr = 120 * dt;
          obj.vx += (tx / dist) * homingStr;
          obj.vy += (ty / dist) * homingStr;
          // clamp speed
          const vspd = Math.sqrt(obj.vx * obj.vx + obj.vy * obj.vy) || 1;
          if (vspd > obj.speed) { obj.vx = (obj.vx / vspd) * obj.speed; obj.vy = (obj.vy / vspd) * obj.speed; }
          obj.x += obj.vx * dt;
          obj.y += obj.vy * dt;
          break;
        }
        default:
          obj.y += obj.speed * dt;
          obj.x += obj.vx * dt;
      }

      // Wall bounce for patterns with horizontal velocity
      if (obj.pattern === 'diagonal' || obj.pattern === 'boomerang') {
        if (obj.x < 10)     { obj.x = 10;     obj.vx =  Math.abs(obj.vx); }
        if (obj.x > w - 10) { obj.x = w - 10; obj.vx = -Math.abs(obj.vx); }
      }
      if (obj.x < 0)  obj.x = 0;
      if (obj.x > w)  obj.x = w;

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
            g.hitFlashTimer  = 0.25;
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

  // ── Stable ref for gameLoop to avoid RAF restarts ──
  const gameLoopRef = useRef(gameLoop);
  useEffect(() => { gameLoopRef.current = gameLoop; }, [gameLoop]);

  // ── Canvas & input setup (runs once) ──────────────
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

    const onKD = (e: KeyboardEvent) => {
      e.preventDefault();
      if (gs.current.phase === 'demo') { launchCountdown(); return; }
      gs.current.keys.add(e.key);
    };
    const onKU = (e: KeyboardEvent) => gs.current.keys.delete(e.key);
    const onTS = (e: TouchEvent) => {
      if (gs.current.phase === 'demo') { launchCountdown(); return; }
      gs.current.touchX = e.touches[0].clientX;
      gs.current.touchY = e.touches[0].clientY;
    };
    const onTM = (e: TouchEvent) => {
      e.preventDefault();
      if (gs.current.phase === 'demo') return;
      gs.current.touchX = e.touches[0].clientX;
      gs.current.touchY = e.touches[0].clientY;
    };
    const onTE = () => { gs.current.touchX = null; gs.current.touchY = null; };
    const onClick = () => { if (gs.current.phase === 'demo') launchCountdown(); };

    window.addEventListener('keydown', onKD);
    window.addEventListener('keyup', onKU);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('touchstart', onTS, { passive: false });
    canvas.addEventListener('touchmove', onTM, { passive: false });
    canvas.addEventListener('touchend', onTE);

    // ── Single RAF loop — uses ref to avoid re-registering ──
    let rafId = 0;
    const loop = (ts: number) => {
      gameLoopRef.current(ctx, ts);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKD);
      window.removeEventListener('keyup', onKU);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('touchstart', onTS);
      canvas.removeEventListener('touchmove', onTM);
      canvas.removeEventListener('touchend', onTE);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initBgStars]);

  // ── Demo auto-end (8 s) ───────────────────────────
  useEffect(() => {
    if (phase !== 'demo') return;
    const t = setTimeout(() => launchCountdown(), 8000);
    return () => clearTimeout(t);
  }, [phase]);

  // ── Launch countdown & fully reset game state ─────
  const launchCountdown = useCallback(() => {
    const g = gs.current;
    if (g.phase !== 'demo') return; // guard against double-call
    // Hard-reset all game state so play starts fresh
    g.phase          = 'countdown';
    g.bullets        = [];
    g.objects        = [];
    g.particles      = [];
    g.score          = 0;
    g.lives          = MAX_LIVES;
    g.startTime      = 0;
    g.lastBullet     = 0;
    g.lastStar       = 0;
    g.lastBomb       = 0;
    g.lastFrameTime  = 0;
    g.prevBulletLevel = 0;
    g.shakeAmount    = 0;
    g.hitFlashTimer  = 0;
    g.gameplayEnded  = false;
    g.evolveFlash    = { timer: 0, label: '', hue: 190 };
    g.demoStartTime  = 0;
    g.demoElapsed    = 0;
    g.demoWaypointIdx = 0;
    g.player.x = g.W / 2 - 22;
    g.player.y = g.H - 90;
    setScore(0);
    setLives(MAX_LIVES);
    setElapsed(0);
    setBulletLevel(0);
    setCountdown(3);
    setPhase('countdown');
  }, []);

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
      g.lastFrameTime  = 0;
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

  return (
    <div className="relative w-full h-screen overflow-hidden bg-game-bg select-none">
      <canvas ref={canvasRef} className="absolute inset-0" />

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
