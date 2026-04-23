import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import GamePage from "./pages/GamePage";
import GameResult from "./pages/GameResult";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const GameRedirect = ({ gameType }: { gameType: string }) => {
  const location = useLocation();
  return <Navigate to={`/webview/games/${gameType}${location.search}`} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<GameRedirect gameType="shooter" />} />
          <Route path="/index.html" element={<GameRedirect gameType="shooter" />} />
          <Route path="/webview/games/result" element={<GameResult />} />
          <Route path="/webview/games/:gameType" element={<GamePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
