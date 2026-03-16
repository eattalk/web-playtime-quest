import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import ShooterGame from '@/components/ShooterGame';

const GAME_CONFIGS: Record<string, { maxTime: number }> = {
  shooter: { maxTime: 45 },
  default: { maxTime: 45 },
};

export default function GamePage() {
  const { gameType = 'shooter' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const tableName = searchParams.get('table_name') || 'default';
  const maxTimeParam = searchParams.get('max_time');
  const skipDemo = searchParams.get('skip_demo') === '1';
  const config = GAME_CONFIGS[gameType] || GAME_CONFIGS.default;
  const maxTime = maxTimeParam ? parseInt(maxTimeParam, 10) : config.maxTime;

  const handleGameEnd = useCallback((score: number) => {
    navigate(`/webview/games/result?score=${score}`);
  }, [navigate]);

  return (
    <ShooterGame
      gameType={gameType}
      tableName={tableName}
      maxTime={maxTime}
      skipDemo={skipDemo}
      onGameEnd={handleGameEnd}
    />
  );
}
