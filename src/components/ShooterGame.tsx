import { useRef, useEffect, useState, useCallback } from 'react';

// ── Game Configuration ──────────────────────────────
const GAME_DURATION = 30_000; // 30 seconds of gameplay
const BULLET_INTERVAL = 250;
const BULLET_SPEED = 7;
const BULLET_ENHANCED_SPEED = 9;
const STAR_SPEED_MIN = 2;
const STAR_SPEED_MAX = 4;
const BOMB_SPEED_MIN = 1.5;
const BOMB_SPEED_MAX = 3.5;
const PLAYER_SPEED = 6;
const SPAWN_INTERVAL_STAR = 600;
const SPAWN_INTERVAL_BOMB = 1200;
const MAX_LIVES = 3;
const BULLET_ENHANCE_TIME = 10_000; // 10 seconds
const STAR_POINTS = 10;

// ── Types ───────────────────────────────────────────
interface Vec2 { x: number; y: number; }
interface Bullet extends Vec2 { w: number; h: number; enhanced: boolean; }
interface FallingObj extends Vec2 { type: 'star' | 'bomb'; size: number; speed: number; rotation: number; }
interface Particle extends Vec2 { vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface BgStar extends Vec2 { size: number; brightness: number; speed: number; }

type GamePhase = 'instructions' | 'countdown' | 'playing' | 'gameover' | 'waiting' | 'done';

interface ShooterGameProps {
  gameType: string;
  tableName: string;
  maxTime?: number; // in seconds, default 45
  onGameEnd: (score: number) => void;
}

// ── Helper ──────────────────────────────────────────
const rand = (min: number, max: number) => Math.random() * (max - min) + min;

const hslStr = (h: number, s: number, l: number, a = 1) =>
  a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`;

export default function ShooterGame({ maxTime = 45, onGameEnd }: ShooterGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('instructions');
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [elapsed, setElapsed] = useState(0);

  // Refs for game state (avoid re-renders in animation loop)
  const gameState = useRef({
    player: { x: 0, y: 0, w: 40, h: 40 },
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
    phase: 'instructions' as GamePhase,
    maxTimeMs: maxTime * 1000,
    gameplayEnded: false,
    animFrame: 0,
    canvasW: 0,
    canvasH: 0,
  });

  // Initialize background stars
  const initBgStars = useCallback((w: number, h: number) => {
    const stars: BgStar[] = [];
    for (let i = 0; i < 100; i++) {
      stars.push({
        x: rand(0, w),
        y: rand(0, h),
        size: rand(0.5, 2),
        brightness: rand(0.3, 1),
        speed: rand(0.2, 1),
      });
    }
    gameState.current.bgStars = stars;
  }, []);

  // Spawn particle burst
  const spawnParticles = useCallback((x: number, y: number, color: string, count: number) => {
    const gs = gameState.current;
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(1, 4);
      gs.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: rand(20, 40),
        maxLife: 40,
        color,
        size: rand(1, 3),
      });
    }
  }, []);

  // ── Drawing functions ─────────────────────────────
  const drawBgStars = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const gs = gameState.current;
    gs.bgStars.forEach(s => {
      s.y += s.speed;
      if (s.y > h) { s.y = 0; s.x = rand(0, w); }
      ctx.fillStyle = hslStr(200, 100, 95, s.brightness * 0.6);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  const drawPlayer = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    // Ship body
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);

    // Engine glow
    const glowGrad = ctx.createRadialGradient(0, h * 0.4, 0, 0, h * 0.4, w * 0.5);
    glowGrad.addColorStop(0, hslStr(190, 100, 70, 0.6));
    glowGrad.addColorStop(1, hslStr(190, 100, 70, 0));
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, h * 0.4, w * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Main body
    const bodyGrad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    bodyGrad.addColorStop(0, hslStr(190, 100, 70));
    bodyGrad.addColorStop(1, hslStr(230, 60, 30));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.lineTo(-w / 4, h / 3);
    ctx.lineTo(w / 4, h / 3);
    ctx.lineTo(w / 2, h / 2);
    ctx.closePath();
    ctx.fill();

    // Cockpit
    ctx.fillStyle = hslStr(190, 100, 80, 0.8);
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.1, w * 0.12, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }, []);

  const drawStar = useCallback((ctx: CanvasRenderingContext2D, obj: FallingObj, time: number) => {
    ctx.save();
    ctx.translate(obj.x, obj.y);
    ctx.rotate(obj.rotation + time * 0.002);
    const s = obj.size;

    // Glow
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.5);
    glow.addColorStop(0, hslStr(45, 100, 70, 0.5));
    glow.addColorStop(1, hslStr(45, 100, 70, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Star shape
    ctx.fillStyle = hslStr(45, 100, 60);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const method = i === 0 ? 'moveTo' : 'lineTo';
      ctx[method](Math.cos(angle) * s, Math.sin(angle) * s);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }, []);

  const drawBomb = useCallback((ctx: CanvasRenderingContext2D, obj: FallingObj, time: number) => {
    ctx.save();
    ctx.translate(obj.x, obj.y);
    const s = obj.size;
    const pulse = 1 + Math.sin(time * 0.01) * 0.1;

    // Danger glow
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2 * pulse);
    glow.addColorStop(0, hslStr(0, 85, 55, 0.3));
    glow.addColorStop(1, hslStr(0, 85, 55, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 2 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Bomb body
    ctx.fillStyle = hslStr(0, 10, 15);
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = hslStr(0, 85, 55, 0.7);
    ctx.beginPath();
    ctx.arc(-s * 0.25, -s * 0.25, s * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // Fuse spark
    ctx.fillStyle = hslStr(30 + Math.sin(time * 0.05) * 20, 100, 70);
    ctx.beginPath();
    ctx.arc(0, -s - 4, 3 + Math.sin(time * 0.1) * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }, []);

  const drawBullet = useCallback((ctx: CanvasRenderingContext2D, b: Bullet, time: number) => {
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);

    if (b.enhanced) {
      // Enhanced bullet with glow and pulsing
      const pulse = 1 + Math.sin(time * 0.015 + b.y * 0.1) * 0.3;
      const hue = 280 + Math.sin(time * 0.005 + b.y * 0.05) * 40;

      // Outer glow
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, b.w * 2 * pulse);
      glow.addColorStop(0, hslStr(hue, 100, 70, 0.6));
      glow.addColorStop(0.5, hslStr(hue, 100, 50, 0.2));
      glow.addColorStop(1, hslStr(hue, 100, 50, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, b.w * 2 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Core
      const coreGrad = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
      coreGrad.addColorStop(0, hslStr(hue, 100, 90));
      coreGrad.addColorStop(1, hslStr(hue, 100, 50));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, b.w / 2);
      ctx.fill();
    } else {
      // Normal bullet
      const grad = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
      grad.addColorStop(0, hslStr(190, 100, 90));
      grad.addColorStop(1, hslStr(190, 100, 50));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, b.w / 4);
      ctx.fill();
    }

    ctx.restore();
  }, []);

  const drawHUD = useCallback((ctx: CanvasRenderingContext2D, w: number, score: number, lives: number, elapsedMs: number) => {
    const pad = 15;
    ctx.font = '600 18px Orbitron, monospace';

    // Timer
    const totalSec = Math.floor(elapsedMs / 1000);
    const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const secs = String(totalSec % 60).padStart(2, '0');
    const ms = String(Math.floor((elapsedMs % 1000) / 10)).padStart(2, '0');
    const timeStr = `${mins}:${secs}:${ms}`;

    ctx.fillStyle = hslStr(190, 100, 80);
    ctx.textAlign = 'center';
    ctx.fillText(timeStr, w / 2, pad + 18);

    // Score
    ctx.textAlign = 'left';
    ctx.fillStyle = hslStr(45, 100, 70);
    ctx.fillText(`★ ${score}`, pad, pad + 18);

    // Lives
    ctx.textAlign = 'right';
    const heartStr = '❤'.repeat(lives) + '🖤'.repeat(MAX_LIVES - lives);
    ctx.font = '20px sans-serif';
    ctx.fillText(heartStr, w - pad, pad + 18);
  }, []);

  // ── Main game loop ────────────────────────────────
  const gameLoop = useCallback((ctx: CanvasRenderingContext2D, timestamp: number) => {
    const gs = gameState.current;
    const { canvasW: w, canvasH: h } = gs;

    // Clear
    ctx.fillStyle = hslStr(230, 30, 4);
    ctx.fillRect(0, 0, w, h);
    drawBgStars(ctx, w, h);

    if (gs.phase !== 'playing') return;

    const now = timestamp;
    const elapsed = now - gs.startTime;
    const enhanced = elapsed >= BULLET_ENHANCE_TIME;
    const gameplayActive = elapsed < GAME_DURATION && gs.lives > 0;

    // Update elapsed for HUD
    setElapsed(elapsed);

    // Player movement
    if (gameplayActive) {
      if (gs.keys.has('ArrowLeft') || gs.keys.has('a')) gs.player.x -= PLAYER_SPEED;
      if (gs.keys.has('ArrowRight') || gs.keys.has('d')) gs.player.x += PLAYER_SPEED;
      if (gs.touchX !== null) {
        const targetX = gs.touchX - gs.player.w / 2;
        const diff = targetX - gs.player.x;
        gs.player.x += diff * 0.15;
      }
      gs.player.x = Math.max(0, Math.min(w - gs.player.w, gs.player.x));

      // Auto-fire bullets
      if (now - gs.lastBullet > BULLET_INTERVAL) {
        const bw = enhanced ? 8 : 4;
        const bh = enhanced ? 20 : 12;
        gs.bullets.push({
          x: gs.player.x + gs.player.w / 2 - bw / 2,
          y: gs.player.y - bh,
          w: bw, h: bh,
          enhanced,
        });
        gs.lastBullet = now;
      }

      // Spawn stars
      if (now - gs.lastStar > SPAWN_INTERVAL_STAR) {
        gs.objects.push({
          x: rand(20, w - 20),
          y: -20,
          type: 'star',
          size: rand(10, 16),
          speed: rand(STAR_SPEED_MIN, STAR_SPEED_MAX),
          rotation: rand(0, Math.PI * 2),
        });
        gs.lastStar = now;
      }

      // Spawn bombs
      if (now - gs.lastBomb > SPAWN_INTERVAL_BOMB) {
        gs.objects.push({
          x: rand(20, w - 20),
          y: -20,
          type: 'bomb',
          size: rand(12, 18),
          speed: rand(BOMB_SPEED_MIN, BOMB_SPEED_MAX),
          rotation: 0,
        });
        gs.lastBomb = now;
      }
    }

    // Update bullets
    gs.bullets = gs.bullets.filter(b => {
      b.y -= b.enhanced ? BULLET_ENHANCED_SPEED : BULLET_SPEED;
      return b.y + b.h > 0;
    });

    // Update falling objects & collision
    const playerCX = gs.player.x + gs.player.w / 2;
    const playerCY = gs.player.y + gs.player.h / 2;
    const playerR = gs.player.w * 0.4;

    gs.objects = gs.objects.filter(obj => {
      obj.y += obj.speed;
      if (obj.y > h + 30) return false;

      // Player collision
      if (gameplayActive) {
        const dx = obj.x - playerCX;
        const dy = obj.y - playerCY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitDist = playerR + obj.size;

        if (dist < hitDist) {
          if (obj.type === 'star') {
            gs.score += STAR_POINTS;
            setScore(gs.score);
            spawnParticles(obj.x, obj.y, hslStr(45, 100, 70), 12);
          } else {
            gs.lives--;
            setLives(gs.lives);
            spawnParticles(obj.x, obj.y, hslStr(0, 85, 55), 20);
            if (gs.lives <= 0) {
              gs.gameplayEnded = true;
            }
          }
          return false;
        }
      }

      // Bullet-bomb collision (destroy bombs with bullets)
      if (obj.type === 'bomb') {
        for (let i = gs.bullets.length - 1; i >= 0; i--) {
          const b = gs.bullets[i];
          const bx = b.x + b.w / 2;
          const by = b.y + b.h / 2;
          const bdx = obj.x - bx;
          const bdy = obj.y - by;
          if (Math.sqrt(bdx * bdx + bdy * bdy) < obj.size + b.w) {
            gs.score += 5;
            setScore(gs.score);
            spawnParticles(obj.x, obj.y, hslStr(30, 100, 60), 8);
            gs.bullets.splice(i, 1);
            return false;
          }
        }
      }

      return true;
    });

    // Update particles
    gs.particles = gs.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      return p.life > 0;
    });

    // ── Draw ────────────────────────────────
    // Bullets
    gs.bullets.forEach(b => drawBullet(ctx, b, now));

    // Falling objects
    gs.objects.forEach(obj => {
      if (obj.type === 'star') drawStar(ctx, obj, now);
      else drawBomb(ctx, obj, now);
    });

    // Particles
    gs.particles.forEach(p => {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color.replace(')', `,${alpha})`).replace('hsl', 'hsla');
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    });

    // Player (draw if alive or within game time)
    if (gs.lives > 0) {
      drawPlayer(ctx, gs.player.x, gs.player.y, gs.player.w, gs.player.h);
    }

    // HUD
    drawHUD(ctx, w, gs.score, gs.lives, elapsed);

    // Enhanced mode indicator
    if (enhanced && gameplayActive) {
      ctx.font = '600 14px Orbitron, monospace';
      ctx.fillStyle = hslStr(280, 100, 70, 0.8 + Math.sin(now * 0.005) * 0.2);
      ctx.textAlign = 'center';
      ctx.fillText('⚡ POWER MODE ⚡', w / 2, 55);
    }

    // Check transitions
    if (!gs.gameplayEnded && (elapsed >= GAME_DURATION || gs.lives <= 0)) {
      gs.gameplayEnded = true;
      setPhase('waiting');
      gs.phase = 'waiting';
    }

    // Max time reached
    if (elapsed >= gs.maxTimeMs) {
      setPhase('done');
      gs.phase = 'done';
      onGameEnd(gs.score);
    }
  }, [drawBgStars, drawBullet, drawBomb, drawStar, drawPlayer, drawHUD, spawnParticles, onGameEnd]);

  // ── Canvas setup & animation frame ────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gameState.current.canvasW = canvas.width;
      gameState.current.canvasH = canvas.height;
      gameState.current.player.x = canvas.width / 2 - 20;
      gameState.current.player.y = canvas.height - 80;
      if (gameState.current.bgStars.length === 0) {
        initBgStars(canvas.width, canvas.height);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    // Input handlers
    const onKeyDown = (e: KeyboardEvent) => gameState.current.keys.add(e.key);
    const onKeyUp = (e: KeyboardEvent) => gameState.current.keys.delete(e.key);
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      gameState.current.touchX = e.touches[0].clientX;
    };
    const onTouchEnd = () => { gameState.current.touchX = null; };
    const onTouchStart = (e: TouchEvent) => {
      gameState.current.touchX = e.touches[0].clientX;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    let running = true;
    const loop = (ts: number) => {
      if (!running) return;
      gameLoop(ctx, ts);
      gameState.current.animFrame = requestAnimationFrame(loop);
    };
    gameState.current.animFrame = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(gameState.current.animFrame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [gameLoop, initBgStars]);

  // ── Countdown logic ───────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      setPhase('playing');
      gameState.current.phase = 'playing';
      gameState.current.startTime = performance.now();
      gameState.current.lastBullet = performance.now();
      gameState.current.lastStar = performance.now();
      gameState.current.lastBomb = performance.now();
      return;
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, countdown]);

  // ── Waiting → auto redirect after maxTime ─────────
  useEffect(() => {
    if (phase !== 'waiting') return;
    const gs = gameState.current;
    const remaining = gs.maxTimeMs - (performance.now() - gs.startTime);
    if (remaining <= 0) {
      setPhase('done');
      gs.phase = 'done';
      onGameEnd(gs.score);
      return;
    }
    const timer = setTimeout(() => {
      setPhase('done');
      gs.phase = 'done';
      onGameEnd(gs.score);
    }, remaining);
    return () => clearTimeout(timer);
  }, [phase, onGameEnd]);

  const startGame = () => {
    setPhase('countdown');
    setCountdown(3);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-game-bg">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Instructions Overlay */}
      {phase === 'instructions' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/80 backdrop-blur-sm px-6">
          <h1 className="font-game text-3xl md:text-5xl text-primary text-glow mb-6">
            SPACE SHOOTER
          </h1>
          <div className="max-w-md space-y-4 text-center font-game-body text-lg text-foreground/90">
            <p className="text-accent text-glow-accent text-xl font-semibold">How to Play</p>
            <p>🚀 Move your ship left/right using <span className="text-primary">Arrow Keys</span> or <span className="text-primary">Touch</span></p>
            <p>🔫 Your ship fires automatically</p>
            <p>⭐ Collect <span className="text-accent">Stars</span> to earn points</p>
            <p>💣 Avoid <span className="text-destructive">Bombs</span> — you have 3 lives!</p>
            <p>⚡ After 10 seconds, bullets <span className="text-secondary">power up!</span></p>
            <p className="text-muted-foreground text-sm mt-4">Shoot bombs to destroy them for bonus points</p>
          </div>
          <button
            onClick={startGame}
            className="mt-8 font-game text-lg px-8 py-3 rounded-lg bg-primary text-primary-foreground box-glow hover:brightness-110 transition-all animate-pulse-glow"
          >
            START GAME
          </button>
        </div>
      )}

      {/* Countdown Overlay */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <span className="font-game text-8xl md:text-9xl text-primary text-glow animate-pulse">
            {countdown}
          </span>
        </div>
      )}

      {/* Waiting Overlay */}
      {phase === 'waiting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/70 backdrop-blur-sm">
          <p className="font-game text-2xl text-primary text-glow mb-4">GAME OVER</p>
          <p className="font-game text-4xl text-accent text-glow-accent mb-6">★ {score}</p>
          <p className="font-game-body text-lg text-muted-foreground animate-pulse">
            Waiting for other players...
          </p>
        </div>
      )}
    </div>
  );
}
