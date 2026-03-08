import { useNavigate } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { updateUserAfterObservation, getNewlyUnlockedBadges } from "@/lib/gamification";
import {
  ArrowLeft,
  Camera,
  ImageIcon,
  MapPin,
  Calendar,
  CheckCircle,
  Fish,
  Loader2,
  Ruler,
  Utensils,
  ShieldAlert,
  Lightbulb,
  RotateCcw,
  Map as MapIcon,
  Crosshair,
} from "lucide-react";

/**
 * Compress a base64 data-URL image to fit within maxDimension px and quality.
 * Returns a Promise<string> with a smaller data URL (JPEG).
 */
function compressImage(dataUrl, maxDimension = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback to original on error
    img.src = dataUrl;
  });
}

// Fix leaflet default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

export default function CreateObservationPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef(null);

  const [user, setUser] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [identifying, setIdentifying] = useState(false);
  const [identified, setIdentified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [showImageOptions, setShowImageOptions] = useState(false);
  const cameraInputRef = useRef(null);

  const [formData, setFormData] = useState({
    nomeCientifico: "",
    nomeComum: "",
    descricao: "",
    tamanho: "",
    habitat: "",
    alimentacao: "",
    conservacao: "",
    conservacao_detalhe: "",
    curiosidade: "",
    confianca: "",
    latitude: null,
    longitude: null,
    location: "",
    date: new Date().toLocaleDateString("pt-BR"),
    time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    notes: "",
    image: "",
  });

  // Auth check
  useEffect(() => {
    const session = localStorage.getItem("userSession");
    if (!session) {
      navigate("/auth");
    } else {
      setUser(JSON.parse(session));
    }
  }, [navigate]);

  // Auto-fill location on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nativeLat = parseFloat(params.get("nativeLat")) || parseFloat(localStorage.getItem("nativeLat"));
    const nativeLng = parseFloat(params.get("nativeLng")) || parseFloat(localStorage.getItem("nativeLng"));

    if (nativeLat && nativeLng) {
      setFormData((prev) => ({
        ...prev,
        latitude: nativeLat,
        longitude: nativeLng,
        location: `${nativeLat.toFixed(4)}, ${nativeLng.toFixed(4)}`,
      }));
      return;
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormData((prev) => ({
            ...prev,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            location: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
          }));
        },
        () => {}
      );
    }
  }, []);

  // ── Image upload → Gemini identification ──
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result;
      setImagePreview(base64);
      setFormData((prev) => ({ ...prev, image: base64 }));

      setIdentifying(true);
      setIdentified(false);

      try {
        // Compress image before sending to avoid large payload timeouts
        const compressed = await compressImage(base64, 800, 0.7);

        const browserHost = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
        const apiBase =
          import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
          `http://${browserHost}:4000`;

        const res = await fetch(`${apiBase}/api/obis/identify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: compressed }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || "Erro na identificação");
        }

        const result = await res.json();

        if (result.erro) {
          toast({
            title: "Não foi possível identificar",
            description: result.erro,
            variant: "destructive",
          });
          setIdentifying(false);
          return;
        }

        setFormData((prev) => ({
          ...prev,
          nomeCientifico: result.nomeCientifico || "",
          nomeComum: result.nomeComum || "",
          descricao: result.descricao || "",
          tamanho: result.tamanho || "",
          habitat: result.habitat || "",
          alimentacao: result.alimentacao || "",
          conservacao: result.conservacao || "",
          conservacao_detalhe: result.conservacao_detalhe || "",
          curiosidade: result.curiosidade || "",
          confianca: result.confianca || "",
        }));
        setIdentified(true);
        toast({
          title: "Espécie identificada!",
          description: `${result.nomeComum || result.nomeCientifico || "Peixe"} — informações preenchidas automaticamente.`,
        });
      } catch (err) {
        toast({
          title: "Erro na identificação",
          description: err.message || "Tente novamente",
          variant: "destructive",
        });
      } finally {
        setIdentifying(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImagePreview(null);
    setIdentified(false);
    setFormData((prev) => ({
      ...prev,
      image: "",
      nomeCientifico: "",
      nomeComum: "",
      descricao: "",
      tamanho: "",
      habitat: "",
      alimentacao: "",
      conservacao: "",
      conservacao_detalhe: "",
      curiosidade: "",
      confianca: "",
    }));
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  const conservationColor = (status) => {
    if (!status) return "bg-gray-100 text-gray-700";
    const s = status.toLowerCase();
    if (s.includes("criticamente")) return "bg-red-600 text-white";
    if (s.includes("perigo")) return "bg-red-500 text-white";
    if (s.includes("vulnerável")) return "bg-orange-500 text-white";
    if (s.includes("quase")) return "bg-yellow-500 text-white";
    if (s.includes("pouco preocupante")) return "bg-green-600 text-white";
    if (s.includes("dados")) return "bg-gray-400 text-white";
    return "bg-blue-100 text-blue-800";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.nomeCientifico) {
      toast({
        title: "Foto necessária",
        description: "Tire uma foto do peixe para identificar a espécie.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      // Compress image for localStorage (keep original quality for display)
      let storedImage = formData.image;
      if (storedImage) {
        try {
          storedImage = await compressImage(storedImage, 600, 0.6);
        } catch {
          // If compression fails, skip the image to avoid localStorage overflow
          storedImage = "";
        }
      }

      const observation = {
        id: Math.random().toString(36).substr(2, 9),
        userId: user?.id || "",
        ...formData,
        image: storedImage,
        type: "Observação",
        species: formData.nomeComum || formData.nomeCientifico || "Espécie desconhecida",
        confidence: formData.confianca || "Não avaliado",
        timestamp: Date.now(),
      };

      const observations = JSON.parse(localStorage.getItem("observations") || "[]");
      observations.push(observation);

      try {
        localStorage.setItem("observations", JSON.stringify(observations));
      } catch (storageErr) {
        // localStorage full — try without image
        console.warn("localStorage full, saving without image", storageErr);
        observation.image = "";
        observations[observations.length - 1] = observation;
        localStorage.setItem("observations", JSON.stringify(observations));
      }

      if (user) {
        const newObsCount = observations.length;
        const oldObsCount = newObsCount - 1;
        const updatedUser = updateUserAfterObservation(user, newObsCount);
        localStorage.setItem("userSession", JSON.stringify(updatedUser));
        setUser(updatedUser);

        // Check for newly unlocked badges
        const newBadges = getNewlyUnlockedBadges(oldObsCount, newObsCount);
        if (newBadges.length > 0) {
          const badgeNames = newBadges.map((b) => `${b.emoji} ${b.name}`).join(", ");
          setTimeout(() => {
            toast({
              title: "🏆 Novo badge desbloqueado!",
              description: badgeNames,
            });
          }, 600);
        }
      }

      toast({
        title: "Observação registrada!",
        description: `${formData.nomeComum || formData.nomeCientifico} salva. +50 pontos!`,
      });
      setTimeout(() => navigate("/home"), 1200);
    } catch (err) {
      console.error("Save error:", err);
      toast({
        title: "Erro ao salvar",
        description: "Não foi possível salvar a observação. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5">
      {/* Header */}
      <div className="bg-card/80 backdrop-blur-md border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Nova Observação</h1>
            <p className="text-sm text-muted-foreground">
              Fotografe o peixe para identificação automática
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Photo upload ── */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <label className="block text-sm font-semibold text-foreground mb-3">
              <Camera className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Foto do peixe <span className="text-destructive">*</span>
            </label>

            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="w-full h-56 object-cover rounded-xl"
                />
                {identifying && (
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                      <Fish className="w-8 h-8 text-white animate-pulse" />
                    </div>
                    <p className="text-sm font-medium text-white">Identificando espécie…</p>
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                )}
                {!identifying && (
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute top-2 right-2 bg-destructive text-white p-2 rounded-full hover:bg-destructive/90 transition-colors"
                  >
                    ✕
                  </button>
                )}
                {identified && !identifying && (
                  <div className="absolute bottom-2 left-2 bg-green-600 text-white text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Espécie identificada
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Two option buttons: Camera and Gallery */}
                <div className="flex flex-col items-center justify-center w-full h-56 border-2 border-dashed border-primary/30 rounded-xl bg-primary/5">
                  <Fish className="w-12 h-12 text-primary/40 mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    Fotografe ou selecione uma imagem
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    A espécie será identificada automaticamente
                  </p>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 bg-primary text-white text-sm font-medium px-4 py-2.5 rounded-xl cursor-pointer hover:bg-primary/90 active:scale-95 transition-all shadow-md">
                      <Camera className="w-4 h-4" />
                      Câmera
                      <input
                        ref={cameraInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={handleImageUpload}
                      />
                    </label>
                    <label className="flex items-center gap-2 bg-secondary text-white text-sm font-medium px-4 py-2.5 rounded-xl cursor-pointer hover:bg-secondary/90 active:scale-95 transition-all shadow-md">
                      <ImageIcon className="w-4 h-4" />
                      Galeria
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleImageUpload}
                      />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Identified species info ── */}
          {identified && formData.nomeCientifico && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Species names */}
              <div className="bg-card rounded-2xl border border-border p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Espécie identificada
                  </label>
                  <button
                    type="button"
                    onClick={clearImage}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Refazer
                  </button>
                </div>
                <div className="space-y-3">
                  <EditField
                    label="Nome comum"
                    value={formData.nomeComum}
                    onChange={(v) => setFormData((p) => ({ ...p, nomeComum: v }))}
                    placeholder="Nome popular (ex: Mero)"
                  />
                  <EditField
                    label="Nome científico"
                    value={formData.nomeCientifico}
                    onChange={(v) => setFormData((p) => ({ ...p, nomeCientifico: v }))}
                    placeholder="Nome científico"
                    italic
                  />
                  {formData.confianca && (
                    <span className={`inline-block text-xs font-medium px-2.5 py-0.5 rounded-full ${
                      formData.confianca.toLowerCase().includes("alta")
                        ? "bg-green-100 text-green-700"
                        : formData.confianca.toLowerCase().includes("media") || formData.confianca.toLowerCase().includes("média")
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-red-100 text-red-700"
                    }`}>
                      Confiança da IA: {formData.confianca}
                    </span>
                  )}
                </div>
              </div>

              {/* Description */}
              <div className="bg-card rounded-2xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Fish className="w-4 h-4 text-primary" />
                  Sobre
                </h3>
                <EditArea
                  value={formData.descricao}
                  onChange={(v) => setFormData((p) => ({ ...p, descricao: v }))}
                  placeholder="Descrição da espécie…"
                  rows={3}
                />
              </div>

              {/* Conservation */}
              <div className="bg-card rounded-2xl border border-border p-5">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Conservação
                  </span>
                  {formData.conservacao && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${conservationColor(formData.conservacao)}`}>
                      {formData.conservacao}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  <EditField
                    label="Status"
                    value={formData.conservacao}
                    onChange={(v) => setFormData((p) => ({ ...p, conservacao: v }))}
                    placeholder="Status IUCN (ex: Pouco preocupante)"
                  />
                  <EditArea
                    value={formData.conservacao_detalhe}
                    onChange={(v) => setFormData((p) => ({ ...p, conservacao_detalhe: v }))}
                    placeholder="Detalhes sobre conservação…"
                    rows={2}
                  />
                </div>
              </div>

              {/* Quick facts — editable */}
              <div className="grid grid-cols-2 gap-3">
                <EditableFactCard
                  icon={<Ruler className="w-4 h-4" />}
                  label="Tamanho"
                  value={formData.tamanho}
                  onChange={(v) => setFormData((p) => ({ ...p, tamanho: v }))}
                  placeholder="Ex: 30-60 cm"
                />
                <EditableFactCard
                  icon={<MapPin className="w-4 h-4" />}
                  label="Habitat"
                  value={formData.habitat}
                  onChange={(v) => setFormData((p) => ({ ...p, habitat: v }))}
                  placeholder="Ex: Recifes de coral"
                />
                <EditableFactCard
                  icon={<Utensils className="w-4 h-4" />}
                  label="Alimentação"
                  value={formData.alimentacao}
                  onChange={(v) => setFormData((p) => ({ ...p, alimentacao: v }))}
                  placeholder="Ex: Peixes e crustáceos"
                />
                <EditableFactCard
                  icon={<Lightbulb className="w-4 h-4" />}
                  label="Curiosidade"
                  value={formData.curiosidade}
                  onChange={(v) => setFormData((p) => ({ ...p, curiosidade: v }))}
                  placeholder="Fato interessante…"
                  span2
                />
              </div>

              <Separator />
            </div>
          )}

          {/* ── Location (editable + map picker) ── */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <label className="block text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-primary" />
              Localização
            </label>

            {/* Coordinate inputs */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Latitude</label>
                <input
                  type="number"
                  step="0.0001"
                  value={formData.latitude ?? ""}
                  onChange={(e) => {
                    const lat = parseFloat(e.target.value);
                    setFormData((p) => ({
                      ...p,
                      latitude: isNaN(lat) ? null : lat,
                      location: isNaN(lat) ? p.location : `${lat.toFixed(4)}, ${(p.longitude ?? 0).toFixed(4)}`,
                    }));
                  }}
                  placeholder="-23.5505"
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Longitude</label>
                <input
                  type="number"
                  step="0.0001"
                  value={formData.longitude ?? ""}
                  onChange={(e) => {
                    const lng = parseFloat(e.target.value);
                    setFormData((p) => ({
                      ...p,
                      longitude: isNaN(lng) ? null : lng,
                      location: isNaN(lng) ? p.location : `${(p.latitude ?? 0).toFixed(4)}, ${lng.toFixed(4)}`,
                    }));
                  }}
                  placeholder="-46.6333"
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* Open map picker button */}
            <button
              type="button"
              onClick={() => setShowMapPicker(true)}
              className="w-full flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              <MapIcon className="w-4 h-4" />
              Escolher no mapa
            </button>

            {formData.latitude && formData.longitude && (
              <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                {formData.latitude.toFixed(4)}, {formData.longitude.toFixed(4)}
              </p>
            )}
          </div>

          {/* Map picker modal */}
          {showMapPicker && (
            <LocationPickerModal
              lat={formData.latitude}
              lng={formData.longitude}
              onConfirm={(lat, lng) => {
                setFormData((p) => ({
                  ...p,
                  latitude: lat,
                  longitude: lng,
                  location: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                }));
                setShowMapPicker(false);
              }}
              onClose={() => setShowMapPicker(false)}
            />
          )}

          {/* ── Date & Time (auto-filled) ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-card rounded-2xl border border-border p-5">
              <label className="block text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-primary" />
                Data
              </label>
              <div className="flex items-center gap-2 text-sm text-foreground bg-muted/50 px-3 py-2.5 rounded-lg">
                <span>{formData.date}</span>
                <CheckCircle className="w-3.5 h-3.5 text-green-600 ml-auto flex-shrink-0" />
              </div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-5">
              <label className="block text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                🕒 Hora
              </label>
              <div className="flex items-center gap-2 text-sm text-foreground bg-muted/50 px-3 py-2.5 rounded-lg">
                <span>{formData.time}</span>
                <CheckCircle className="w-3.5 h-3.5 text-green-600 ml-auto flex-shrink-0" />
              </div>
            </div>
          </div>

          {/* ── Notes ── */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <label className="block text-sm font-semibold text-foreground mb-2">
              Observações adicionais
            </label>
            <textarea
              placeholder="Comportamento, condições da água, detalhes extras…"
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* ── Submit ── */}
          <Button
            type="submit"
            disabled={submitting || identifying || !formData.nomeCientifico}
            className="w-full h-12 bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-semibold text-base rounded-2xl disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Salvando…
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Registrar Observação
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ---- Location Picker Modal ---- */
function LocationPickerModal({ lat, lng, onConfirm, onClose }) {
  const defaultLat = lat ?? -23.55;
  const defaultLng = lng ?? -46.63;
  const [pin, setPin] = useState({ lat: defaultLat, lng: defaultLng });

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-background animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-semibold text-foreground">Escolher localização</span>
        <button
          type="button"
          onClick={() => onConfirm(pin.lat, pin.lng)}
          className="bg-primary text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
        >
          Confirmar
        </button>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={[defaultLat, defaultLng]}
          zoom={13}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={[pin.lat, pin.lng]} />
          <MapClickHandler onMove={(latlng) => setPin({ lat: latlng.lat, lng: latlng.lng })} />
        </MapContainer>

        {/* Crosshair hint */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full pointer-events-none flex items-center gap-1.5">
          <Crosshair className="w-3.5 h-3.5" />
          Toque no mapa para marcar
        </div>

        {/* Coordinates display */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-sm border border-border text-sm px-4 py-2 rounded-xl shadow-lg">
          <span className="font-mono text-foreground">
            {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* Map click handler sub-component */
function MapClickHandler({ onMove }) {
  useMapEvents({
    click(e) {
      onMove(e.latlng);
    },
  });
  return null;
}

function EditField({ label, value, onChange, placeholder, italic }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary ${italic ? "italic" : ""}`}
      />
    </div>
  );
}

function EditArea({ value, onChange, placeholder, rows = 2 }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none leading-relaxed"
    />
  );
}

function EditableFactCard({ icon, label, value, onChange, placeholder, span2 }) {
  return (
    <div className={`bg-card rounded-2xl border border-border p-4 ${span2 ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-1.5 text-primary mb-1.5">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}
