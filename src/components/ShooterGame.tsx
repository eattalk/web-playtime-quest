import { useRef, useEffect, useState, useCallback } from 'react';
import {
  playShoot, playStarCollect, playBombHit, playBombDestroy,
  playCountdown, playCountdownGo, playLevelUp, playGameOver,
} from '@/lib/sfx';

// ── Config (all per-second units) ───────────────────
const GAME_DURATION   = 30_000;
const PLAYER_SPEED    = 360;
const MAX_LIVES       = 2;
const STAR_POINTS     = 10;
const INTRO_DURATION  = 8_000; // ms to show demo before countdown

// ── Types ────────────────────────────────────────────
interface Vec2 { x: number; y: number; }
interface Bullet extends Vec2 { w: number; h: number; level: number; hue: number; trail: Vec2[]; }
interface FallingObj extends Vec2 {
  type: 'star' | 'bomb';
  size: number;
  speed: number;
  rotation: number;
  vx: number;
  sineAmp: number;
  sineFreq: number;
  originX: number;
  age: number;
}
interface Particle extends Vec2 { vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface BgStar extends Vec2 { size: number; brightness: number; speed: number; }

type GamePhase = 'intro' | 'countdown' | 'playing' | 'waiting' | 'done';

interface ShooterGameProps {
  gameType: string;
  tableName: string;
  maxTime?: number;
  onGameEnd: (score: number) => void;
}

const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const hsl = (h: number, s: number, l: number, a = 1) =>
  a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`;

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

// ── AI demo pilot: returns target position for auto-play ──
function getDemoTarget(
  objects: FallingObj[],
  playerX: number, playerY: number,
  w: number, h: number,
  t: number // seconds
): { x: number; y: number } {
  // Default: smooth sine wave patrol
  const baseX = w * 0.5 + Math.sin(t * 0.9) * w * 0.35;
  const baseY  = h * 0.7 + Math.sin(t * 0.6) * h * 0.12;

  // Flee nearest bomb within threat radius
  let fleeX = 0, fleeY = 0, fleeCount = 0;
  const THREAT = 180;
  for (const obj of objects) {
    if (obj.type !== 'bomb') continue;
    const dx = playerX - obj.x;
    const dy = playerY - obj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < THREAT && dist > 0) {
      const strength = (THREAT - dist) / THREAT;
      fleeX += (dx / dist) * strength * 220;
      fleeY += (dy / dist) * strength * 220;
      fleeCount++;
    }
  }

  // Seek nearest star
  let seekX = 0, seekY = 0;
  let bestDist = Infinity;
  for (const obj of objects) {
    if (obj.type !== 'star') continue;
    const dx = obj.x - playerX;
    const dy = obj.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) { bestDist = dist; seekX = obj.x; seekY = obj.y; }
  }

  let tx = baseX, ty = baseY;
  if (bestDist < 300) { tx = seekX; ty = seekY; }
  if (fleeCount > 0)  { tx += fleeX; ty += fleeY; }

  return {
    x: Math.max(40, Math.min(w - 40, tx)),
    y: Math.max(h * 0.25, Math.min(h - 80, ty)),
  };
}

export default function ShooterGame({ maxTime = 45, onGameEnd }: ShooterGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
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
    startTime: 0,
    lastBullet: 0,
    lastStar:   0,
    lastBomb:   0,
    keys: new Set<string>(),
    touchX: null as number | null,
    touchY: null as number | null,
    phase: 'intro' as GamePhase,
    maxTimeMs: maxTime * 1000,
    gameplayEnded: false,
    W: 0,
    H: 0,
    prevBulletLevel: 0,
    shakeAmount: 0,
    hitFlashTimer: 0,
    lastFrameTime: 0,
    // intro-specific
    introStartTime: 0,
    introDemoLevel: 3, // show a mid-level demo (lv4 Solar bullets)
    introLastBullet: 0,
    introLastStar:   0,
    introLastBomb:   0,
    introScore: 0,
  });

  const initBgStars = useCallback((w: number, h: number) => {
    const stars: BgStar[] = [];
    for (let i = 0; i < 120; i++) {
      stars.push({ x: rand(0, w), y: rand(0, h), size: rand(0.5, 2.5), brightness: rand(0.2, 1), speed: rand(18, 72) });
    }
    gs.current.bgStars = stars;
  }, []);

  const spawnParticles = useCallback((x: number, y: number, color: string, count: number) => {
    const g = gs.current;
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const spd   = rand(60, 300);
      g.particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, life: rand(0.35, 0.85), maxLife: 0.85, color, size: rand(1, 4) });
    }
  }, []);

  // ── Drawing helpers ──────────────────────────────
  const drawBgStars = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => {
    gs.current.bgStars.forEach(s => {
      s.y += s.speed * dt;
      if (s.y > h) { s.y = 0; s.x = rand(0, w); }
      const twinkle = 0.5 + Math.sin(t * 0.003 + s.x) * 0.5;
      ctx.fillStyle = hsl(200, 100, 95, s.brightness * 0.5 * twinkle);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
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
      ctx.beginPath(); ctx.arc(0, 0, fieldSize, 0, Math.PI * 2); ctx.fill();
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
    ctx.lineTo(-w * 0.45, h * 0.35); ctx.lineTo(-w * 0.2, h * 0.25);
    ctx.lineTo(0, h * 0.4);
    ctx.lineTo(w * 0.2, h * 0.25); ctx.lineTo(w * 0.45, h * 0.35);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = hsl(shipHue, 100, 70, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w * 0.15, 0); ctx.lineTo(-w * 0.4, h * 0.3);
    ctx.moveTo(w * 0.15, 0);  ctx.lineTo(w * 0.4, h * 0.3);
    ctx.stroke();

    const cockpitGrad = ctx.createRadialGradient(0, -h * 0.08, 0, 0, -h * 0.08, w * 0.15);
    cockpitGrad.addColorStop(0, hsl(shipHue, 100, 95, 0.9));
    cockpitGrad.addColorStop(1, hsl(shipHue, 100, 60, 0.5));
    ctx.fillStyle = cockpitGrad;
    ctx.beginPath(); ctx.ellipse(0, -h * 0.08, w * 0.12, h * 0.14, 0, 0, Math.PI * 2); ctx.fill();

    if (level >= 1) {
      for (let i = 0; i < Math.min(level, 5); i++) {
        const lx = (i - (Math.min(level, 5) - 1) / 2) * 6;
        ctx.fillStyle = hsl(shipHue + i * 30, 100, 70, 0.7 + Math.sin(t * 0.01 + i) * 0.3);
        ctx.beginPath(); ctx.arc(lx, h * 0.15, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }, []);

  const drawStar = useCallback((ctx: CanvasRenderingContext2D, obj: FallingObj, t: number) => {
    ctx.save(); ctx.translate(obj.x, obj.y); ctx.rotate(obj.rotation + t * 0.003);
    const s = obj.size;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2);
    glow.addColorStop(0, hsl(45, 100, 70, 0.5)); glow.addColorStop(1, hsl(45, 100, 70, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, s * 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hsl(45, 100, 65);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s : s * 0.45;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }, []);

  const drawBomb = useCallback((ctx: CanvasRenderingContext2D, obj: FallingObj, t: number) => {
    ctx.save(); ctx.translate(obj.x, obj.y);
    const s = obj.size;
    const pulse = 1 + Math.sin(t * 0.012) * 0.12;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.2 * pulse);
    glow.addColorStop(0, hsl(0, 85, 55, 0.35)); glow.addColorStop(1, hsl(0, 85, 55, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, s * 2.2 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hsl(0, 10, 12); ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hsl(0, 85, 60, 0.8); ctx.beginPath();
    ctx.arc(-s * 0.25, -s * 0.15, s * 0.18, 0, Math.PI * 2);
    ctx.arc(s * 0.25, -s * 0.15, s * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hsl(0, 85, 60, 0.6);
    ctx.fillRect(-s * 0.2, s * 0.15, s * 0.4, s * 0.08);
    ctx.strokeStyle = hsl(30, 50, 40); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.3, -s - 6, 0, -s - 10); ctx.stroke();
    const sparkSize = 3 + Math.sin(t * 0.02) * 2;
    ctx.fillStyle = hsl(40 + Math.sin(t * 0.05) * 30, 100, 75);
    ctx.beginPath(); ctx.arc(0, -s - 10, sparkSize, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }, []);

  const drawBullet = useCallback((ctx: CanvasRenderingContext2D, b: Bullet, t: number) => {
    ctx.save(); ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    const cfg = getBulletConfig(b.level);
    if (b.trail.length > 1 && b.level >= 1) {
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < b.trail.length - 1; i++) {
        const alpha = i / b.trail.length;
        ctx.fillStyle = hsl(cfg.color, 100, 70, alpha * 0.4);
        const tx = b.trail[i].x - (b.x + b.w / 2);
        const ty = b.trail[i].y - (b.y + b.h / 2);
        ctx.beginPath(); ctx.arc(tx, ty, (b.w * alpha * 0.8) / 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const glowSize = (b.w + b.level * 3) * (1 + Math.sin(t * 0.015 + b.y * 0.1) * 0.3);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
    glow.addColorStop(0, hsl(cfg.color, 100, 80, 0.5 + b.level * 0.05));
    glow.addColorStop(0.5, hsl(cfg.color + 30, 100, 60, 0.15));
    glow.addColorStop(1, hsl(cfg.color, 100, 50, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, glowSize, 0, Math.PI * 2); ctx.fill();
    const coreGrad = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
    coreGrad.addColorStop(0, hsl(cfg.color, 100, 95));
    coreGrad.addColorStop(0.5, hsl(cfg.color, 100, 70));
    coreGrad.addColorStop(1, hsl(cfg.color + 20, 100, 50));
    ctx.fillStyle = coreGrad;
    ctx.beginPath(); ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, b.w / 2); ctx.fill();
    if (b.level >= 3) {
      ctx.fillStyle = hsl(cfg.color, 50, 95, 0.8);
      ctx.beginPath(); ctx.roundRect(-b.w * 0.2, -b.h * 0.4, b.w * 0.4, b.h * 0.8, b.w * 0.2); ctx.fill();
    }
    ctx.restore();
  }, []);

  const drawHUD = useCallback((ctx: CanvasRenderingContext2D, w: number, score: number, lives: number, elapsedMs: number, bLevel: number) => {
    const pad = 15;
    const totalSec = Math.floor(elapsedMs / 1000);
    const timeStr = `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`;
    ctx.font = '700 22px Orbitron, monospace'; ctx.textAlign = 'center';
    const tw = ctx.measureText(timeStr).width + 30;
    ctx.fillStyle = hsl(230, 30, 6, 0.5);
    ctx.beginPath(); ctx.roundRect(w / 2 - tw / 2, pad - 4, tw, 32, 8); ctx.fill();
    ctx.fillStyle = hsl(190, 100, 80, 0.9);
    ctx.fillText(timeStr, w / 2, pad + 20);
    ctx.font = '600 18px Orbitron, monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = hsl(45, 100, 70);
    ctx.fillText(`★ ${score}`, pad, pad + 18);
    ctx.textAlign = 'right';
    const heartSize = 28, heartPad = 8, heartsStartX = w - pad, heartsY = pad + 16;
    for (let i = 0; i < MAX_LIVES; i++) {
      const hx = heartsStartX - (MAX_LIVES - 1 - i) * (heartSize + heartPad);
      const alive = i < lives;
      if (alive) {
        const glow = ctx.createRadialGradient(hx, heartsY, 0, hx, heartsY, heartSize);
        glow.addColorStop(0, hsl(0, 100, 60, 0.4)); glow.addColorStop(1, hsl(0, 100, 60, 0));
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hx, heartsY, heartSize, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save(); ctx.translate(hx, heartsY);
      const hs = heartSize * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, hs * 0.4);
      ctx.bezierCurveTo(-hs, -hs * 0.2, -hs, -hs * 0.9, 0, -hs * 0.5);
      ctx.bezierCurveTo(hs, -hs * 0.9, hs, -hs * 0.2, 0, hs * 0.4);
      ctx.closePath();
      if (alive) {
        const hGrad = ctx.createLinearGradient(0, -hs, 0, hs);
        hGrad.addColorStop(0, hsl(350, 100, 65)); hGrad.addColorStop(1, hsl(0, 100, 45));
        ctx.fillStyle = hGrad;
      } else { ctx.fillStyle = hsl(0, 0, 25, 0.6); }
      ctx.fill();
      if (alive) { ctx.strokeStyle = hsl(0, 100, 80, 0.6); ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore();
    }
    if (bLevel > 0) {
      const cfg = getBulletConfig(bLevel);
      ctx.font = '500 12px Orbitron, monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = hsl(cfg.color, 100, 70, 0.8);
      ctx.fillText(`⚡ ${cfg.name.toUpperCase()} LV.${bLevel + 1}`, w / 2, pad + 48);
    }
  }, []);

  // ── Main Game Loop ───────────────────────────────────
  const gameLoop = useCallback((ctx: CanvasRenderingContext2D, timestamp: number) => {
    const g = gs.current;
    const { W: w, H: h } = g;

    const dtMs = g.lastFrameTime === 0 ? 16.67 : Math.min(timestamp - g.lastFrameTime, 33);
    g.lastFrameTime = timestamp;
    const dt = dtMs / 1000;

    ctx.save();
    if (g.shakeAmount > 0.5) {
      ctx.translate((Math.random() - 0.5) * g.shakeAmount * 2, (Math.random() - 0.5) * g.shakeAmount * 2);
      g.shakeAmount *= Math.pow(0.9, dt * 60);
    } else { g.shakeAmount = 0; }

    ctx.fillStyle = hsl(225, 25, 12);
    ctx.fillRect(0, 0, w, h);
    drawBgStars(ctx, w, h, timestamp, dt);

    // ════════════════════════════════════════
    //  INTRO DEMO MODE
    // ════════════════════════════════════════
    if (g.phase === 'intro') {
      const introElapsed = timestamp - g.introStartTime;
      const introSec     = introElapsed / 1000;
      const demoLevel    = g.introDemoLevel;

      // Spawn objects for demo
      const starInterval = 0.18;
      if (introSec - g.introLastStar > starInterval) {
        g.objects.push({ x: rand(20, w - 20), y: -20, type: 'star', size: rand(10, 16), speed: rand(100, 180), rotation: rand(0, Math.PI * 2), vx: 0, sineAmp: 0, sineFreq: 0, originX: 0, age: 0 });
        g.introLastStar = introSec;
      }
      const bombInterval = 0.10;
      if (introSec - g.introLastBomb > bombInterval) {
        const bx = rand(20, w - 20);
        const pattern = Math.random();
        let vx = 0, sineAmp = 0, sineFreq = 0;
        if (pattern < 0.35) { vx = rand(-120, 120); }
        else if (pattern < 0.7) { sineAmp = rand(30, 70); sineFreq = rand(1.2, 2.8); }
        else { vx = rand(-80, 80); sineAmp = rand(20, 40); sineFreq = rand(1.5, 2.5); }
        g.objects.push({ x: bx, y: -20, type: 'bomb', size: rand(12, 18), speed: rand(130, 220), rotation: 0, vx, sineAmp, sineFreq, originX: bx, age: 0 });
        g.introLastBomb = introSec;
      }

      // AI pilot movement
      const target = getDemoTarget(g.objects, g.player.x + g.player.w / 2, g.player.y + g.player.h / 2, w, h, introSec);
      const lerpF = 1 - Math.pow(0.85, dt * 60);
      g.player.x += (target.x - g.player.x - g.player.w / 2) * lerpF;
      g.player.y += (target.y - g.player.y - g.player.h / 2) * lerpF;
      g.player.x = Math.max(0, Math.min(w - g.player.w, g.player.x));
      g.player.y = Math.max(h * 0.2, Math.min(h - g.player.h - 10, g.player.y));

      // Auto-fire in demo
      const cfg = getBulletConfig(demoLevel);
      if (introSec - g.introLastBullet > cfg.interval) {
        const bulletCount = 3;
        const spread = 18;
        for (let i = 0; i < bulletCount; i++) {
          const offsetX = (i - 1) * spread;
          g.bullets.push({ x: g.player.x + g.player.w / 2 - cfg.w / 2 + offsetX, y: g.player.y - cfg.h, w: cfg.w, h: cfg.h, level: demoLevel, hue: cfg.color, trail: [] });
        }
        g.introLastBullet = introSec;
      }

      // Update bullets
      g.bullets = g.bullets.filter(b => { const c = getBulletConfig(b.level); b.trail.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 }); if (b.trail.length > 8) b.trail.shift(); b.y -= c.speed * dt; return b.y + b.h > 0; });

      // Update objects (no player damage in demo, but collect stars visually)
      const pcx = g.player.x + g.player.w / 2, pcy = g.player.y + g.player.h / 2, pr = g.player.w * 0.38;
      g.objects = g.objects.filter(obj => {
        obj.age += dt; obj.y += obj.speed * dt;
        if (obj.vx)      obj.x += obj.vx * dt;
        if (obj.sineAmp) obj.x = obj.originX + Math.sin(obj.age * obj.sineFreq * Math.PI * 2) * obj.sineAmp;
        if (obj.x < 10) obj.x = 10; if (obj.x > w - 10) obj.x = w - 10;
        if (obj.y > h + 30) return false;
        const dx = obj.x - pcx, dy = obj.y - pcy;
        if (Math.sqrt(dx * dx + dy * dy) < pr + obj.size) {
          if (obj.type === 'star') { g.introScore += STAR_POINTS; spawnParticles(obj.x, obj.y, hsl(45, 100, 70), 10); }
          else { spawnParticles(obj.x, obj.y, hsl(0, 85, 55), 15); } // no life loss
          return false;
        }
        if (obj.type === 'bomb') {
          for (let i = g.bullets.length - 1; i >= 0; i--) {
            const b = g.bullets[i]; const bx = b.x + b.w / 2, by = b.y + b.h / 2;
            if (Math.sqrt((obj.x - bx) ** 2 + (obj.y - by) ** 2) < obj.size + b.w) { spawnParticles(obj.x, obj.y, hsl(30, 100, 60), 12); g.bullets.splice(i, 1); return false; }
          }
        }
        return true;
      });

      // Update particles
      g.particles = g.particles.filter(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.98, dt * 60); p.vy *= Math.pow(0.98, dt * 60); p.life -= dt; return p.life > 0; });

      // Draw
      g.bullets.forEach(b => drawBullet(ctx, b, timestamp));
      g.objects.forEach(obj => obj.type === 'star' ? drawStar(ctx, obj, timestamp) : drawBomb(ctx, obj, timestamp));
      g.particles.forEach(p => { const alpha = p.life / p.maxLife; ctx.globalAlpha = alpha; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2); ctx.fill(); });
      ctx.globalAlpha = 1;
      drawShip(ctx, g.player.x, g.player.y, g.player.w, g.player.h, timestamp, demoLevel);

      ctx.restore();
      return;
    }

    // ════════════════════════════════════════
    //  GAMEPLAY MODE
    // ════════════════════════════════════════
    if (g.phase !== 'playing') { ctx.restore(); return; }

    const elapsedMs = timestamp - g.startTime;
    const elapsedSec = elapsedMs / 1000;
    // ── FIX: stop leveling up once gameplay has ended ──
    const bLevel = g.gameplayEnded ? g.prevBulletLevel : Math.min(Math.floor(elapsedMs / 4_000), 7);
    const gameplayActive = elapsedMs < GAME_DURATION && g.lives > 0 && !g.gameplayEnded;

    if (!g.gameplayEnded && bLevel > g.prevBulletLevel && bLevel <= 7) {
      g.prevBulletLevel = bLevel;
      setBulletLevel(bLevel);
      playLevelUp();
      for (let i = 0; i < 30; i++) spawnParticles(rand(0, w), rand(0, h), hsl(getBulletConfig(bLevel).color, 100, 70), 3);
    }

    setElapsed(elapsedMs);
    const difficultyMult = 1 + (elapsedMs / GAME_DURATION) * 2.0;

    if (gameplayActive) {
      const spd = PLAYER_SPEED * dt;
      if (g.keys.has('ArrowLeft') || g.keys.has('a')) g.player.x -= spd;
      if (g.keys.has('ArrowRight') || g.keys.has('d')) g.player.x += spd;
      if (g.keys.has('ArrowUp') || g.keys.has('w')) g.player.y -= spd;
      if (g.keys.has('ArrowDown') || g.keys.has('s')) g.player.y += spd;
      if (g.touchX !== null && g.touchY !== null) {
        const lerpFactor = 1 - Math.pow(0.88, dt * 60);
        g.player.x += (g.touchX - (g.player.x + g.player.w / 2)) * lerpFactor;
        g.player.y += (g.touchY - (g.player.y + g.player.h / 2)) * lerpFactor;
      }
      g.player.x = Math.max(0, Math.min(w - g.player.w, g.player.x));
      g.player.y = Math.max(h * 0.2, Math.min(h - g.player.h - 10, g.player.y));

      const cfg = getBulletConfig(bLevel);
      if (elapsedSec - g.lastBullet > cfg.interval) {
        const bulletCount = bLevel >= 5 ? 4 : bLevel >= 3 ? 3 : bLevel >= 1 ? 2 : 1;
        const spread = bLevel >= 1 ? 14 + bLevel * 2 : 0;
        for (let i = 0; i < bulletCount; i++) {
          const offsetX = bulletCount === 1 ? 0 : (i - (bulletCount - 1) / 2) * spread;
          g.bullets.push({ x: g.player.x + g.player.w / 2 - cfg.w / 2 + offsetX, y: g.player.y - cfg.h, w: cfg.w, h: cfg.h, level: bLevel, hue: cfg.color, trail: [] });
        }
        g.lastBullet = elapsedSec;
        playShoot(bLevel);
      }

      const starInterval = Math.max(0.07, 0.25 - elapsedMs * 0.000003);
      if (elapsedSec - g.lastStar > starInterval) {
        g.objects.push({ x: rand(20, w - 20), y: -20, type: 'star', size: rand(10, 16), speed: rand(120, 240) * difficultyMult, rotation: rand(0, Math.PI * 2), vx: 0, sineAmp: 0, sineFreq: 0, originX: 0, age: 0 });
        g.lastStar = elapsedSec;
      }

      const bombInterval = Math.max(0.025, 0.12 - elapsedMs * 0.000003);
      if (elapsedSec - g.lastBomb > bombInterval) {
        const bx = rand(20, w - 20);
        const pattern = Math.random();
        let vx = 0, sineAmp = 0, sineFreq = 0;
        if (pattern < 0.3) { vx = rand(-150, 150); }
        else if (pattern < 0.6) { sineAmp = rand(30, 80); sineFreq = rand(1.2, 3.6); }
        else if (pattern < 0.8) { vx = rand(-90, 90); sineAmp = rand(15, 40); sineFreq = rand(1.8, 3.0); }
        g.objects.push({ x: bx, y: -20, type: 'bomb', size: rand(12, 18), speed: rand(120, 270) * difficultyMult, rotation: 0, vx, sineAmp, sineFreq, originX: bx, age: 0 });
        g.lastBomb = elapsedSec;
      }
    }

    g.bullets = g.bullets.filter(b => { const c = getBulletConfig(b.level); b.trail.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 }); if (b.trail.length > 8) b.trail.shift(); b.y -= c.speed * dt; return b.y + b.h > 0; });

    const pcx = g.player.x + g.player.w / 2, pcy = g.player.y + g.player.h / 2, pr = g.player.w * 0.38;
    g.objects = g.objects.filter(obj => {
      obj.age += dt; obj.y += obj.speed * dt;
      if (obj.vx)      obj.x += obj.vx * dt;
      if (obj.sineAmp) obj.x = obj.originX + Math.sin(obj.age * obj.sineFreq * Math.PI * 2) * obj.sineAmp;
      if (obj.x < 10) { obj.x = 10; obj.vx = Math.abs(obj.vx || 0); }
      if (obj.x > w - 10) { obj.x = w - 10; obj.vx = -Math.abs(obj.vx || 0); }
      if (obj.y > h + 30) return false;

      if (gameplayActive) {
        const dx = obj.x - pcx, dy = obj.y - pcy;
        if (Math.sqrt(dx * dx + dy * dy) < pr + obj.size) {
          if (obj.type === 'star') { g.score += STAR_POINTS; setScore(g.score); spawnParticles(obj.x, obj.y, hsl(45, 100, 70), 15); playStarCollect(); }
          else { g.lives--; setLives(g.lives); spawnParticles(obj.x, obj.y, hsl(0, 85, 55), 40); playBombHit(); g.shakeAmount = 18; g.hitFlashTimer = 0.25; if (g.lives <= 0) g.gameplayEnded = true; }
          return false;
        }
      }
      if (obj.type === 'bomb') {
        for (let i = g.bullets.length - 1; i >= 0; i--) {
          const b = g.bullets[i], bx = b.x + b.w / 2, by = b.y + b.h / 2;
          if (Math.sqrt((obj.x - bx) ** 2 + (obj.y - by) ** 2) < obj.size + b.w) { g.score += 5; setScore(g.score); spawnParticles(obj.x, obj.y, hsl(30, 100, 60), 12); playBombDestroy(); g.bullets.splice(i, 1); return false; }
        }
      }
      return true;
    });

    g.particles = g.particles.filter(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.98, dt * 60); p.vy *= Math.pow(0.98, dt * 60); p.life -= dt; return p.life > 0; });

    g.bullets.forEach(b => drawBullet(ctx, b, timestamp));
    g.objects.forEach(obj => obj.type === 'star' ? drawStar(ctx, obj, timestamp) : drawBomb(ctx, obj, timestamp));
    g.particles.forEach(p => { const alpha = p.life / p.maxLife; ctx.globalAlpha = alpha; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;

    if (g.lives > 0) drawShip(ctx, g.player.x, g.player.y, g.player.w, g.player.h, timestamp, bLevel);

    if (g.hitFlashTimer > 0) {
      const flashAlpha = (g.hitFlashTimer / 0.25) * 0.4;
      const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8);
      vignette.addColorStop(0, hsl(0, 100, 50, 0)); vignette.addColorStop(1, hsl(0, 100, 30, flashAlpha));
      ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = hsl(0, 100, 50, flashAlpha * 1.5); ctx.lineWidth = 6; ctx.strokeRect(0, 0, w, h);
      g.hitFlashTimer = Math.max(0, g.hitFlashTimer - dt);
    }

    drawHUD(ctx, w, g.score, g.lives, elapsedMs, bLevel);

    if (!g.gameplayEnded && (elapsedMs >= GAME_DURATION || g.lives <= 0)) {
      g.gameplayEnded = true;
      playGameOver();
      if (g.lives <= 0) { setPhase('done'); g.phase = 'done'; onGameEnd(g.score); ctx.restore(); return; }
      setPhase('waiting'); g.phase = 'waiting';
    }
    if (elapsedMs >= g.maxTimeMs) { setPhase('done'); g.phase = 'done'; onGameEnd(g.score); }

    ctx.restore();
  }, [drawBgStars, drawBullet, drawBomb, drawStar, drawShip, drawHUD, spawnParticles, onGameEnd]);

  // ── Canvas & input setup ─────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth; canvas.height = window.innerHeight;
      gs.current.W = canvas.width; gs.current.H = canvas.height;
      gs.current.player.x = canvas.width / 2 - 22;
      gs.current.player.y = canvas.height - 90;
      if (gs.current.bgStars.length === 0) initBgStars(canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    // Init intro
    gs.current.introStartTime = performance.now();
    gs.current.lastFrameTime  = 0;

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

    let rafId = 0;
    const loop = (ts: number) => { gameLoop(ctx, ts); rafId = requestAnimationFrame(loop); };
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

  // ── Intro → countdown auto-transition ───────────────
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => {
      // Clean up intro objects/bullets before countdown
      gs.current.bullets = [];
      gs.current.objects = [];
      gs.current.particles = [];
      gs.current.phase = 'countdown';
      setPhase('countdown');
      setCountdown(3);
    }, INTRO_DURATION);
    return () => clearTimeout(t);
  }, [phase]);

  // ── Countdown ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      const now = performance.now();
      const g = gs.current;
      g.phase = 'playing';
      g.startTime = now;
      g.lastBullet = 0; g.lastStar = 0; g.lastBomb = 0;
      g.lastFrameTime = 0;
      g.prevBulletLevel = 0;
      g.score = 0; g.lives = MAX_LIVES; g.gameplayEnded = false;
      setScore(0); setLives(MAX_LIVES); setBulletLevel(0);
      setPhase('playing');
      playCountdownGo();
      return;
    }
    playCountdown();
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // ── Waiting → done ───────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting') return;
    const g = gs.current;
    const remaining = g.maxTimeMs - (performance.now() - g.startTime);
    if (remaining <= 0) { setPhase('done'); g.phase = 'done'; onGameEnd(g.score); return; }
    const t = setTimeout(() => { setPhase('done'); g.phase = 'done'; onGameEnd(g.score); }, remaining);
    return () => clearTimeout(t);
  }, [phase, onGameEnd]);

  const startGame = () => {
    gs.current.bullets = []; gs.current.objects = []; gs.current.particles = [];
    gs.current.phase = 'countdown';
    setPhase('countdown'); setCountdown(3);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-game-bg select-none">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* INTRO DEMO overlay */}
      {phase === 'intro' && (
        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col">
          {/* Top title */}
          <div className="flex flex-col items-center pt-16 gap-2">
            <h1 className="font-game text-4xl md:text-6xl text-primary text-glow animate-pulse-glow"
              style={{ textShadow: '0 0 40px hsl(190 100% 50% / 0.7), 0 0 80px hsl(190 100% 50% / 0.4)' }}>
              SPACE SHOOTER
            </h1>
            <p className="font-game text-sm text-primary/60 tracking-widest uppercase animate-pulse">Demo Preview</p>
          </div>

          {/* Bottom HUD-style tips */}
          <div className="mt-auto mb-10 flex flex-col items-center gap-3">
            <div className="flex gap-6 text-center font-game-body text-base text-foreground/80">
              <span>🚀 <span className="text-primary">WASD</span> / Touch</span>
              <span>⭐ Collect stars</span>
              <span>💣 Avoid bombs</span>
              <span>🔫 Auto-fire</span>
            </div>
            <button
              onClick={startGame}
              className="pointer-events-auto font-game text-xl px-10 py-4 rounded-lg bg-primary text-primary-foreground box-glow hover:brightness-125 transition-all animate-pulse-glow"
              style={{ textShadow: '0 0 10px hsl(190 100% 50% / 0.5)' }}>
              TAP TO PLAY
            </button>
            <p className="font-game text-xs text-muted-foreground/50 animate-pulse">
              Auto-starting in a few seconds…
            </p>
          </div>
        </div>
      )}

      {/* Countdown */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/30">
          <p className="font-game text-lg text-primary/60 mb-2">00:00</p>
          <span className="font-game text-9xl md:text-[12rem] text-primary/80 text-glow animate-pulse"
            style={{ textShadow: '0 0 60px hsl(190 100% 50% / 0.6), 0 0 120px hsl(190 100% 50% / 0.3)' }}>
            {countdown}
          </span>
          <p className="font-game text-lg text-muted-foreground/60 mt-4">GET READY</p>
        </div>
      )}

      {/* Waiting - big score */}
      {phase === 'waiting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/70 backdrop-blur-md">
          <p className="font-game text-4xl md:text-5xl text-destructive mb-6 animate-pulse"
            style={{ textShadow: '0 0 30px hsl(0 100% 50% / 0.6)' }}>GAME OVER</p>
          <p className="font-game text-7xl md:text-9xl text-accent mb-4"
            style={{ textShadow: '0 0 40px hsl(45 100% 50% / 0.5), 0 0 80px hsl(45 100% 50% / 0.3)' }}>{score}</p>
          <p className="font-game text-xl text-accent/70 mb-6">POINTS</p>
          {bulletLevel > 0 && <p className="font-game text-lg text-primary/80 mb-4">⚡ MAX WEAPON: LV.{bulletLevel + 1}</p>}
          <p className="font-game-body text-lg text-muted-foreground animate-pulse">Waiting for other players...</p>
        </div>
      )}
    </div>
  );
}
