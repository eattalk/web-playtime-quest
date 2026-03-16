import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import ShooterGame from '@/components/ShooterGame';

const COUNTDOWN_SEC = 5;

const Index = () => {
  const navigate = useNavigate();
  const [counter, setCounter] = useState(COUNTDOWN_SEC);

  const startGame = () => navigate('/webview/games/shooter?table_name=demo');

  // Countdown then auto-navigate
  useEffect(() => {
    if (counter <= 0) { startGame(); return; }
    const t = setTimeout(() => setCounter(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [counter]);

  // Also allow tap anywhere on the overlay
  const handleTap = () => startGame();

  // Arc for circular progress (0→1)
  const progress = (COUNTDOWN_SEC - counter) / COUNTDOWN_SEC;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - (counter / COUNTDOWN_SEC));

  return (
    <div
      className="relative w-full h-screen overflow-hidden select-none cursor-pointer"
      onClick={handleTap}
    >
      {/* Demo canvas in background */}
      <div className="absolute inset-0 pointer-events-none">
        <ShooterGame demoOnly />
      </div>

      {/* Semi-transparent overlay */}
      <div className="absolute inset-0 bg-background/40 backdrop-blur-[2px]" />

      {/* Center UI */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 z-10">
        {/* Title */}
        <h1
          className="font-game text-5xl md:text-7xl text-primary tracking-widest"
          style={{ textShadow: '0 0 40px hsl(190 100% 60% / 0.8), 0 0 80px hsl(190 100% 50% / 0.4)' }}
        >
          SPACE SHOOTER
        </h1>

        {/* Circular countdown */}
        <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
          {/* Background ring */}
          <svg width="140" height="140" className="absolute">
            <circle cx="70" cy="70" r={r} fill="none" stroke="hsl(190 20% 20% / 0.5)" strokeWidth="6" />
            <circle
              cx="70" cy="70" r={r}
              fill="none"
              stroke="hsl(190 100% 60%)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 70 70)"
              style={{
                filter: 'drop-shadow(0 0 8px hsl(190 100% 60%))',
                transition: 'stroke-dashoffset 0.9s linear',
              }}
            />
          </svg>
          {/* Number */}
          <span
            className="font-game text-6xl text-primary relative z-10"
            style={{ textShadow: '0 0 30px hsl(190 100% 60%)' }}
          >
            {counter}
          </span>
        </div>

        {/* Tap prompt */}
        <p
          className="font-game text-xl text-primary/70 animate-pulse"
          style={{ textShadow: '0 0 12px hsl(190 100% 60% / 0.5)' }}
        >
          탭하면 바로 시작 →
        </p>
      </div>
    </div>
  );
};

export default Index;
