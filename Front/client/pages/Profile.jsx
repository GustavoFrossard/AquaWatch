import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, User as UserIcon, Trophy, Zap, Fish, Award, MapPin, Calendar, Star } from "lucide-react";
import { computeLevel, levelProgress, getAllBadges, levelTitle, getUnlockedBadgeIds } from "@/lib/gamification";
import { getObservations, getObservationStats } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";

export default function ProfilePage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [observations, setObservations] = useState([]);
    const [stats, setStats] = useState({ total: 0, uniqueSpecies: 0 });

    useEffect(() => {
      Promise.all([getObservations(), getObservationStats()])
        .then(([obsResult, statsResult]) => {
          setObservations(obsResult.observations || []);
          setStats(statsResult);
        })
        .catch(() => setObservations([]));
    }, []);

    if (!user) return null;

    const obsCount = stats.total;
    const progress = levelProgress(obsCount);
    const badges = getAllBadges(obsCount);
    const unlockedBadges = badges.filter((b) => b.unlocked);
    const title = levelTitle(progress.level);

    // Next badge
    const nextBadge = badges.find((b) => !b.unlocked);

    // Species diversity
    const uniqueSpecies = stats.uniqueSpecies;

    return (<div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5 pb-8">
      {/* Header */}
      <div className="bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
            <ArrowLeft className="w-5 h-5"/>
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Perfil</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* User Card */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-secondary mx-auto flex items-center justify-center mb-3">
            <UserIcon className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-xl font-bold text-foreground">{user.username}</h2>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <div className="mt-3 inline-flex items-center gap-1.5 bg-primary/10 text-primary text-sm font-semibold px-3 py-1 rounded-full">
            <Trophy className="w-3.5 h-3.5" />
            Nível {progress.level} — {title}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card rounded-2xl border border-border p-4 shadow-sm text-center">
            <Zap className="w-5 h-5 text-amber-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-foreground">{(user.points || 0).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Pontos</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4 shadow-sm text-center">
            <Fish className="w-5 h-5 text-primary mx-auto mb-1" />
            <p className="text-xl font-bold text-foreground">{obsCount}</p>
            <p className="text-[10px] text-muted-foreground">Observações</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4 shadow-sm text-center">
            <Star className="w-5 h-5 text-secondary mx-auto mb-1" />
            <p className="text-xl font-bold text-foreground">{uniqueSpecies}</p>
            <p className="text-[10px] text-muted-foreground">Espécies</p>
          </div>
        </div>

        {/* Level Progress */}
        <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              Progresso do Nível
            </h3>
            <span className="text-sm font-bold text-primary">
              {obsCount}/{progress.next}
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden mb-2">
            <div
              className="bg-gradient-to-r from-primary to-secondary h-full transition-all duration-500 rounded-full"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress.remaining > 0
              ? `Faltam ${progress.remaining} observações para o nível ${progress.level + 1}`
              : "Continue registrando para subir ainda mais!"}
          </p>
        </div>

        {/* Badges */}
        <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
          <h3 className="font-semibold text-foreground text-sm mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-secondary" />
            Badges ({unlockedBadges.length}/{badges.length})
          </h3>
          <div className="space-y-3">
            {badges.map((badge) => (
              <div
                key={badge.id}
                className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${
                  badge.unlocked
                    ? "bg-card border-primary/20 shadow-sm"
                    : "bg-muted/20 border-border opacity-50"
                }`}
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-2xl ${
                  badge.unlocked ? "bg-primary/10" : "bg-muted"
                }`}>
                  {badge.unlocked ? badge.emoji : "🔒"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${badge.unlocked ? "text-foreground" : "text-muted-foreground"}`}>
                    {badge.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {badge.description}
                  </p>
                </div>
                {badge.unlocked && (
                  <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full flex-shrink-0">
                    ✓
                  </span>
                )}
                {!badge.unlocked && (
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                    {badge.threshold} obs.
                  </span>
                )}
              </div>
            ))}
          </div>
          {nextBadge && (
            <div className="mt-4 p-3 bg-primary/5 rounded-xl border border-primary/10">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Próximo badge:</span>{" "}
                {nextBadge.emoji} {nextBadge.name} — faltam {nextBadge.threshold - obsCount} observações
              </p>
            </div>
          )}
        </div>

        {/* Recent Observations */}
        {observations.length > 0 && (
          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <h3 className="font-semibold text-foreground text-sm mb-4 flex items-center gap-2">
              <Fish className="w-4 h-4 text-primary" />
              Últimas Observações
            </h3>
            <div className="space-y-3">
              {observations
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5)
                .map((obs) => (
                  <div key={obs.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    {obs.image ? (
                      <img src={obs.image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Fish className="w-5 h-5 text-primary/40" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {obs.nomeComum || obs.species || "Espécie"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {obs.date} às {obs.time}
                      </p>
                    </div>
                    <span className="text-xs text-primary font-medium flex-shrink-0">+50 pts</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>);
}
