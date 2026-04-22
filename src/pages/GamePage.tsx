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
  const submitUrl = searchParams.get('submit_url');
  const config = GAME_CONFIGS[gameType] || GAME_CONFIGS.default;
  const maxTime = maxTimeParam ? parseInt(maxTimeParam, 10) : config.maxTime;

  const handleGameEnd = useCallback(
    (score: number) => {
      // 게임 종료 신호 + 점수 서버 전송 (결과 화면 이동 전)
      if (submitUrl) {
        const payload = {
          score,
          table_name: tableName,
          game_type: gameType,
          finished: true,
        };

        try {
          // sendBeacon 우선 사용 (페이지 이동 중에도 안전하게 전송됨)
          const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
          const sent =
            typeof navigator !== 'undefined' &&
            typeof navigator.sendBeacon === 'function' &&
            navigator.sendBeacon(submitUrl, blob);

          if (!sent) {
            // fallback: keepalive fetch
            fetch(submitUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              keepalive: true,
            }).catch((err) => console.error('[GamePage] score submit failed:', err));
          }
        } catch (err) {
          console.error('[GamePage] score submit error:', err);
        }
      } else {
        console.warn('[GamePage] submit_url not provided — score not sent to server');
      }

      navigate(`/webview/games/result?score=${score}`);
    },
    [navigate, submitUrl, tableName, gameType]
  );

  return (
    <div className="relative w-full h-screen">
      <ShooterGame
        gameType={gameType}
        tableName={tableName}
        maxTime={maxTime}
        skipDemo={skipDemo}
        onGameEnd={handleGameEnd}
      />
    </div>
  );
}
