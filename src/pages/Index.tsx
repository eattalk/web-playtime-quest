import { useNavigate } from 'react-router-dom';

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <h1 className="font-game text-4xl md:text-6xl text-primary text-glow mb-4">
        SPACESHIP GAME
      </h1>
      <p className="font-game-body text-xl text-muted-foreground mb-10 text-center max-w-md">

      </p>

      <button
        onClick={() => navigate('/webview/games/shooter?table_name=demo')}
        className="font-game text-lg px-10 py-4 rounded-lg bg-primary text-primary-foreground box-glow hover:brightness-110 transition-all animate-pulse-glow">
        
        🚀 ready
      </button>

      <p className="mt-8 text-sm text-muted-foreground font-game-body text-center max-w-sm">
<br />
        <code className="text-primary/80 text-xs"></code>
      </p>
    </div>);

};

export default Index;