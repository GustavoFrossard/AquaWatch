import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, ZoomControl, useMap, useMapEvents, } from "react-leaflet";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, X } from "lucide-react";
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
            map.setView([latitude, longitude], 15, { animate: true });
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
function FishViewportController({ onViewportChange }) {
  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      onViewportChange({
        minLng: bounds.getWest(),
        minLat: bounds.getSouth(),
        maxLng: bounds.getEast(),
        maxLat: bounds.getNorth(),
        zoom: map.getZoom(),
      });
    },
  });
  useEffect(() => {
    const bounds = map.getBounds();
    onViewportChange({
      minLng: bounds.getWest(),
      minLat: bounds.getSouth(),
      maxLng: bounds.getEast(),
      maxLat: bounds.getNorth(),
      zoom: map.getZoom(),
    });
  }, [map, onViewportChange]);
  return null;
}
// Cores para diferentes tipos
const typeColors = {
    Fish: { color: "#3b82f6", bgColor: "#dbeafe" },
    Mammal: { color: "#06b6d4", bgColor: "#cffafe" },
    Coral: { color: "#ec4899", bgColor: "#fce7f3" },
    Invasive: { color: "#ef4444", bgColor: "#fee2e2" },
    Other: { color: "#f59e0b", bgColor: "#fef3c7" },
};
// Criar ícone customizado para observações
function createObservationIcon(type) {
    const colors = typeColors[type] || typeColors.Other;
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
        📍
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
    const [userLocation, setUserLocation] = useState(null);
    const [observations, setObservations] = useState([]);
    const [user, setUser] = useState(null);
    const [fishPoints, setFishPoints] = useState([]);
    const [selectedTypes, setSelectedTypes] = useState(new Set(["Fish", "Mammal", "Coral", "Invasive", "Other"]));
    const [loading, setLoading] = useState(true);
    const [showMobileControls, setShowMobileControls] = useState(true);
    const [viewport, setViewport] = useState(null);
    const fishCacheRef = useRef(new Map());
    const fishRenderer = useMemo(() => L.canvas({ padding: 0.2 }), []);
    const isCoarsePointer = useMemo(() => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
      }
      return window.matchMedia("(pointer: coarse)").matches;
    }, []);
    useEffect(() => {
        // Carrega a sessão do usuário
        const session = localStorage.getItem("userSession");
        if (session) {
            setUser(JSON.parse(session));
        }
        // Carrega observações salvas
        const savedObservations = localStorage.getItem("observations");
        if (savedObservations) {
            setObservations(JSON.parse(savedObservations));
        }
        // Obtém a localização do usuário
        if (navigator.geolocation) {
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
    const toggleTypeFilter = (type) => {
        const newTypes = new Set(selectedTypes);
        if (newTypes.has(type)) {
            newTypes.delete(type);
        }
        else {
            newTypes.add(type);
        }
        setSelectedTypes(newTypes);
    };
    useEffect(() => {
      if (!viewport) {
        return;
      }

      const zoomBucket = viewport.zoom;
      const precision = zoomBucket <= 5 ? 1 : zoomBucket <= 8 ? 2 : 3;
      const key = [
        viewport.minLng.toFixed(precision),
        viewport.minLat.toFixed(precision),
        viewport.maxLng.toFixed(precision),
        viewport.maxLat.toFixed(precision),
        String(zoomBucket),
      ].join("|");

      const cached = fishCacheRef.current.get(key);
      if (cached) {
        setFishPoints(cached);
        return;
      }

      const browserHost = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? `http://${browserHost}:4000`;

      const padFactor = viewport.zoom >= 13 ? 0.18 : viewport.zoom >= 10 ? 0.35 : viewport.zoom >= 7 ? 0.6 : 0.9;
      const lngPad = (viewport.maxLng - viewport.minLng) * padFactor;
      const latPad = (viewport.maxLat - viewport.minLat) * padFactor;
      const minLng = Math.max(-180, viewport.minLng - lngPad);
      const minLat = Math.max(-90, viewport.minLat - latPad);
      const maxLng = Math.min(180, viewport.maxLng + lngPad);
      const maxLat = Math.min(90, viewport.maxLat + latPad);

      const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(async () => {
        try {
          const response = await fetch(`${apiBase}/api/obis/fish?bbox=${encodeURIComponent(bbox)}&zoom=${zoomBucket}`, {
            signal: controller.signal,
          });
          if (!response.ok) {
            return;
          }
          const data = await response.json();
          const points = Array.isArray(data?.points) ? data.points : [];
          fishCacheRef.current.set(key, points);
          setFishPoints(points);
        }
        catch {
        }
      }, 120);
      return () => {
        controller.abort();
        window.clearTimeout(timeoutId);
      };
    }, [viewport]);

    const renderedFishPoints = useMemo(() => {
      if (!viewport || fishPoints.length === 0) {
        return fishPoints;
      }

      const zoom = viewport.zoom;
      const maxPoints = zoom <= 6 ? 1800 : zoom <= 9 ? 3200 : zoom <= 12 ? 5500 : 9000;
      const grid = zoom <= 6 ? 0.06 : zoom <= 9 ? 0.03 : zoom <= 12 ? 0.015 : 0.0;

      if (grid <= 0 && fishPoints.length <= maxPoints) {
        return fishPoints;
      }

      if (grid <= 0) {
        return fishPoints.slice(0, maxPoints);
      }

      const cells = new Set();
      const result = [];
      for (const point of fishPoints) {
        const latCell = Math.floor(point.lat / grid);
        const lngCell = Math.floor(point.lng / grid);
        const key = `${latCell}:${lngCell}`;
        if (cells.has(key)) {
          continue;
        }

        cells.add(key);
        result.push(point);
        if (result.length >= maxPoints) {
          break;
        }
      }

      return result;
    }, [fishPoints, viewport]);

    const fishMarkerStyle = useMemo(() => {
      const zoom = viewport?.zoom ?? 10;
      const baseRadius = zoom <= 6 ? 4 : zoom <= 9 ? 5 : zoom <= 12 ? 6 : 7;
      const radius = isCoarsePointer ? baseRadius + 2 : baseRadius;

      return {
        radius,
        color: "#1d4ed8",
        fillColor: "#3b82f6",
        fillOpacity: 0.9,
        weight: 1,
      };
    }, [isCoarsePointer, viewport]);
    // Filtrar observações por tipo selecionado
    const filteredObservations = observations.filter((obs) => selectedTypes.has(obs.type));
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
          <MapContainer center={[userLocation.latitude, userLocation.longitude]} zoom={15} zoomControl={false} preferCanvas style={{ width: "100%", height: "100%" }}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
            <ZoomControl position="topright" />

            {/* Círculo de alcance do usuário */}
            <Circle center={[userLocation.latitude, userLocation.longitude]} radius={5000} pathOptions={{
            color: "rgba(59, 130, 246, 0.3)",
            fillColor: "rgba(59, 130, 246, 0.1)",
            weight: 2,
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
                    <p className="font-semibold text-xs">{obs.species}</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      {obs.date} às {obs.time}
                    </p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{
                backgroundColor: typeColors[obs.type]?.color,
            }}>
                        {obs.type}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">
                        {obs.confidence}
                      </span>
                    </div>
                    {obs.notes && (<p className="text-xs text-foreground line-clamp-2">
                        {obs.notes}
                      </p>)}
                  </div>
                </Popup>
              </Marker>))}

            {/* Pontos de peixes (OBIS) */}
            {selectedTypes.has("Fish") && renderedFishPoints.map((fish) => (<CircleMarker key={fish.id} center={[fish.lat, fish.lng]} radius={fishMarkerStyle.radius} renderer={fishRenderer} pathOptions={{
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
                  </div>
                </Popup>
              </CircleMarker>))}

            <MapCenterController latitude={userLocation.latitude} longitude={userLocation.longitude}/>
            <MapResizeController />
            <FishViewportController onViewportChange={setViewport}/>
          </MapContainer>

          {/* Botão Voltar Mobile */}
          <div className="absolute top-4 left-4 z-[999]">
            <Button variant="ghost" size="icon" onClick={() => navigate("/home")} className="bg-white/90 backdrop-blur-md hover:bg-white shadow-lg rounded-full w-10 h-10">
              <ArrowLeft className="w-5 h-5 text-foreground"/>
            </Button>
          </div>

          {/* Painel Flutuante Mobile */}
          {showMobileControls && (<div className="absolute bottom-4 right-4 z-[999] bg-white/95 backdrop-blur-md rounded-2xl border border-border shadow-lg p-4 max-w-xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm text-foreground">
                  Filtros
                </h3>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowMobileControls(false)}>
                  <X className="w-4 h-4"/>
                </Button>
              </div>

              <div className="space-y-2">
                {Object.keys(typeColors).map((type) => (<label key={type} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors cursor-pointer">
                    <input type="checkbox" checked={selectedTypes.has(type)} onChange={() => toggleTypeFilter(type)} className="w-4 h-4 rounded flex-shrink-0"/>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{
                    backgroundColor: typeColors[type]?.color,
                }}></div>
                      <span className="text-xs text-foreground">{type}</span>
                    </div>
                  </label>))}
              </div>
            </div>)}

          {/* Botão Flutuante para Abrir Controles Mobile */}
          {!showMobileControls && (<button onClick={() => setShowMobileControls(true)} className="absolute bottom-4 right-4 z-[999] bg-primary text-white rounded-full p-3 shadow-lg hover:bg-primary/90 transition-colors" aria-label="Abrir filtros">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/>
              </svg>
            </button>)}
        </div>
      </div>
    </>);
}
