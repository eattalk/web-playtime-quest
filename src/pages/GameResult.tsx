import { useSearchParams } from 'react-router-dom';

export default function GameResult() {
  const [searchParams] = useSearchParams();
  const raw = parseInt(searchParams.get('score') || '0', 10);

  // score encoded as: baseScore * 100000 + survivedMs
  // This guarantees no ties — even same base score has unique ms tiebreaker
  const baseScore = Math.floor(raw / 100000);
  const display = raw >= 100000 ? baseScore : raw; // fallback for old format

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
        </div>
        <p className="font-game-body text-muted-foreground text-sm animate-pulse">
          Returning to app...
        </p>
      </div>
    </div>
  );
}
