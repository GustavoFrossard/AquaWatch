import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Plus, Map as MapIcon, Trophy, Zap, Fish, LogOut, User as UserIcon, MapPin, Calendar, Award } from "lucide-react";
import { getObservations } from "@/lib/auth";
import { computeLevel, levelProgress, getAllBadges, levelTitle, getUnlockedBadgeIds } from "@/lib/gamification";
import { useAuth } from "@/contexts/AuthContext";
export default function HomePage() {
    const navigate = useNavigate();
    const { user, logout, updateUser } = useAuth();
    const [observations, setObservations] = useState([]);
    useEffect(() => {
        getObservations()
            .then((result) => setObservations(result.observations || []))
            .catch(() => setObservations([]));
    }, []);
    const handleLogout = async () => {
        await logout();
        navigate("/auth");
    };

    // Gamification computed from observation count
    const obsCount = observations.length;
    const progress = levelProgress(obsCount);
    const badges = getAllBadges(obsCount);
    const unlockedBadges = badges.filter((b) => b.unlocked);
    const title = levelTitle(progress.level);

    // Sync level & badges into user session if stale
    useEffect(() => {
      if (!user) return;
      const correctLevel = computeLevel(obsCount);
      const correctBadges = getUnlockedBadgeIds(obsCount);
      if (user.level !== correctLevel || JSON.stringify(user.badges) !== JSON.stringify(correctBadges)) {
        updateUser({ ...user, level: correctLevel, badges: correctBadges });
      }
    }, [obsCount, user, updateUser]);

    if (!user) {
        return null;
    }

    return (<div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-primary to-secondary rounded-full p-2">
              <Fish className="w-6 h-6 text-white"/>
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              AquaWatch
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => navigate("/profile")}>
              <UserIcon className="w-5 h-5"/>
            </Button>
            <Button variant="outline" size="icon" onClick={handleLogout}>
              <LogOut className="w-5 h-5"/>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground">
            Olá, <span className="text-primary">{user.username}</span>!
          </h2>
          <p className="text-muted-foreground mt-2">
            Continue explorando a vida marinha ao seu redor
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {/* Points Card */}
          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                Pontos
              </h3>
              <Zap className="w-4 h-4 text-amber-500"/>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {(user.points || 0).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              +50 por observação
            </p>
          </div>

          {/* Level Card */}
          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                Nível
              </h3>
              <Trophy className="w-4 h-4 text-primary"/>
            </div>
            <p className="text-2xl font-bold text-foreground">{progress.level}</p>
            <p className="text-xs text-muted-foreground mt-1">{title}</p>
          </div>

          {/* Badges Card */}
          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                Badges
              </h3>
              <Award className="w-4 h-4 text-secondary"/>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {unlockedBadges.length}<span className="text-sm font-normal text-muted-foreground">/{badges.length}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {unlockedBadges.length === 0 ? "Registre peixes!" : "Conquistados"}
            </p>
          </div>

          {/* Observations Card */}
          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                Observações
              </h3>
              <Fish className="w-4 h-4 text-primary"/>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {obsCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {obsCount === 0 ? "Comece agora!" : "Registradas"}
            </p>
          </div>
        </div>

        {/* Level Progress Bar */}
        <div className="bg-card rounded-2xl border border-border p-5 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-foreground text-sm">
                Nível {progress.level} — {title}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {progress.remaining > 0
                  ? `Faltam ${progress.remaining} observações para o nível ${progress.level + 1}`
                  : "Nível máximo atingido!"}
              </p>
            </div>
            <span className="text-sm font-bold text-primary">
              {obsCount}/{progress.next}
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
            <div className="bg-gradient-to-r from-primary to-secondary h-full transition-all duration-500 rounded-full" style={{ width: `${progress.progress}%` }}/>
          </div>
        </div>

        {/* Badges Section */}
        <div className="bg-card rounded-2xl border border-border p-5 shadow-sm mb-8">
          <h3 className="font-semibold text-foreground text-sm mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-secondary" />
            Badges
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {badges.map((badge) => (
              <div
                key={badge.id}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  badge.unlocked
                    ? "bg-card border-primary/30 shadow-sm"
                    : "bg-muted/30 border-border opacity-50"
                }`}
              >
                <span className="text-2xl flex-shrink-0">{badge.unlocked ? badge.emoji : "🔒"}</span>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold truncate ${badge.unlocked ? "text-foreground" : "text-muted-foreground"}`}>
                    {badge.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {badge.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Button onClick={() => navigate("/observation")} className="h-16 text-lg bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-semibold rounded-2xl">
            <Plus className="w-6 h-6 mr-2"/>
            Nova Observação
          </Button>
          <Button onClick={() => navigate("/map")} variant="outline" className="h-16 text-lg font-semibold rounded-2xl">
            <MapIcon className="w-6 h-6 mr-2"/>
            Ver Mapa
          </Button>
        </div>

        {/* Recent Activity Section */}
        <div className="mt-12">
          <h3 className="text-xl font-bold text-foreground mb-4">
            Atividade Recente
          </h3>
          {observations.length === 0 ? (<div className="bg-card rounded-2xl border border-border p-8 text-center">
              <Fish className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4"/>
              <p className="text-muted-foreground">
                Nenhuma observação ainda. Comece a explorar!
              </p>
            </div>) : (<div className="space-y-4">
              {observations
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5)
                .map((obs) => (<div key={obs.id} className="bg-card rounded-2xl border border-border p-6 hover:shadow-md transition-shadow">
                    <div className="flex gap-4">
                      {obs.image && (<img src={obs.image} alt={obs.species} className="w-20 h-20 rounded-lg object-cover flex-shrink-0"/>)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-bold text-lg text-foreground">
                            {obs.species}
                          </h4>
                          <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary whitespace-nowrap">
                            {obs.type}
                          </span>
                        </div>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4"/>
                            {obs.date} às {obs.time}
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4"/>
                            {obs.location}
                          </div>
                          {obs.notes && (<p className="mt-2 text-foreground">{obs.notes}</p>)}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Confiança:
                          </span>
                          <span className="text-xs font-semibold capitalize px-2 py-1 rounded bg-secondary/10 text-secondary">
                            {obs.confidence}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>))}
            </div>)}
        </div>
      </div>
    </div>);
}
