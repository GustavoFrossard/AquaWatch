import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, ZoomControl, useMap, useMapEvents, } from "react-leaflet";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, X, Info, Loader2 } from "lucide-react";
import FishDetailModal from "@/components/FishDetailModal";
import { getObservations } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/api";
import { typeColors } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
// Configuração de ícones do Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});
// Componente auxiliar para centralizar o mapa na localização do usuário
function MapCenterController({ latitude, longitude, }) {
    const map = useMap();
    useEffect(() => {
        if (latitude && longitude) {
            map.setView([latitude, longitude], 9, { animate: true });
        }
    }, [latitude, longitude, map]);
    return null;
}
function MapResizeController() {
    const map = useMap();
    useEffect(() => {
        const invalidate = () => map.invalidateSize({ animate: false });
        const timeoutId = window.setTimeout(invalidate, 0);
        const container = map.getContainer();
        const resizeObserver = new ResizeObserver(invalidate);
        resizeObserver.observe(container);
        window.addEventListener("resize", invalidate);
        window.addEventListener("orientationchange", invalidate);
        return () => {
            window.clearTimeout(timeoutId);
            resizeObserver.disconnect();
            window.removeEventListener("resize", invalidate);
            window.removeEventListener("orientationchange", invalidate);
        };
    }, [map]);
    return null;
}
// Tracks map zoom for marker sizing
function ZoomTracker({ onZoomChange }) {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
  });
  useEffect(() => onZoomChange(map.getZoom()), [map, onZoomChange]);
  return null;
}
// Criar ícone customizado para observações
function createObservationIcon(type) {
    const colors = typeColors[type] || typeColors.Other;
    const emoji = type === "Observação" ? "🐟" : "📍";
    return L.divIcon({
        html: `
      <div style="
        background-color: ${colors.bgColor};
        border: 3px solid ${colors.color};
        border-radius: 50%;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 14px;
        color: ${colors.color};
      ">
        ${emoji}
      </div>
    `,
        className: "custom-icon",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -15],
    });
}
export default function MapPage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [userLocation, setUserLocation] = useState(null);
    const [observations, setObservations] = useState([]);
    const [fishPoints, setFishPoints] = useState([]);
    const [fishLoading, setFishLoading] = useState(false);
    const [fishLoaded, setFishLoaded] = useState(false);
    // Filtros removidos
    const [loading, setLoading] = useState(true);
    // Filtros removidos
    const [mapZoom, setMapZoom] = useState(10);
    const [selectedFish, setSelectedFish] = useState(null);
    const [loadingFishDetail, setLoadingFishDetail] = useState(false);
    const fishRenderer = useMemo(() => L.canvas({ padding: 0.2 }), []);
    const isCoarsePointer = useMemo(() => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
      }
      return window.matchMedia("(pointer: coarse)").matches;
    }, []);
    useEffect(() => {
        // Carrega observações salvas da API
        getObservations()
            .then((result) => setObservations(result.observations || []))
            .catch(() => setObservations([]));
        // Check if native coords were passed via URL params (from mobile app)
        // Save to localStorage so they persist across internal navigation
        const params = new URLSearchParams(window.location.search);
        const paramLat = parseFloat(params.get("nativeLat"));
        const paramLng = parseFloat(params.get("nativeLng"));

        if (!isNaN(paramLat) && !isNaN(paramLng)) {
            localStorage.setItem("nativeCoords", JSON.stringify({ latitude: paramLat, longitude: paramLng }));
        }

        const stored = localStorage.getItem("nativeCoords");
        const nativeCoords = stored ? JSON.parse(stored) : null;

        if (nativeCoords && !isNaN(nativeCoords.latitude) && !isNaN(nativeCoords.longitude)) {
            // Use native coords from mobile app
            setUserLocation(nativeCoords);
            setLoading(false);
        } else if (navigator.geolocation) {
            // Fallback to browser geolocation
            navigator.geolocation.getCurrentPosition((position) => {
                const { latitude, longitude } = position.coords;
                setUserLocation({ latitude, longitude });
                setLoading(false);
            }, (error) => {
                console.error("Erro ao obter localização:", error);
                const defaultLat = 37.7749;
                const defaultLng = -122.4194;
                setUserLocation({ latitude: defaultLat, longitude: defaultLng });
                setLoading(false);
            });
        }
        else {
            const defaultLat = 37.7749;
            const defaultLng = -122.4194;
            setUserLocation({ latitude: defaultLat, longitude: defaultLng });
            setLoading(false);
        }
    }, []);
    // Filtros removidos
    // Load fish once based on user location (200 km radius)
    useEffect(() => {
      if (!userLocation || fishLoaded) return;

      const controller = new AbortController();
      setFishLoading(true);

      (async () => {
        try {
          const url = `${API_BASE_URL}/api/obis/fish/nearby?lat=${userLocation.latitude}&lng=${userLocation.longitude}&radius=200`;
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) return;
          const data = await response.json();
          setFishPoints(Array.isArray(data?.points) ? data.points : []);
          setFishLoaded(true);
        } catch { /* aborted or failed */ }
        finally { setFishLoading(false); }
      })();

      return () => controller.abort();
    }, [userLocation, fishLoaded]);

    const renderedFishPoints = useMemo(() => {
      if (fishPoints.length === 0) return fishPoints;

      const zoom = mapZoom;
      const maxPoints = zoom <= 6 ? 1800 : zoom <= 9 ? 3200 : zoom <= 12 ? 5500 : 9000;
      const grid = zoom <= 6 ? 0.06 : zoom <= 9 ? 0.03 : zoom <= 12 ? 0.015 : 0.0;

      if (grid <= 0 && fishPoints.length <= maxPoints) return fishPoints;
      if (grid <= 0) return fishPoints.slice(0, maxPoints);

      const cells = new Set();
      const result = [];
      for (const point of fishPoints) {
        const key = `${Math.floor(point.lat / grid)}:${Math.floor(point.lng / grid)}`;
        if (cells.has(key)) continue;
        cells.add(key);
        result.push(point);
        if (result.length >= maxPoints) break;
      }
      return result;
    }, [fishPoints, mapZoom]);

    const fishMarkerStyle = useMemo(() => {
      const zoom = mapZoom;
      const baseRadius = zoom <= 6 ? 4 : zoom <= 9 ? 5 : zoom <= 12 ? 6 : 7;
      const radius = isCoarsePointer ? baseRadius + 2 : baseRadius;

      return {
        radius,
        color: "#1d4ed8",
        fillColor: "#3b82f6",
        fillOpacity: 0.9,
        weight: 1,
      };
    }, [isCoarsePointer, mapZoom]);
    // Exibir todas as observações sem filtro
    const filteredObservations = observations;
    if (loading || !userLocation) {
        return (<div className="w-screen h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin mb-4">
            <MapPin className="w-12 h-12 text-primary mx-auto"/>
          </div>
          <p className="text-lg font-semibold text-foreground">
            Localizando você...
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Por favor, aguarde
          </p>
        </div>
      </div>);
    }
    return (<>
      {/* Unified View (Mobile + Desktop) */}
      <div className="w-screen h-screen relative bg-background">
        {/* Mapa Fullscreen */}
        <div className="w-full h-full relative">
          <MapContainer center={[userLocation.latitude, userLocation.longitude]} zoom={9} zoomControl={false} preferCanvas style={{ width: "100%", height: "100%" }}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
            <ZoomControl position="topright" />

            {/* Círculo de 200 km de raio */}
            <Circle center={[userLocation.latitude, userLocation.longitude]} radius={200000} pathOptions={{
            color: "rgba(59, 130, 246, 0.25)",
            fillColor: "rgba(59, 130, 246, 0.05)",
            weight: 2,
            dashArray: "8 4",
        }}/>

            {/* Marcador da localização do usuário */}
            <Marker position={[userLocation.latitude, userLocation.longitude]} icon={L.icon({
            iconUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iOCIgZmlsbD0iIzNiODJmNiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjQiIGZpbGw9IiNmZmYiLz48L3N2Zz4=",
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -16],
        })}>
              <Popup>
                <div className="p-2">
                  <p className="font-semibold text-sm">Sua Localização</p>
                  <p className="text-xs text-muted-foreground">
                    {userLocation.latitude.toFixed(4)}, 
                    {userLocation.longitude.toFixed(4)}
                  </p>
                </div>
              </Popup>
            </Marker>

            {/* Marcadores das observações registradas */}
            {filteredObservations.map((obs) => (<Marker key={obs.id} position={[obs.latitude, obs.longitude]} icon={createObservationIcon(obs.type)}>
                <Popup>
                  <div className="p-2 max-w-xs">
                    {obs.image && (<img src={obs.image} alt={obs.species} className="w-full h-24 object-cover rounded mb-2"/>)}
                    {obs.nomeComum ? (
                      <p className="font-semibold text-xs">{obs.nomeComum}</p>
                    ) : (
                      <p className="font-semibold text-xs">{obs.species}</p>
                    )}
                    {obs.nomeCientifico && (
                      <p className="text-xs text-muted-foreground italic">{obs.nomeCientifico}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1 mb-2">
                      {obs.date} às {obs.time}
                    </p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{
                backgroundColor: typeColors[obs.type]?.color,
            }}>
                        {obs.type}
                      </span>
                      {obs.confidence && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">
                          {obs.confidence}
                        </span>
                      )}
                    </div>
                    {obs.descricao && (
                      <p className="text-xs text-foreground line-clamp-2 mb-2">{obs.descricao}</p>
                    )}
                    {obs.notes && (<p className="text-xs text-foreground line-clamp-2">
                        {obs.notes}
                      </p>)}
                    {obs.nomeCientifico && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFish({
                            scientificName: obs.nomeCientifico,
                            commonName: obs.nomeComum,
                            preloadedData: {
                              commonName: obs.nomeComum,
                              imageUrl: obs.image,
                              descricao: obs.descricao,
                              tamanho: obs.tamanho,
                              habitat: obs.habitat,
                              alimentacao: obs.alimentacao,
                              conservacao: obs.conservacao,
                              conservacao_detalhe: obs.conservacao_detalhe,
                              curiosidade: obs.curiosidade,
                            },
                          });
                        }}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 bg-primary text-white text-xs font-medium py-1.5 px-3 rounded-lg hover:bg-primary/90 active:scale-95 transition-all"
                      >
                        <Info className="w-3.5 h-3.5" />
                        Saber mais
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>))}

            {/* Pontos de peixes (OBIS) */}
            {renderedFishPoints.map((fish) => (<CircleMarker key={fish.id} center={[fish.lat, fish.lng]} radius={fishMarkerStyle.radius} renderer={fishRenderer} pathOptions={{
                color: fishMarkerStyle.color,
                fillColor: fishMarkerStyle.fillColor,
                fillOpacity: fishMarkerStyle.fillOpacity,
                weight: fishMarkerStyle.weight,
              }}>
                <Popup>
                  <div className="p-2 max-w-xs">
                    {fish.commonName ? (<p className="font-semibold text-xs">
                        {fish.commonName}
                      </p>) : null}
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      {fish.scientificName || "Nome científico indisponível"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Origem: {fish.source || "Fonte não informada"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {fish.lat.toFixed(4)}, {fish.lng.toFixed(4)}
                    </p>
                    {fish.scientificName && fish.scientificName !== "Fish" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLoadingFishDetail(true);
                          setSelectedFish(fish);
                        }}
                        disabled={loadingFishDetail}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 bg-primary text-white text-xs font-medium py-1.5 px-3 rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-70"
                      >
                        {loadingFishDetail && selectedFish?.scientificName === fish.scientificName ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Carregando…
                          </>
                        ) : (
                          <>
                            <Info className="w-3.5 h-3.5" />
                            Saber mais
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </Popup>
              </CircleMarker>))}

            <MapCenterController latitude={userLocation.latitude} longitude={userLocation.longitude}/>
            <MapResizeController />
            <ZoomTracker onZoomChange={setMapZoom}/>
          </MapContainer>

          {/* Botão Voltar Mobile */}
          <div className="absolute top-4 left-4 z-[999]">
            <Button variant="ghost" size="icon" onClick={() => navigate("/home")} className="bg-white/90 backdrop-blur-md hover:bg-white shadow-lg rounded-full w-10 h-10">
              <ArrowLeft className="w-5 h-5 text-foreground"/>
            </Button>
          </div>

          {/* Filtros removidos do mapa */}
        </div>

        {/* Fish detail modal */}
        {selectedFish && (
          <FishDetailModal
            scientificName={selectedFish.scientificName}
            commonName={selectedFish.commonName}
            preloadedData={selectedFish.preloadedData}
            onClose={() => { setSelectedFish(null); setLoadingFishDetail(false); }}
            onLoaded={() => setLoadingFishDetail(false)}
          />
        )}
      </div>
    </>);
}
