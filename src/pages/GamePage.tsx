import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { useCallback, useState, useEffect, useRef } from 'react';
import ShooterGame from '@/components/ShooterGame';

// Buffer added on top of maxTime to wait for other players in the room
const MAX_TIME_BUFFER = 15; // seconds

const GAME_CONFIGS: Record<string, { maxTime: number }> = {
  shooter: { maxTime: 45 },
  default: { maxTime: 45 },
};

type Phase = 'playing' | 'waiting' | 'done';

export default function GamePage() {
  const { gameType = 'shooter' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const tableName = searchParams.get('table_name') || 'default';
  const maxTimeParam = searchParams.get('max_time');
  const skipDemo = searchParams.get('skip_demo') === '1';
  const config = GAME_CONFIGS[gameType] || GAME_CONFIGS.default;
  const maxTime = maxTimeParam ? parseInt(maxTimeParam, 10) : config.maxTime;

  const [phase, setPhase] = useState<Phase>('playing');
  const [waitRemaining, setWaitRemaining] = useState(0);
  const finalScoreRef = useRef(0);

  const goToResult = useCallback((score: number) => {
    navigate(`/webview/games/result?score=${score}`);
  }, [navigate]);

  const handleGameEnd = useCallback((score: number) => {
    finalScoreRef.current = score;

    // Decode elapsed seconds from encoded score: score = basePoints * 100000 + survivedMs
    const survivedMs = score % 100000;
    const elapsedSec = survivedMs / 1000;

    // Wait for remaining room time: remaining = maxTime + BUFFER - elapsed
    const remaining = Math.max(0, maxTime + MAX_TIME_BUFFER - elapsedSec);

    if (remaining <= 0) {
      goToResult(score);
      return;
    }

    setWaitRemaining(Math.ceil(remaining));
    setPhase('waiting');
  }, [maxTime, goToResult]);

  // Countdown timer while waiting for other players
  useEffect(() => {
    if (phase !== 'waiting') return;

    const interval = setInterval(() => {
      setWaitRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          goToResult(finalScoreRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, goToResult]);

  return (
    <div className="relative w-full h-screen">
      <ShooterGame
        gameType={gameType}
        tableName={tableName}
        maxTime={maxTime}
        skipDemo={skipDemo}
        onGameEnd={handleGameEnd}
      />

      {phase === 'waiting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-50 gap-4">
          <p
            className="font-game text-2xl text-primary"
            style={{ textShadow: '0 0 20px hsl(190 100% 60% / 0.6)' }}
          >
            다른 플레이어 대기 중...
          </p>
          <p
            className="font-game text-7xl text-accent"
            style={{ textShadow: '0 0 30px hsl(45 100% 60% / 0.8)' }}
          >
            {waitRemaining}
          </p>
        </div>
      )}
    </div>
  );
}
