import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Map as MapIcon,
  Trophy,
  Zap,
  Star,
  Fish,
  LogOut,
  User as UserIcon,
} from "lucide-react";

interface UserSession {
  id: string;
  email: string;
  username: string;
  points: number;
  level: number;
  badges: string[];
}

export default function HomePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserSession | null>(null);

  useEffect(() => {
    // Check for existing session
    const session = localStorage.getItem("userSession");
    if (!session) {
      navigate("/auth");
    } else {
      setUser(JSON.parse(session));
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem("userSession");
    navigate("/auth");
  };

  if (!user) {
    return null;
  }

  const pointsToNextLevel = (user.level * 500) - user.points;
  const progressPercent = (user.points % 500) / 5;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-primary to-secondary rounded-full p-2">
              <Fish className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              AquaWatch
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate("/profile")}
            >
              <UserIcon className="w-5 h-5" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleLogout}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground">
            Welcome back, <span className="text-primary">{user.username}</span>!
          </h2>
          <p className="text-muted-foreground mt-2">
            Keep exploring and discovering aquatic life around you
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {/* Points Card */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Points
              </h3>
              <Zap className="w-5 h-5 text-accent" />
            </div>
            <p className="text-3xl font-bold text-foreground">
              {user.points.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {pointsToNextLevel} to next level
            </p>
          </div>

          {/* Level Card */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Level
              </h3>
              <Trophy className="w-5 h-5 text-primary" />
            </div>
            <p className="text-3xl font-bold text-foreground">{user.level}</p>
            <p className="text-xs text-muted-foreground mt-2">Keep it up!</p>
          </div>

          {/* Badges Card */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Badges
              </h3>
              <Star className="w-5 h-5 text-secondary" />
            </div>
            <p className="text-3xl font-bold text-foreground">
              {user.badges.length}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Achievements unlocked
            </p>
          </div>

          {/* Observations Card */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Observations
              </h3>
              <Fish className="w-5 h-5 text-primary" />
            </div>
            <p className="text-3xl font-bold text-foreground">0</p>
            <p className="text-xs text-muted-foreground mt-2">
              Create your first one!
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">
              Level {user.level} Progress
            </h3>
            <span className="text-sm text-muted-foreground">
              {user.points % 500} / 500
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-primary to-secondary h-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Button
            onClick={() => navigate("/create-observation")}
            className="h-16 text-lg bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-semibold rounded-2xl"
          >
            <Plus className="w-6 h-6 mr-2" />
            New Observation
          </Button>
          <Button
            onClick={() => navigate("/map")}
            variant="outline"
            className="h-16 text-lg font-semibold rounded-2xl"
          >
            <MapIcon className="w-6 h-6 mr-2" />
            View Map
          </Button>
        </div>

        {/* Recent Activity Section */}
        <div className="mt-12">
          <h3 className="text-xl font-bold text-foreground mb-4">
            Recent Activity
          </h3>
          <div className="bg-card rounded-2xl border border-border p-8 text-center">
            <Fish className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">
              No observations yet. Start exploring to see your activity here!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
