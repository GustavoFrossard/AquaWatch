import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, X } from "lucide-react";

// Configuração de ícones do Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

interface Observation {
  id: string;
  userId: string;
  species: string;
  type: string;
  location: string;
  latitude: number;
  longitude: number;
  date: string;
  time: string;
  notes: string;
  confidence: string;
  image?: string;
  timestamp: number;
}

interface AnimalLocation {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  rarity: "common" | "uncommon" | "rare";
}

interface UserSession {
  id: string;
  email: string;
  username: string;
  points: number;
  level: number;
  badges: string[];
}

// Componente auxiliar para centralizar o mapa na localização do usuário
function MapCenterController({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (latitude && longitude) {
      map.setView([latitude, longitude], 15, { animate: true });
    }
  }, [latitude, longitude, map]);

  return null;
}

// Gerar animais aleatórios nas redondezas
function generateNearbyAnimals(
  userLat: number,
  userLng: number,
  count: number = 8
): AnimalLocation[] {
  const animals = [
    { name: "Bluefin Tuna", type: "Fish" },
    { name: "Clownfish", type: "Fish" },
    { name: "Sea Bass", type: "Fish" },
    { name: "Grouper", type: "Fish" },
    { name: "Seahorse", type: "Fish" },
    { name: "Dolphin", type: "Mammal" },
    { name: "Sea Lion", type: "Mammal" },
    { name: "Whale", type: "Mammal" },
    { name: "Manatee", type: "Mammal" },
    { name: "Brain Coral", type: "Coral" },
    { name: "Elkhorn Coral", type: "Coral" },
    { name: "Staghorn Coral", type: "Coral" },
    { name: "Lionfish", type: "Invasive" },
    { name: "Sea Urchin", type: "Invasive" },
    { name: "Manta Ray", type: "Other" },
    { name: "Sea Turtle", type: "Other" },
  ];

  const generated: AnimalLocation[] = [];
  const rarityProbability = 0.3;

  for (let i = 0; i < count; i++) {
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const radius = 0.045;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius;

    const lat = userLat + distance * Math.cos(angle);
    const lng = userLng + distance * Math.sin(angle);

    const rand = Math.random();
    let rarity: "common" | "uncommon" | "rare" = "common";
    if (rand > rarityProbability * 2) {
      rarity = "rare";
    } else if (rand > rarityProbability) {
      rarity = "uncommon";
    }

    generated.push({
      id: `animal-${i}-${Date.now()}`,
      name: animal.name,
      type: animal.type,
      latitude: lat,
      longitude: lng,
      rarity,
    });
  }

  return generated;
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
function createObservationIcon(type: string) {
  const colors = typeColors[type as keyof typeof typeColors] || typeColors.Other;
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

// Criar ícone customizado para animais aleatórios
function createAnimalIcon(type: string, rarity: string) {
  const colors = typeColors[type as keyof typeof typeColors] || typeColors.Other;
  const emoji =
    rarity === "rare" ? "🌟" : rarity === "uncommon" ? "✨" : "🐠";

  return L.divIcon({
    html: `
      <div style="
        background-color: white;
        border: 2px solid ${colors.color};
        border-radius: 50%;
        width: 35px;
        height: 35px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
      ">
        ${emoji}
      </div>
    `,
    className: "custom-icon",
    iconSize: [35, 35],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
}

export default function MapPage() {
  const navigate = useNavigate();
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [nearbyAnimals, setNearbyAnimals] = useState<AnimalLocation[]>([]);
  const [user, setUser] = useState<UserSession | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set(["Fish", "Mammal", "Coral", "Invasive", "Other"])
  );
  const [loading, setLoading] = useState(true);
  const [showMobileControls, setShowMobileControls] = useState(true);

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
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ latitude, longitude });
          setNearbyAnimals(generateNearbyAnimals(latitude, longitude));
          setLoading(false);
        },
        (error) => {
          console.error("Erro ao obter localização:", error);
          const defaultLat = 37.7749;
          const defaultLng = -122.4194;
          setUserLocation({ latitude: defaultLat, longitude: defaultLng });
          setNearbyAnimals(generateNearbyAnimals(defaultLat, defaultLng));
          setLoading(false);
        }
      );
    } else {
      const defaultLat = 37.7749;
      const defaultLng = -122.4194;
      setUserLocation({ latitude: defaultLat, longitude: defaultLng });
      setNearbyAnimals(generateNearbyAnimals(defaultLat, defaultLng));
      setLoading(false);
    }
  }, []);

  const toggleTypeFilter = (type: string) => {
    const newTypes = new Set(selectedTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setSelectedTypes(newTypes);
  };

  // Filtrar observações por tipo selecionado
  const filteredObservations = observations.filter((obs) =>
    selectedTypes.has(obs.type)
  );

  // Filtrar animais por tipo selecionado
  const filteredAnimals = nearbyAnimals.filter((animal) =>
    selectedTypes.has(animal.type)
  );

  if (loading || !userLocation) {
    return (
      <div className="w-screen h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin mb-4">
            <MapPin className="w-12 h-12 text-primary mx-auto" />
          </div>
          <p className="text-lg font-semibold text-foreground">
            Localizando você...
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Por favor, aguarde
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile View */}
      <div className="lg:hidden w-screen h-screen relative bg-background">
        {/* Mapa Fullscreen */}
        <div className="w-full h-full relative">
          <MapContainer
            center={[userLocation.latitude, userLocation.longitude]}
            zoom={15}
            style={{ width: "100%", height: "100%" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Círculo de alcance do usuário */}
            <Circle
              center={[userLocation.latitude, userLocation.longitude]}
              radius={5000}
              pathOptions={{
                color: "rgba(59, 130, 246, 0.3)",
                fillColor: "rgba(59, 130, 246, 0.1)",
                weight: 2,
              }}
            />

            {/* Marcador da localização do usuário */}
            <Marker
              position={[userLocation.latitude, userLocation.longitude]}
              icon={L.icon({
                iconUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iOCIgZmlsbD0iIzNiODJmNiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjQiIGZpbGw9IiNmZmYiLz48L3N2Zz4=",
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -16],
              })}
            >
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
            {filteredObservations.map((obs) => (
              <Marker
                key={obs.id}
                position={[obs.latitude, obs.longitude]}
                icon={createObservationIcon(obs.type)}
              >
                <Popup>
                  <div className="p-2 max-w-xs">
                    {obs.image && (
                      <img
                        src={obs.image}
                        alt={obs.species}
                        className="w-full h-24 object-cover rounded mb-2"
                      />
                    )}
                    <p className="font-semibold text-xs">{obs.species}</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      {obs.date} às {obs.time}
                    </p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full text-white"
                        style={{
                          backgroundColor:
                            typeColors[
                              obs.type as keyof typeof typeColors
                            ]?.color,
                        }}
                      >
                        {obs.type}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">
                        {obs.confidence}
                      </span>
                    </div>
                    {obs.notes && (
                      <p className="text-xs text-foreground line-clamp-2">
                        {obs.notes}
                      </p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Marcadores dos animais nas redondezas */}
            {filteredAnimals.map((animal) => (
              <Marker
                key={animal.id}
                position={[animal.latitude, animal.longitude]}
                icon={createAnimalIcon(animal.type, animal.rarity)}
              >
                <Popup>
                  <div className="p-2">
                    <p className="font-semibold text-xs">{animal.name}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full text-white"
                        style={{
                          backgroundColor:
                            typeColors[
                              animal.type as keyof typeof typeColors
                            ]?.color,
                        }}
                      >
                        {animal.type}
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full text-white"
                        style={{
                          backgroundColor:
                            animal.rarity === "rare"
                              ? "#dc2626"
                              : animal.rarity === "uncommon"
                                ? "#f97316"
                                : "#10b981",
                        }}
                      >
                        {animal.rarity === "rare"
                          ? "Raro"
                          : animal.rarity === "uncommon"
                            ? "Incomum"
                            : "Comum"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Possível de ser observado
                    </p>
                  </div>
                </Popup>
              </Marker>
            ))}

            <MapCenterController
              latitude={userLocation.latitude}
              longitude={userLocation.longitude}
            />
          </MapContainer>

          {/* Botão Voltar Mobile */}
          <div className="absolute top-4 left-4 z-[999]">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/home")}
              className="bg-white/90 backdrop-blur-md hover:bg-white shadow-lg rounded-full w-10 h-10"
            >
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </Button>
          </div>

          {/* Painel Flutuante Mobile */}
          {showMobileControls && (
            <div className="absolute bottom-4 right-4 z-[999] bg-white/95 backdrop-blur-md rounded-2xl border border-border shadow-lg p-4 max-w-xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm text-foreground">
                  Filtros
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setShowMobileControls(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {Object.keys(typeColors).map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTypes.has(type)}
                      onChange={() => toggleTypeFilter(type)}
                      className="w-4 h-4 rounded flex-shrink-0"
                    />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor:
                            typeColors[type as keyof typeof typeColors]?.color,
                        }}
                      ></div>
                      <span className="text-xs text-foreground">{type}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Botão Flutuante para Abrir Controles Mobile */}
          {!showMobileControls && (
            <button
              onClick={() => setShowMobileControls(true)}
              className="absolute bottom-4 right-4 z-[999] bg-primary text-white rounded-full p-3 shadow-lg hover:bg-primary/90 transition-colors"
              aria-label="Abrir filtros"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Desktop View */}
      <div className="hidden lg:flex min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5 flex-col">
        {/* Desktop Header */}
        <div className="bg-card/80 backdrop-blur-md border-b border-border sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/home")}
                className="flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-foreground truncate">
                  Mapa
                </h1>
                <p className="text-xs text-muted-foreground">
                  Explore animais aquáticos nas redondezas
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
          <div className="grid grid-cols-4 gap-6">
            {/* Mapa Desktop */}
            <div className="col-span-3 relative h-[600px] rounded-2xl border border-border overflow-hidden">
              <MapContainer
                center={[userLocation.latitude, userLocation.longitude]}
                zoom={15}
                style={{ width: "100%", height: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Círculo de alcance do usuário */}
                <Circle
                  center={[userLocation.latitude, userLocation.longitude]}
                  radius={5000}
                  pathOptions={{
                    color: "rgba(59, 130, 246, 0.3)",
                    fillColor: "rgba(59, 130, 246, 0.1)",
                    weight: 2,
                  }}
                />

                {/* Marcador da localização do usuário */}
                <Marker
                  position={[userLocation.latitude, userLocation.longitude]}
                  icon={L.icon({
                    iconUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iOCIgZmlsbD0iIzNiODJmNiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjQiIGZpbGw9IiNmZmYiLz48L3N2Zz4=",
                    iconSize: [32, 32],
                    iconAnchor: [16, 16],
                    popupAnchor: [0, -16],
                  })}
                >
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
                {filteredObservations.map((obs) => (
                  <Marker
                    key={obs.id}
                    position={[obs.latitude, obs.longitude]}
                    icon={createObservationIcon(obs.type)}
                  >
                    <Popup>
                      <div className="p-3 max-w-sm">
                        {obs.image && (
                          <img
                            src={obs.image}
                            alt={obs.species}
                            className="w-full h-32 object-cover rounded mb-2"
                          />
                        )}
                        <p className="font-semibold text-sm">{obs.species}</p>
                        <p className="text-xs text-muted-foreground mb-2">
                          {obs.date} às {obs.time}
                        </p>
                        <div className="flex flex-wrap gap-2 mb-2">
                          <span
                            className="text-xs px-2 py-1 rounded-full text-white"
                            style={{
                              backgroundColor:
                                typeColors[
                                  obs.type as keyof typeof typeColors
                                ]?.color,
                            }}
                          >
                            {obs.type}
                          </span>
                          <span className="text-xs px-2 py-1 rounded-full bg-gray-100">
                            {obs.confidence}
                          </span>
                        </div>
                        {obs.notes && (
                          <p className="text-xs text-foreground">
                            {obs.notes}
                          </p>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}

                {/* Marcadores dos animais nas redondezas */}
                {filteredAnimals.map((animal) => (
                  <Marker
                    key={animal.id}
                    position={[animal.latitude, animal.longitude]}
                    icon={createAnimalIcon(animal.type, animal.rarity)}
                  >
                    <Popup>
                      <div className="p-2">
                        <p className="font-semibold text-sm">{animal.name}</p>
                        <div className="flex gap-2 mt-2">
                          <span
                            className="text-xs px-2 py-1 rounded-full text-white"
                            style={{
                              backgroundColor:
                                typeColors[
                                  animal.type as keyof typeof typeColors
                                ]?.color,
                            }}
                          >
                            {animal.type}
                          </span>
                          <span
                            className="text-xs px-2 py-1 rounded-full text-white"
                            style={{
                              backgroundColor:
                                animal.rarity === "rare"
                                  ? "#dc2626"
                                  : animal.rarity === "uncommon"
                                    ? "#f97316"
                                    : "#10b981",
                            }}
                          >
                            {animal.rarity === "rare"
                              ? "Raro"
                              : animal.rarity === "uncommon"
                                ? "Incomum"
                                : "Comum"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Possível de ser observado
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                ))}

                <MapCenterController
                  latitude={userLocation.latitude}
                  longitude={userLocation.longitude}
                />
              </MapContainer>
            </div>

            {/* Painel Lateral Desktop */}
            <div className="col-span-1 space-y-6">
              {/* Filtros Desktop */}
              <div className="bg-card rounded-2xl border border-border p-6">
                <h3 className="font-semibold text-base text-foreground mb-4">
                  Filtros
                </h3>

                <div className="space-y-2">
                  {Object.keys(typeColors).map((type) => (
                    <label
                      key={type}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTypes.has(type)}
                        onChange={() => toggleTypeFilter(type)}
                        className="w-4 h-4 rounded flex-shrink-0"
                      />
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor:
                              typeColors[type as keyof typeof typeColors]?.color,
                          }}
                        ></div>
                        <span className="text-sm text-foreground">{type}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Legenda Desktop */}
              <div className="bg-card rounded-2xl border border-border p-6">
                <h3 className="font-semibold text-base text-foreground mb-4">
                  Legenda
                </h3>

                <div className="space-y-3">
                  {Object.entries(typeColors).map(([type, colors]) => (
                    <div
                      key={type}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors"
                    >
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        style={{ backgroundColor: colors.color }}
                      ></div>
                      <span className="text-sm text-foreground">{type}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
