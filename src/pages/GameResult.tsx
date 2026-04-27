import { useSearchParams } from 'react-router-dom';

export default function GameResult() {
  const [searchParams] = useSearchParams();
  // score is encoded as: baseScore * 100000 + survivedMs — already a unique integer
  const score = parseInt(searchParams.get('score') || '0', 10);

  return (
    <div className="flex min-h-full items-center justify-center bg-background">
      <div className="text-center space-y-10 px-6 animate-fade-in">
        <h1 className="font-game text-4xl md:text-6xl text-primary text-glow animate-scale-in">
          MISSION COMPLETE
        </h1>

        <div className="space-y-2 animate-scale-in" style={{ animationDelay: '120ms', animationFillMode: 'backwards' }}>
          <p className="font-game-body text-xl text-muted-foreground">Your Score</p>
          <p className="font-game text-5xl md:text-7xl text-accent text-glow-accent tracking-tight">
            {score.toLocaleString()}
          </p>
        </div>

        <div
          className="pt-6 space-y-5 animate-fade-in"
          style={{ animationDelay: '280ms', animationFillMode: 'backwards' }}
        >
          <p className="font-game text-5xl md:text-7xl lg:text-8xl text-primary text-glow leading-tight pulse">
            WAITING FOR
            <br />
            OTHER PLAYERS
          </p>

          <div className="flex justify-center gap-3 pt-2">
            <span
              className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
