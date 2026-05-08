import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Fish } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
export default function Index() {
    const navigate = useNavigate();
    const { user, loading } = useAuth();

    useEffect(() => {
        // Persist native mobile coords from URL params before any redirect
        const params = new URLSearchParams(window.location.search);
        const nativeLat = parseFloat(params.get("nativeLat"));
        const nativeLng = parseFloat(params.get("nativeLng"));
        if (!isNaN(nativeLat) && !isNaN(nativeLng)) {
            localStorage.setItem("nativeCoords", JSON.stringify({ latitude: nativeLat, longitude: nativeLng }));
        }
    }, []);

    useEffect(() => {
        if (loading) return;
        navigate(user ? "/home" : "/auth", { replace: true });
    }, [user, loading, navigate]);

    // Show loading state while redirecting
    return (<div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5 flex items-center justify-center">
      <div className="text-center">
        <div className="bg-gradient-to-br from-primary to-secondary rounded-full p-4 w-20 h-20 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <Fish className="w-10 h-10 text-white"/>
        </div>
        <h1 className="text-2xl font-bold text-foreground">AquaWatch</h1>
        <p className="text-muted-foreground mt-2">Loading...</p>
      </div>
    </div>);
}
