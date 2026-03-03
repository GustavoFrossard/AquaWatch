import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, MapPin, Calendar, AlertCircle, CheckCircle, } from "lucide-react";
export default function CreateObservationPage() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(false);
    const [imagePreview, setImagePreview] = useState(null);
    const [formData, setFormData] = useState({
        species: "",
      type: "Other",
        location: "Current Location",
        latitude: 40.7128,
        longitude: -74.006,
        date: new Date().toISOString().split("T")[0],
        time: new Date().toTimeString().slice(0, 5),
        notes: "",
        confidence: "high",
        image: "",
    });
    useEffect(() => {
        const session = localStorage.getItem("userSession");
        if (!session) {
            navigate("/auth");
        }
        else {
            setUser(JSON.parse(session));
        }
    }, [navigate]);
    const handleImageUpload = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result;
                setImagePreview(base64);
                setFormData({ ...formData, image: base64 });
            };
            reader.readAsDataURL(file);
        }
    };
    const getGPSLocation = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((position) => {
                setFormData({
                    ...formData,
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    location: `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`,
                });
                toast({
                    title: "Location Updated",
                    description: "GPS coordinates captured",
                });
            }, () => {
                toast({
                    title: "Location Access Denied",
                    description: "Using default location",
                    variant: "destructive",
                });
            });
        }
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.species || !formData.location || !formData.date) {
            toast({
                title: "Missing Required Fields",
                description: "Please fill in species, location, and date",
                variant: "destructive",
            });
            return;
        }
        setLoading(true);
        await new Promise((resolve) => setTimeout(resolve, 800));
        const observation = {
            id: Math.random().toString(36).substr(2, 9),
            userId: user?.id || "",
            species: formData.species,
            type: formData.type,
            location: formData.location,
            latitude: formData.latitude,
            longitude: formData.longitude,
            date: formData.date,
            time: formData.time,
            notes: formData.notes,
            confidence: formData.confidence,
            image: formData.image,
            timestamp: Date.now(),
        };
        // Save observation to localStorage
        const observations = JSON.parse(localStorage.getItem("observations") || "[]");
        observations.push(observation);
        localStorage.setItem("observations", JSON.stringify(observations));
        // Update user points and observations count
        if (user) {
            const updatedUser = {
                ...user,
                points: user.points + 50,
            };
            localStorage.setItem("userSession", JSON.stringify(updatedUser));
        }
        setLoading(false);
        toast({
            title: "Observation Recorded!",
            description: `${formData.species} observation saved. You earned 50 points!`,
        });
        setTimeout(() => {
            navigate("/home");
        }, 1500);
    };
    if (!user)
        return null;
    return (<div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-secondary/5">
      {/* Header */}
      <div className="bg-card/80 backdrop-blur-md border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
            <ArrowLeft className="w-5 h-5"/>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              New Observation
            </h1>
            <p className="text-sm text-muted-foreground">
              Register your aquatic life discovery
            </p>
          </div>
        </div>
      </div>

      {/* Form Content */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Image Upload Section */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <label className="block text-sm font-semibold text-foreground mb-4">
              Photo
            </label>
            {imagePreview ? (<div className="relative">
                <img src={imagePreview} alt="Preview" className="w-full h-64 object-cover rounded-xl"/>
                <button type="button" onClick={() => {
                setImagePreview(null);
                setFormData({ ...formData, image: "" });
            }} className="absolute top-2 right-2 bg-destructive text-white p-2 rounded-full hover:bg-destructive/90">
                  ✕
                </button>
              </div>) : (<label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-border rounded-xl cursor-pointer bg-muted/20 hover:bg-muted/30 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Camera className="w-12 h-12 text-primary mb-2"/>
                  <p className="text-sm text-muted-foreground">
                    Click to upload photo
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PNG, JPG or GIF (max 5MB)
                  </p>
                </div>
                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload}/>
              </label>)}
          </div>

          {/* Species Selection */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <label className="block text-sm font-semibold text-foreground mb-2">
              Species <span className="text-destructive">*</span>
            </label>
            <Input type="text" placeholder="Type species name" value={formData.species} onChange={(e) => setFormData({ ...formData, species: e.target.value })} className="mb-2"/>
            {formData.type && (<div className="mt-2 inline-block bg-primary/10 text-primary text-xs font-medium px-3 py-1 rounded-full">
                {formData.type}
              </div>)}
          </div>

          {/* Location Section */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <label className="block text-sm font-semibold text-foreground mb-2">
              Location <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2 mb-3">
              <Input type="text" placeholder="Location name or coordinates" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })}/>
              <Button type="button" variant="outline" size="icon" onClick={getGPSLocation} title="Get GPS coordinates">
                <MapPin className="w-5 h-5"/>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Coordinates: {formData.latitude.toFixed(4)}, {formData.longitude.toFixed(4)}
            </p>
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card rounded-2xl border border-border p-6">
              <label className="block text-sm font-semibold text-foreground mb-2">
                Date <span className="text-destructive">*</span>
              </label>
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-muted-foreground"/>
                <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })}/>
              </div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-6">
              <label className="block text-sm font-semibold text-foreground mb-2">
                Time
              </label>
              <Input type="time" value={formData.time} onChange={(e) => setFormData({ ...formData, time: e.target.value })}/>
            </div>
          </div>

          {/* Confidence Level */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <label className="block text-sm font-semibold text-foreground mb-3">
              Confidence Level
            </label>
            <div className="flex gap-3">
              {["low", "medium", "high"].map((level) => (<button key={level} type="button" onClick={() => setFormData({ ...formData, confidence: level })} className={`px-4 py-2 rounded-lg font-medium transition-all capitalize ${formData.confidence === level
                ? "bg-gradient-to-r from-primary to-secondary text-white"
                : "bg-muted text-foreground hover:bg-muted/80"}`}>
                  {level}
                </button>))}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <label className="block text-sm font-semibold text-foreground mb-2">
              Notes
            </label>
            <textarea placeholder="Describe the observation (behavior, habitat, other details...)" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={4} className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"/>
          </div>

          {/* Submit Button */}
          <Button type="submit" disabled={loading} className="w-full h-12 bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-semibold text-lg rounded-2xl">
            {loading ? (<>
                <div className="animate-spin mr-2 h-5 w-5 border-2 border-white border-t-transparent rounded-full"/>
                Submitting...
              </>) : (<>
                <CheckCircle className="w-5 h-5 mr-2"/>
                Submit Observation
              </>)}
          </Button>
        </form>
      </div>
    </div>);
}
