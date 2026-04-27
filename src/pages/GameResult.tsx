import { useSearchParams } from 'react-router-dom';

export default function GameResult() {
  const [searchParams] = useSearchParams();
  // score is encoded as: baseScore * 100000 + survivedMs — already a unique integer
  const score = parseInt(searchParams.get('score') || '0', 10);

  return (
    <div className="flex min-h-full items-center justify-center bg-background">
      <div className="text-center space-y-8 px-6">
        <h1 className="font-game text-4xl md:text-6xl text-primary text-glow">
          MISSION COMPLETE
        </h1>
        <div className="space-y-2">
          <p className="font-game-body text-xl text-muted-foreground">Your Score</p>
          <p className="font-game text-5xl md:text-7xl text-accent text-glow-accent tracking-tight">
            {score.toLocaleString()}
          </p>
        </div>

        <div className="pt-4 space-y-3">
          <p className="font-game text-3xl md:text-5xl text-primary text-glow animate-pulse">
            다른 플레이어를 기다려주세요
          </p>
          <p className="font-game-body text-base md:text-lg text-muted-foreground">
            Waiting for other players...
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <span className="w-3 h-3 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-3 h-3 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-3 h-3 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
