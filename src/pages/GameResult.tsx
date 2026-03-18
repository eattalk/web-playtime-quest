import { useSearchParams } from 'react-router-dom';

export default function GameResult() {
  const [searchParams] = useSearchParams();
  const raw = parseInt(searchParams.get('score') || '0', 10);

  // score encoded as: baseScore * 100000 + survivedMs (0~99999)
  // Display as decimal: e.g. 1004235 → "10.04235"
  const baseScore = Math.floor(raw / 100000);
  const survivedMs = raw % 100000;
  const decimalPart = String(survivedMs).padStart(5, '0');
  const displayScore = raw >= 100000 ? `${baseScore}.${decimalPart}` : String(raw);

  return (
    <div className="flex min-h-full items-center justify-center bg-background">
      <div className="text-center space-y-6 px-6">
        <h1 className="font-game text-4xl md:text-6xl text-primary text-glow">
          MISSION COMPLETE
        </h1>
        <div className="space-y-2">
          <p className="font-game-body text-xl text-muted-foreground">Your Score</p>
          <p className="font-game text-5xl md:text-7xl text-accent text-glow-accent tracking-tight">
            {displayScore}
          </p>
        </div>
        <p className="font-game-body text-muted-foreground text-sm animate-pulse">
          Returning to app...
        </p>
      </div>
    </div>
  );
}
