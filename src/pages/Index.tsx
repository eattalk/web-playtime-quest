import { useNavigate } from 'react-router-dom';

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <h1 className="font-game text-4xl md:text-6xl text-primary text-glow mb-4">
        ARCADE ZONE
      </h1>
      <p className="font-game-body text-xl text-muted-foreground mb-10 text-center max-w-md">
        Web-based mini games for your table experience
      </p>

      <button
        onClick={() => navigate('/webview/games/shooter?table_name=demo')}
        className="font-game text-lg px-10 py-4 rounded-lg bg-primary text-primary-foreground box-glow hover:brightness-110 transition-all animate-pulse-glow"
      >
        🚀 SPACE SHOOTER
      </button>

      <p className="mt-8 text-sm text-muted-foreground font-game-body text-center max-w-sm">
        Access games via:<br />
        <code className="text-primary/80 text-xs">/webview/games/&#123;game_type&#125;?table_name=&#123;name&#125;</code>
      </p>
    </div>
  );
};

export default Index;
