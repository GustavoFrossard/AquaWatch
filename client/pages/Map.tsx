import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Map as MapIcon } from "lucide-react";

export default function MapPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5">
      {/* Header */}
      <div className="bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Map</h1>
        </div>
      </div>

      {/* Placeholder Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <MapIcon className="w-16 h-16 text-muted-foreground/30 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Observation Map
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            This page is coming soon! You'll be able to view all observations
            on an interactive map with color-coded markers for different
            species types.
          </p>
          <Button
            onClick={() => navigate("/")}
            className="bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white"
          >
            Back to Home
          </Button>
        </div>
      </div>
    </div>
  );
}
