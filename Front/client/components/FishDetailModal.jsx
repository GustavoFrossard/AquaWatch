import { useEffect, useState } from "react";
import { X, Fish, Ruler, MapPin, Utensils, ShieldAlert, Lightbulb, ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { API_BASE_URL } from "@/lib/api";
import { conservationColor } from "@/lib/constants";

/**
 * Full-screen modal showing detailed fish species information.
 * Designed mobile-first — slides up from bottom.
 *
 * Props:
 *   scientificName  — species scientific name (required to fetch)
 *   commonName      — already-known common name (shown immediately)
 *   onClose         — callback to close the modal
 */
export default function FishDetailModal({ scientificName, commonName, onClose, onLoaded, preloadedData }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [fetchKey, setFetchKey] = useState(0); // bump to force re-fetch

  useEffect(() => {
    // If we already have all data (e.g. user observation), skip fetch
    if (preloadedData) {
      setData(preloadedData);
      setLoading(false);
      onLoaded?.();
      return;
    }

    if (!scientificName) return;

    setLoading(true);
    setError(false);
    setData(null);

    const controller = new AbortController();

    fetch(`${API_BASE_URL}/api/obis/species/${encodeURIComponent(scientificName)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then((result) => {
        setData(result);
        setLoading(false);
        onLoaded?.();
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(true);
          setLoading(false);
          onLoaded?.();
        }
      });

    return () => controller.abort();
  }, [scientificName, fetchKey]);

  const displayName = data?.commonName || data?.nomeComum || commonName;
  const imgUrl = data?.imageUrl || data?.image;

  // ── Full-screen loading overlay (hides everything behind) ──
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background animate-in fade-in duration-200">
        {/* Close button even during loading */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 bg-muted text-muted-foreground rounded-full p-2 hover:bg-muted/80 transition-colors z-10"
          aria-label="Fechar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <Fish className="w-10 h-10 text-primary/40 animate-pulse" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">Carregando informações</p>
            <p className="text-xs text-muted-foreground mt-1 italic">{scientificName}</p>
          </div>
          {/* Subtle animated dots */}
          <div className="flex gap-1.5 mt-1">
            <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-background animate-in fade-in duration-300">
      {/* Header — sticky */}
      <div className="flex-shrink-0 relative">
        {/* Image or placeholder */}
        <div className="relative w-full h-56 sm:h-72 bg-muted overflow-hidden">
          {imgUrl && !imgError ? (
            <img
              src={imgUrl}
              alt={displayName || scientificName}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
              <Fish className="w-20 h-20 text-primary/30" />
              <span className="text-sm text-muted-foreground mt-2">Sem imagem disponível</span>
            </div>
          )}

          {/* Gradient overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Back / close button */}
          <button
            onClick={onClose}
            className="absolute top-4 left-4 bg-black/40 backdrop-blur-sm text-white rounded-full p-2 hover:bg-black/60 transition-colors"
            aria-label="Fechar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Names overlay on image */}
          <div className="absolute bottom-4 left-4 right-4">
            {displayName && (
              <h1 className="text-xl font-bold text-white drop-shadow-lg leading-tight">
                {displayName}
              </h1>
            )}
            <p className="text-sm text-white/80 italic drop-shadow-md mt-0.5">
              {scientificName}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 overflow-auto">
        <div className="px-4 py-5 pb-8 space-y-5">
          {error ? (
            <div className="text-center py-12">
              <Fish className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                Não foi possível carregar as informações.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setFetchKey((k) => k + 1)}
              >
                Tentar novamente
              </Button>
            </div>
          ) : (
            <>
              {/* Check if we actually have any Gemini-provided info */}
              {(() => {
                const hasInfo = data?.descricao || data?.tamanho || data?.habitat ||
                  data?.alimentacao || data?.conservacao || data?.curiosidade;
                if (!hasInfo) {
                  return (
                    <div className="text-center py-8">
                      <Fish className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Informações detalhadas temporariamente indisponíveis.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => setFetchKey((k) => k + 1)}
                      >
                        Tentar novamente
                      </Button>
                    </div>
                  );
                }
                return null;
              })()}
              {/* Conservation badge — prominent */}
              {data?.conservacao && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-card border border-border shadow-sm">
                  <ShieldAlert className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Conservação
                      </span>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${conservationColor(data.conservacao)}`}
                      >
                        {data.conservacao}
                      </span>
                    </div>
                    {data.conservacao_detalhe && (
                      <p className="text-sm text-foreground mt-2 leading-relaxed">
                        {data.conservacao_detalhe}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Description */}
              {data?.descricao && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <Fish className="w-4 h-4 text-primary" />
                    Sobre
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {data.descricao}
                  </p>
                </div>
              )}

              {/* Quick facts grid — only if at least one fact exists */}
              {(data?.tamanho || data?.habitat || data?.alimentacao || data?.curiosidade) && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3">
                    {data?.tamanho && (
                      <InfoCard
                        icon={<Ruler className="w-4 h-4" />}
                        label="Tamanho"
                        value={data.tamanho}
                      />
                    )}
                    {data?.habitat && (
                      <InfoCard
                        icon={<MapPin className="w-4 h-4" />}
                        label="Habitat"
                        value={data.habitat}
                      />
                    )}
                    {data?.alimentacao && (
                      <InfoCard
                        icon={<Utensils className="w-4 h-4" />}
                        label="Alimentação"
                        value={data.alimentacao}
                      />
                    )}
                    {data?.curiosidade && (
                      <InfoCard
                        icon={<Lightbulb className="w-4 h-4" />}
                        label="Curiosidade"
                        value={data.curiosidade}
                        span2
                      />
                    )}
                  </div>
                </>
              )}

              <Separator />

              {/* Source link */}
              <div className="flex items-center justify-center gap-2 pt-1">
                <a
                  href={`https://www.marinespecies.org/aphia.php?p=taxlist&tName=${encodeURIComponent(scientificName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary flex items-center gap-1 hover:underline"
                >
                  Ver no WoRMS <ExternalLink className="w-3 h-3" />
                </a>
                <span className="text-muted-foreground text-xs">•</span>
                <a
                  href={`https://obis.org/taxon/${encodeURIComponent(scientificName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary flex items-center gap-1 hover:underline"
                >
                  Ver no OBIS <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/* ---- Helper components ---- */

function InfoCard({ icon, label, value, span2 }) {
  return (
    <div
      className={`p-3 rounded-xl bg-card border border-border shadow-sm ${
        span2 ? "col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 text-primary mb-1">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="text-sm text-foreground leading-snug">{value}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      {/* Animated spinner + text */}
      <div className="flex flex-col items-center justify-center py-6">
        <div className="relative">
          <Fish className="w-10 h-10 text-primary/30 animate-pulse" />
          <Loader2 className="w-6 h-6 text-primary animate-spin absolute -top-1 -right-2" />
        </div>
        <p className="text-sm text-muted-foreground mt-3 animate-pulse">Buscando informações…</p>
      </div>
      {/* Skeleton cards */}
      <div className="p-3 rounded-xl bg-card border border-border">
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4 mt-1" />
      </div>
      <div>
        <Skeleton className="h-4 w-20 mb-2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full mt-1" />
        <Skeleton className="h-3 w-2/3 mt-1" />
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl col-span-2" />
      </div>
    </div>
  );
}
