import { useSearchParams } from 'react-router-dom';

export default function GameResult() {
  const [searchParams] = useSearchParams();
  const raw = parseInt(searchParams.get('score') || '0', 10);

  // score is encoded as: baseScore * 1000 + survivedMs%1000 (tiebreaker)
  const baseScore = Math.floor(raw / 1000);
  const tieMs = raw % 1000;
  const display = raw < 1000 ? raw : baseScore; // fallback for old format

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-6 px-6">
        <h1 className="font-game text-4xl md:text-6xl text-primary text-glow">
          MISSION COMPLETE
        </h1>
        <div className="space-y-2">
          <p className="font-game-body text-xl text-muted-foreground">Your Score</p>
          <p className="font-game text-6xl md:text-8xl text-accent text-glow-accent">
            {display}
          </p>
          {raw >= 1000 && (
            <p className="font-game text-sm text-muted-foreground/60">
              +{tieMs}ms survived
            </p>
          )}
        </div>
        <p className="font-game-body text-muted-foreground text-sm animate-pulse">
          Returning to app...
        </p>
      </div>
    </div>
  );
}
