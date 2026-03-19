import { useSearchParams } from 'react-router-dom';

export default function GameResult() {
  const [searchParams] = useSearchParams();
  // score is encoded as: baseScore * 100000 + survivedMs — already a unique integer
  const score = parseInt(searchParams.get('score') || '0', 10);

  return (
    <div className="flex min-h-full items-center justify-center bg-background">
      <div className="text-center space-y-6 px-6">
        <h1 className="font-game text-4xl md:text-6xl text-primary text-glow">
          MISSION COMPLETE
        </h1>
        <div className="space-y-2">
          <p className="font-game-body text-xl text-muted-foreground">Your Score</p>
          <p className="font-game text-5xl md:text-7xl text-accent text-glow-accent tracking-tight">
            {score.toLocaleString()}
          </p>
        </div>
        <p className="font-game-body text-muted-foreground text-sm animate-pulse">
          Returning to app...
        </p>
      </div>
    </div>
  );
}
