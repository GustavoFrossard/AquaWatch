import "./global.css";
import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import AuthPage from "./pages/Auth";
import HomePage from "./pages/Home";
import CreateObservationPage from "./pages/CreateObservation";
import MapPage from "./pages/Map";
import ProfilePage from "./pages/Profile";
import NotFound from "./pages/NotFound";
const queryClient = new QueryClient();
const AppComponent = () => (<QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />}/>
            <Route path="/auth" element={<AuthPage />}/>
            <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>}/>
            <Route path="/observation" element={<ProtectedRoute><CreateObservationPage /></ProtectedRoute>}/>
            <Route path="/map" element={<ProtectedRoute><MapPage /></ProtectedRoute>}/>
            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>}/>
            <Route path="*" element={<NotFound />}/>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>);
createRoot(document.getElementById("root")).render(<AppComponent />);
