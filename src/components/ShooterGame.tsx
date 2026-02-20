import { useRef, useEffect, useState, useCallback } from 'react';
import {
  playShoot, playStarCollect, playBombHit, playBombDestroy,
  playCountdown, playCountdownGo, playLevelUp, playGameOver,
} from '@/lib/sfx';

// ── Config ──────────────────────────────────────────
const GAME_DURATION = 30_000;
const BULLET_INTERVAL = 220;
const PLAYER_SPEED = 6;
const MAX_LIVES = 2;
const STAR_POINTS = 10;

// ── Types ───────────────────────────────────────────
interface Vec2 { x: number; y: number; }
interface Bullet extends Vec2 { w: number; h: number; level: number; hue: number; trail: Vec2[]; }
interface FallingObj extends Vec2 { type: 'star' | 'bomb'; size: number; speed: number; rotation: number; vx: number; sineAmp: number; sineFreq: number; originX: number; age: number; }
interface Particle extends Vec2 { vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface BgStar extends Vec2 { size: number; brightness: number; speed: number; }

type GamePhase = 'instructions' | 'countdown' | 'playing' | 'gameover' | 'waiting' | 'done';

interface ShooterGameProps {
  gameType: string;
  tableName: string;
  maxTime?: number;
  onGameEnd: (score: number) => void;
}

const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const hsl = (h: number, s: number, l: number, a = 1) =>
  a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`;

// Bullet level config (level 0-5 based on 10s increments)
function getBulletConfig(level: number) {
  const configs = [
    { w: 4, h: 12, speed: 7, color: 190, name: 'Basic' },
    { w: 7, h: 18, speed: 8, color: 200, name: 'Enhanced' },
    { w: 10, h: 24, speed: 9, color: 280, name: 'Plasma' },
    { w: 14, h: 30, speed: 10, color: 320, name: 'Nova' },
    { w: 18, h: 36, speed: 11, color: 45, name: 'Solar' },
    { w: 24, h: 42, speed: 12, color: 0, name: 'Inferno' },
  ];
  return configs[Math.min(level, configs.length - 1)];
}

export default function ShooterGame({ maxTime = 45, onGameEnd }: ShooterGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('instructions');
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [elapsed, setElapsed] = useState(0);
  const [bulletLevel, setBulletLevel] = useState(0);

  const gs = useRef({
    player: { x: 0, y: 0, w: 44, h: 44 },
    bullets: [] as Bullet[],
    objects: [] as FallingObj[],
    particles: [] as Particle[],
    bgStars: [] as BgStar[],
    score: 0,
    lives: MAX_LIVES,
    startTime: 0,
    lastBullet: 0,
    lastStar: 0,
    lastBomb: 0,
    keys: new Set<string>(),
    touchX: null as number | null,
    touchY: null as number | null,
    phase: 'instructions' as GamePhase,
    maxTimeMs: maxTime * 1000,
    gameplayEnded: false,
    animFrame: 0,
    W: 0,
    H: 0,
    prevBulletLevel: 0,
    shipHue: 0,
    shakeAmount: 0,
    shakeDecay: 0.9,
  });

  const initBgStars = useCallback((w: number, h: number) => {
    const stars: BgStar[] = [];
    for (let i = 0; i < 120; i++) {
      stars.push({ x: rand(0, w), y: rand(0, h), size: rand(0.5, 2.5), brightness: rand(0.2, 1), speed: rand(0.3, 1.2) });
    }
    gs.current.bgStars = stars;
  }, []);

  const spawnParticles = useCallback((x: number, y: number, color: string, count: number) => {
    const g = gs.current;
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(1, 5);
      g.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(20, 50), maxLife: 50, color, size: rand(1, 4) });
    }
  }, []);

  // ── Drawing ───────────────────────────────────────
  const drawBgStars = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    gs.current.bgStars.forEach(s => {
      s.y += s.speed;
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

    // Outer energy field (increases with level)
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

    // Engine flames (bigger with level)
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

    // Side flames at higher levels
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

    // Ship body
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

    // Wing details
    ctx.strokeStyle = hsl(shipHue, 100, 70, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w * 0.15, 0);
    ctx.lineTo(-w * 0.4, h * 0.3);
    ctx.moveTo(w * 0.15, 0);
    ctx.lineTo(w * 0.4, h * 0.3);
    ctx.stroke();

    // Cockpit
    const cockpitGrad = ctx.createRadialGradient(0, -h * 0.08, 0, 0, -h * 0.08, w * 0.15);
    cockpitGrad.addColorStop(0, hsl(shipHue, 100, 95, 0.9));
    cockpitGrad.addColorStop(1, hsl(shipHue, 100, 60, 0.5));
    ctx.fillStyle = cockpitGrad;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.08, w * 0.12, h * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Level indicator lights
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
    // Glow
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2);
    glow.addColorStop(0, hsl(45, 100, 70, 0.5));
    glow.addColorStop(1, hsl(45, 100, 70, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 2, 0, Math.PI * 2);
    ctx.fill();
    // Star shape
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
    // Danger glow
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.2 * pulse);
    glow.addColorStop(0, hsl(0, 85, 55, 0.35));
    glow.addColorStop(1, hsl(0, 85, 55, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 2.2 * pulse, 0, Math.PI * 2);
    ctx.fill();
    // Body
    ctx.fillStyle = hsl(0, 10, 12);
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fill();
    // Skull face
    ctx.fillStyle = hsl(0, 85, 60, 0.8);
    ctx.beginPath();
    ctx.arc(-s * 0.25, -s * 0.15, s * 0.18, 0, Math.PI * 2);
    ctx.arc(s * 0.25, -s * 0.15, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hsl(0, 85, 60, 0.6);
    ctx.fillRect(-s * 0.2, s * 0.15, s * 0.4, s * 0.08);
    // Fuse
    ctx.strokeStyle = hsl(30, 50, 40);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.3, -s - 6, 0, -s - 10);
    ctx.stroke();
    // Spark
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

    // Trail
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

    // Outer glow (bigger at higher levels)
    const glowSize = (b.w + b.level * 3) * (1 + Math.sin(t * 0.015 + b.y * 0.1) * 0.3);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
    glow.addColorStop(0, hsl(cfg.color, 100, 80, 0.5 + b.level * 0.05));
    glow.addColorStop(0.5, hsl(cfg.color + 30, 100, 60, 0.15));
    glow.addColorStop(1, hsl(cfg.color, 100, 50, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowSize, 0, Math.PI * 2);
    ctx.fill();

    // Core beam
    const coreGrad = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
    coreGrad.addColorStop(0, hsl(cfg.color, 100, 95));
    coreGrad.addColorStop(0.5, hsl(cfg.color, 100, 70));
    coreGrad.addColorStop(1, hsl(cfg.color + 20, 100, 50));
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, b.w / 2);
    ctx.fill();

    // Inner white core at high levels
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

    // Timer - transparent bg
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

    // Score
    ctx.font = '600 18px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = hsl(45, 100, 70);
    ctx.fillText(`★ ${score}`, pad, pad + 18);

    // Lives - BIG hearts on the right
    ctx.textAlign = 'right';
    const heartSize = 28;
    const heartPad = 8;
    const heartsStartX = w - pad;
    const heartsY = pad + 16;
    for (let i = 0; i < MAX_LIVES; i++) {
      const hx = heartsStartX - (MAX_LIVES - 1 - i) * (heartSize + heartPad);
      const alive = i < lives;
      // Heart glow
      if (alive) {
        const glow = ctx.createRadialGradient(hx, heartsY, 0, hx, heartsY, heartSize);
        glow.addColorStop(0, hsl(0, 100, 60, 0.4));
        glow.addColorStop(1, hsl(0, 100, 60, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(hx, heartsY, heartSize, 0, Math.PI * 2);
        ctx.fill();
      }
      // Heart shape
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

    // Bullet level indicator
    if (bLevel > 0) {
      const cfg = getBulletConfig(bLevel);
      ctx.font = '500 12px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = hsl(cfg.color, 100, 70, 0.8);
      ctx.fillText(`⚡ ${cfg.name.toUpperCase()} LV.${bLevel + 1}`, w / 2, pad + 48);
    }
  }, []);

  // ── Main Game Loop ────────────────────────────────
  const gameLoop = useCallback((ctx: CanvasRenderingContext2D, timestamp: number) => {
    const g = gs.current;
    const { W: w, H: h } = g;

    // Screen shake
    ctx.save();
    if (g.shakeAmount > 0.5) {
      const sx = (Math.random() - 0.5) * g.shakeAmount * 2;
      const sy = (Math.random() - 0.5) * g.shakeAmount * 2;
      ctx.translate(sx, sy);
      g.shakeAmount *= g.shakeDecay;
    }

    // Clear - brighter background
    ctx.fillStyle = hsl(225, 25, 12);
    ctx.fillRect(0, 0, w, h);
    drawBgStars(ctx, w, h, timestamp);

    if (g.phase !== 'playing') return;

    const now = timestamp;
    const elapsed = now - g.startTime;
    const bLevel = Math.min(Math.floor(elapsed / 7_000), 5);
    const gameplayActive = elapsed < GAME_DURATION && g.lives > 0;

    // Level up notification
    if (bLevel > g.prevBulletLevel && bLevel <= 5) {
      g.prevBulletLevel = bLevel;
      setBulletLevel(bLevel);
      playLevelUp();
      // Spawn celebratory particles
      for (let i = 0; i < 30; i++) {
        const cfg = getBulletConfig(bLevel);
        spawnParticles(rand(0, w), rand(0, h), hsl(cfg.color, 100, 70), 3);
      }
    }

    setElapsed(elapsed);

    // Difficulty scaling: speed multiplier increases over time
    const difficultyMult = 1 + (elapsed / GAME_DURATION) * 2.0;

    // ── Player movement (all 4 directions) ──
    if (gameplayActive) {
      if (g.keys.has('ArrowLeft') || g.keys.has('a')) g.player.x -= PLAYER_SPEED;
      if (g.keys.has('ArrowRight') || g.keys.has('d')) g.player.x += PLAYER_SPEED;
      if (g.keys.has('ArrowUp') || g.keys.has('w')) g.player.y -= PLAYER_SPEED;
      if (g.keys.has('ArrowDown') || g.keys.has('s')) g.player.y += PLAYER_SPEED;

      if (g.touchX !== null && g.touchY !== null) {
        const dx = g.touchX - (g.player.x + g.player.w / 2);
        const dy = g.touchY - (g.player.y + g.player.h / 2);
        g.player.x += dx * 0.12;
        g.player.y += dy * 0.12;
      }

      g.player.x = Math.max(0, Math.min(w - g.player.w, g.player.x));
      g.player.y = Math.max(h * 0.2, Math.min(h - g.player.h - 10, g.player.y));

      // Auto-fire
      if (now - g.lastBullet > BULLET_INTERVAL) {
        const cfg = getBulletConfig(bLevel);
        // Multiple bullets at higher levels
        const bulletCount = bLevel >= 4 ? 3 : bLevel >= 2 ? 2 : 1;
        const spread = bLevel >= 2 ? 12 : 0;

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
        g.lastBullet = now;
        playShoot(bLevel);
      }

      // Spawn stars
      const starInterval = Math.max(120, 250 - elapsed * 0.003);
      if (now - g.lastStar > starInterval) {
        g.objects.push({
          x: rand(20, w - 20), y: -20, type: 'star',
          size: rand(10, 16),
          speed: rand(2, 4) * difficultyMult,
          rotation: rand(0, Math.PI * 2),
          vx: 0, sineAmp: 0, sineFreq: 0, originX: 0, age: 0,
        });
        g.lastStar = now;
      }

      // Spawn bombs — 4x rate, varied trajectories, progressive speed
      const bombInterval = Math.max(40, 120 - elapsed * 0.003);
      if (now - g.lastBomb > bombInterval) {
        const bx = rand(20, w - 20);
        const pattern = Math.random();
        let vx = 0, sineAmp = 0, sineFreq = 0;
        if (pattern < 0.3) {
          vx = rand(-2.5, 2.5);
        } else if (pattern < 0.6) {
          sineAmp = rand(30, 80);
          sineFreq = rand(0.02, 0.06);
        } else if (pattern < 0.8) {
          vx = rand(-1.5, 1.5);
          sineAmp = rand(15, 40);
          sineFreq = rand(0.03, 0.05);
        }
        g.objects.push({
          x: bx, y: -20, type: 'bomb',
          size: rand(12, 18),
          speed: rand(2, 4.5) * difficultyMult,
          rotation: 0,
          vx, sineAmp, sineFreq, originX: bx, age: 0,
        });
        g.lastBomb = now;
      }
    }

    // Update bullets
    g.bullets = g.bullets.filter(b => {
      const cfg = getBulletConfig(b.level);
      // Store trail
      b.trail.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      if (b.trail.length > 8) b.trail.shift();
      b.y -= cfg.speed;
      return b.y + b.h > 0;
    });

    // Update objects & collision
    const pcx = g.player.x + g.player.w / 2;
    const pcy = g.player.y + g.player.h / 2;
    const pr = g.player.w * 0.38;

    g.objects = g.objects.filter(obj => {
      obj.age++;
      obj.y += obj.speed;
      // Varied horizontal movement for bombs
      if (obj.vx) obj.x += obj.vx;
      if (obj.sineAmp) obj.x = obj.originX + Math.sin(obj.age * obj.sineFreq) * obj.sineAmp;
      // Keep in bounds
      if (obj.x < 10) { obj.x = 10; obj.vx = Math.abs(obj.vx || 0); }
      if (obj.x > w - 10) { obj.x = w - 10; obj.vx = -(Math.abs(obj.vx || 0)); }
      if (obj.y > h + 30) return false;

      if (gameplayActive) {
        const dx = obj.x - pcx;
        const dy = obj.y - pcy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < pr + obj.size) {
          if (obj.type === 'star') {
            g.score += STAR_POINTS;
            setScore(g.score);
            spawnParticles(obj.x, obj.y, hsl(45, 100, 70), 15);
            playStarCollect();
          } else {
            g.lives--;
            setLives(g.lives);
            spawnParticles(obj.x, obj.y, hsl(0, 85, 55), 25);
            playBombHit();
            g.shakeAmount = 12; // screen shake on hit!
            if (g.lives <= 0) g.gameplayEnded = true;
          }
          return false;
        }
      }

      // Bullet-bomb collision
      if (obj.type === 'bomb') {
        for (let i = g.bullets.length - 1; i >= 0; i--) {
          const b = g.bullets[i];
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

    // Update particles
    g.particles = g.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life--;
      return p.life > 0;
    });

    // ── Draw everything ─────────────────────
    g.bullets.forEach(b => drawBullet(ctx, b, now));
    g.objects.forEach(obj => obj.type === 'star' ? drawStar(ctx, obj, now) : drawBomb(ctx, obj, now));

    // Particles
    g.particles.forEach(p => {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Player
    if (g.lives > 0) drawShip(ctx, g.player.x, g.player.y, g.player.w, g.player.h, now, bLevel);

    // HUD
    drawHUD(ctx, w, g.score, g.lives, elapsed, bLevel);

    // Check transitions
    if (!g.gameplayEnded && (elapsed >= GAME_DURATION || g.lives <= 0)) {
      g.gameplayEnded = true;
      setPhase('waiting');
      g.phase = 'waiting';
      playGameOver();
    }

    if (elapsed >= g.maxTimeMs) {
      setPhase('done');
      g.phase = 'done';
      onGameEnd(g.score);
    }

    ctx.restore(); // end screen shake
  }, [drawBgStars, drawBullet, drawBomb, drawStar, drawShip, drawHUD, spawnParticles, onGameEnd]);

  // ── Canvas & input setup ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gs.current.W = canvas.width;
      gs.current.H = canvas.height;
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

    let running = true;
    const loop = (ts: number) => { if (!running) return; gameLoop(ctx, ts); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);

    return () => {
      running = false;
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
      setPhase('playing');
      gs.current.phase = 'playing';
      gs.current.startTime = performance.now();
      gs.current.lastBullet = performance.now();
      gs.current.lastStar = performance.now();
      gs.current.lastBomb = performance.now();
      gs.current.prevBulletLevel = 0;
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
            <p>🔫 Auto-fire — bullets <span className="text-secondary">evolve every 7s!</span></p>
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

      {/* Countdown — transparent with timer visible */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/30">
          <p className="font-game text-lg text-primary/60 mb-2">00:00</p>
          <span className="font-game text-9xl md:text-[12rem] text-primary/80 text-glow animate-pulse" style={{ textShadow: '0 0 60px hsl(190 100% 50% / 0.6), 0 0 120px hsl(190 100% 50% / 0.3)' }}>
            {countdown}
          </span>
          <p className="font-game text-lg text-muted-foreground/60 mt-4">GET READY</p>
        </div>
      )}

      {/* Waiting */}
      {phase === 'waiting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/60 backdrop-blur-sm">
          <p className="font-game text-3xl text-primary text-glow mb-4">GAME OVER</p>
          <p className="font-game text-5xl text-accent text-glow-accent mb-6">★ {score}</p>
          {bulletLevel > 0 && (
            <p className="font-game-body text-sm text-muted-foreground mb-2">Max Weapon: LV.{bulletLevel + 1}</p>
          )}
          <p className="font-game-body text-lg text-muted-foreground animate-pulse">
            Waiting for other players...
          </p>
        </div>
      )}
    </div>
  );
}
