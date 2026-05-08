import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Fish } from "lucide-react";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-gradient-to-br from-primary to-secondary rounded-full p-4 w-20 h-20 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Fish className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">AquaWatch</h1>
          <p className="text-muted-foreground mt-2">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}
