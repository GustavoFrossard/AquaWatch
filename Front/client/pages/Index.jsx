import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Fish } from "lucide-react";
import { getMe } from "@/lib/auth";
export default function Index() {
    const navigate = useNavigate();
    useEffect(() => {
        const checkSession = async () => {
            try {
                const result = await getMe();
                localStorage.setItem("userSession", JSON.stringify(result.user));
                navigate("/home", { replace: true });
            }
            catch {
                localStorage.removeItem("userSession");
                navigate("/auth", { replace: true });
            }
        };
        checkSession();
    }, [navigate]);
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
