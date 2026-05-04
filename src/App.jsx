import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "mes-plantes-v1";
const MONTHS_FR = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
const DAYS_FR = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];

const TASK_COLORS = {
  arrosage: "#4ade80", engrais: "#fb923c", rempotage: "#a78bfa",
  taille: "#38bdf8", brumisation: "#67e8f9",
};
const TASK_ICONS = {
  arrosage: "💧", engrais: "🌱", rempotage: "🪴", taille: "✂️", brumisation: "🌫️",
};

export default function App() {
  const [plants, setPlants] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [view, setView] = useState("home");
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [preview, setPreview] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [location, setLocation] = useState(null);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("anthropic_key") || "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [editingPlant, setEditingPlant] = useState(null); // {id, field, value}
  const [pendingPlant, setPendingPlant] = useState(null); // waiting for user confirmation
  const [correction, setCorrection] = useState(""); // user correction input
  const fileRef = useRef();

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plants)); } catch {}
  }, [plants]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => setLocation({ lat: 48.85, lon: 2.35 })
      );
    }
  }, []);

  const saveApiKey = (key) => {
    setApiKey(key);
    localStorage.setItem("anthropic_key", key);
    setShowKeyInput(false);
  };

  const getSeason = (month, lat = 48) => {
    const s = lat >= 0
      ? ["Hiver","Hiver","Printemps","Printemps","Printemps","Été","Été","Été","Automne","Automne","Automne","Hiver"]
      : ["Été","Été","Automne","Automne","Automne","Hiver","Hiver","Hiver","Printemps","Printemps","Printemps","Été"];
    return s[month];
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        // Version API : 1000px pour bonne reconnaissance
        const API_MAX = 1000;
        let { width, height } = img;
        if (width > API_MAX || height > API_MAX) {
          if (width > height) { height = Math.round(height * API_MAX / width); width = API_MAX; }
          else { width = Math.round(width * API_MAX / height); height = API_MAX; }
        }
        const apiCanvas = document.createElement("canvas");
        apiCanvas.width = width; apiCanvas.height = height;
        apiCanvas.getContext("2d").drawImage(img, 0, 0, width, height);
        setImageData(apiCanvas.toDataURL("image/jpeg", 0.85).split(",")[1]);

        // Version stockage : 400px très compressée pour économiser la mémoire
        const STORE_MAX = 400;
        let sw = img.width, sh = img.height;
        if (sw > STORE_MAX || sh > STORE_MAX) {
          if (sw > sh) { sh = Math.round(sh * STORE_MAX / sw); sw = STORE_MAX; }
          else { sw = Math.round(sw * STORE_MAX / sh); sh = STORE_MAX; }
        }
        const storeCanvas = document.createElement("canvas");
        storeCanvas.width = sw; storeCanvas.height = sh;
        storeCanvas.getContext("2d").drawImage(img, 0, 0, sw, sh);
        const thumbnail = storeCanvas.toDataURL("image/jpeg", 0.6);
        setPreview(thumbnail);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const analyzeAndAdd = async () => {
    // Validations gratuites avant d'appeler l'API
    if (!imageData) { setLoadingMsg("❌ Aucune image sélectionnée"); setTimeout(() => setLoadingMsg(""), 5000); return; }
    if (!apiKey) { setShowKeyInput(true); return; }
    if (!apiKey.startsWith("sk-ant-")) { setLoadingMsg("❌ Clé API invalide — elle doit commencer par sk-ant-"); setTimeout(() => setLoadingMsg(""), 10000); return; }
    const base64Size = (imageData.length * 3) / 4 / 1024 / 1024;
    if (base64Size > 4.5) { setLoadingMsg("❌ Image encore trop lourde (" + base64Size.toFixed(1) + "MB). Essaie une autre photo."); setTimeout(() => setLoadingMsg(""), 10000); return; }
    setLoading(true);
    setLoadingMsg("🔍 Identification de la plante…");
    const now = new Date();
    const seasonInfo = getSeason(now.getMonth(), location?.lat);
    const locationStr = location ? `Latitude ${location.lat.toFixed(1)}, longitude ${location.lon.toFixed(1)}` : "Europe tempérée";
    const prompt = `Tu es un expert en botanique et jardinage. Analyse cette photo de plante.
Contexte : Localisation ${locationStr}, saison ${seasonInfo}, date ${now.toLocaleDateString("fr-FR")}.
Réponds UNIQUEMENT en JSON valide (sans backticks) :
{"nom":"...","nom_latin":"...","emoji":"...","description":"...","luminosite":"...","humidite":"...","difficulte":"...","conseils_saison":"...","taches":[{"type":"arrosage","frequence_jours":7,"description":"...","mois_actifs":[1,2,3,4,5,6,7,8,9,10,11,12]}]}
Types de tâches possibles : arrosage, engrais, rempotage, taille, brumisation. Adapte les fréquences à la saison et au climat local.`;
    try {
      setLoadingMsg("🤖 Analyse en cours…");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 2048,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageData } },
            { type: "text", text: prompt }
          ]}]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.find(b => b.type === "text")?.text || "";
      if (!text) throw new Error("Réponse vide — vérifie ta clé API");
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Réponse reçue mais JSON introuvable : " + text.slice(0, 80));
      const plantData = JSON.parse(jsonMatch[0]);
      const newPlant = { id: Date.now(), ...plantData, photo: preview, ajoutee: now.toISOString(), derniere_action: {} };
      setPendingPlant(newPlant);
      setCorrection("");
    } catch (err) {
      setLoadingMsg("❌ " + err.message + " — (les crédits ne sont débités que si l'API répond)");
      setTimeout(() => setLoadingMsg(""), 10000);
    } finally { setLoading(false); }
  };

  const getNextTaskDate = (plant, task) => {
    const last = plant.derniere_action?.[task.type];
    const base = last ? new Date(last) : new Date(plant.ajoutee);
    const next = new Date(base);
    next.setDate(next.getDate() + task.frequence_jours);
    return next;
  };

  const markDone = (plantId, taskType) => {
    const now = new Date().toISOString();
    setPlants(prev => {
      const updated = prev.map(p => p.id !== plantId ? p : { ...p, derniere_action: { ...p.derniere_action, [taskType]: now } });
      // Sync selectedPlant avec la version à jour
      const updatedPlant = updated.find(p => p.id === plantId);
      if (updatedPlant) setSelectedPlant(updatedPlant);
      return updated;
    });
  };

  const deleteTask = (plantId, taskType) => {
    setPlants(prev => {
      const updated = prev.map(p => p.id !== plantId ? p : { ...p, taches: p.taches.filter(t => t.type !== taskType) });
      const updatedPlant = updated.find(p => p.id === plantId);
      if (updatedPlant) setSelectedPlant(updatedPlant);
      return updated;
    });
  };

  const urgentTasks = plants.flatMap(plant =>
    (plant.taches || []).map(task => ({ plant, task, next: getNextTaskDate(plant, task), daysLeft: Math.floor((getNextTaskDate(plant, task) - new Date()) / 86400000) }))
  ).filter(t => t.daysLeft <= 3).sort((a, b) => a.daysLeft - b.daysLeft);

  const confirmPlant = () => {
    setPlants(prev => [...prev, pendingPlant]);
    setSelectedPlant(pendingPlant);
    setPendingPlant(null);
    setPreview(null); setImageData(null);
    setView("plant");
  };

  const correctAndRetry = async () => {
    if (!correction.trim()) return;
    setLoading(true);
    setLoadingMsg("🔄 Correction en cours…");
    const now = new Date();
    const seasonInfo = getSeason(now.getMonth(), location?.lat);
    const locationStr = location ? `Latitude ${location.lat.toFixed(1)}, longitude ${location.lon.toFixed(1)}` : "Europe tempérée";
    const prompt = `Tu es un expert en botanique et jardinage. L'utilisateur te dit que la plante est : "${correction}".
Contexte : Localisation ${locationStr}, saison ${seasonInfo}, date ${now.toLocaleDateString("fr-FR")}.
Génère le planning d'entretien adapté. Réponds UNIQUEMENT en JSON valide (sans backticks) :
{"nom":"...","nom_latin":"...","emoji":"...","description":"...","luminosite":"...","humidite":"...","difficulte":"...","conseils_saison":"...","taches":[{"type":"arrosage","frequence_jours":7,"description":"...","mois_actifs":[1,2,3,4,5,6,7,8,9,10,11,12]}]}
Types de tâches possibles : arrosage, engrais, rempotage, taille, brumisation. Adapte les fréquences à la saison et au climat local.`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 2048,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Réponse invalide");
      const plantData = JSON.parse(jsonMatch[0]);
      setPendingPlant({ ...pendingPlant, ...plantData });
      setCorrection("");
    } catch (err) {
      setLoadingMsg("❌ " + err.message);
      setTimeout(() => setLoadingMsg(""), 8000);
    } finally { setLoading(false); }
  };

  const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const getFirstDay = (y, m) => new Date(y, m, 1).getDay();

  const getTasksForDay = (day) => {
    const date = new Date(calYear, calMonth, day);
    const tasks = [];
    plants.forEach(plant => {
      plant.taches?.forEach(task => {
        if (!task.mois_actifs?.includes(calMonth + 1)) return;
        const next = getNextTaskDate(plant, task);
        if (date.toDateString() === next.toDateString()) tasks.push({ plant, task });
        else { const diff = Math.floor((date - next) / 86400000); if (diff > 0 && diff % task.frequence_jours === 0) tasks.push({ plant, task }); }
      });
    });
    return tasks;
  };

  // API Key modal
  const KeyModal = () => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
      <div style={{ background: "white", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380 }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: "#1a3a2a", marginBottom: 8 }}>🔑 Clé API Anthropic</div>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 1.6 }}>
          Pour utiliser l'IA, tu as besoin d'une clé API Anthropic.<br/>
          Obtiens-en une gratuitement sur <a href="https://console.anthropic.com" target="_blank" style={{ color: "#16a34a" }}>console.anthropic.com</a>
        </p>
        <input
          type="password" placeholder="sk-ant-..."
          defaultValue={apiKey}
          id="api-key-input"
          style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 10, padding: "12px 14px", fontSize: 14, marginBottom: 12, outline: "none" }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowKeyInput(false)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: 12, cursor: "pointer", fontSize: 14 }}>Annuler</button>
          <button onClick={() => saveApiKey(document.getElementById("api-key-input").value)} style={{ flex: 2, background: "#16a34a", color: "white", border: "none", borderRadius: 10, padding: 12, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>Sauvegarder</button>
        </div>
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12, textAlign: "center" }}>🔒 Stockée uniquement sur ton appareil</p>
      </div>
    </div>
  );

  const S = { // shared styles
    header: { background: "linear-gradient(135deg, #1a3a2a 0%, #2d5a3d 100%)", padding: "40px 24px 24px" },
    backBtn: { background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer", marginBottom: 16 },
    title: { fontFamily: "'Georgia', serif", fontSize: 24, color: "#e8f5e9", fontWeight: 700 },
  };

  const renderHome = () => (
    <div style={{ paddingBottom: 100 }}>
      <div style={S.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, color: "#e8f5e9", fontWeight: 700 }}>🌿 Mon Jardin</div>
            <div style={{ color: "#a7d7b0", fontSize: 13, marginTop: 4 }}>{plants.length} plante{plants.length !== 1 ? "s" : ""} • {getSeason(new Date().getMonth(), location?.lat)}</div>
          </div>
          <button onClick={() => setShowKeyInput(true)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "6px 10px", fontSize: 11, cursor: "pointer" }}>
            🔑 API
          </button>
        </div>
      </div>
      {urgentTasks.length > 0 && (
        <div style={{ margin: "20px 16px 0", background: "#fff8f0", border: "1px solid #fed7aa", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 10 }}>⏰ À faire bientôt</div>
          {urgentTasks.slice(0, 4).map(({ plant, task, daysLeft }, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <img src={plant.photo} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#451a03" }}>{TASK_ICONS[task.type]} {plant.nom} — {task.type}</div>
                <div style={{ fontSize: 11, color: "#78350f" }}>{daysLeft < 0 ? `En retard de ${-daysLeft}j` : daysLeft === 0 ? "Aujourd'hui !" : `Dans ${daysLeft}j`}</div>
              </div>
              <button onClick={() => markDone(plant.id, task.type)} style={{ background: "#16a34a", color: "white", border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>✓ Fait</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ padding: "20px 16px 0" }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 16, fontWeight: 700, color: "#1a3a2a", marginBottom: 14 }}>Mes plantes</div>
        {plants.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#86a892" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🌱</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#2d5a3d" }}>Ajoutez votre première plante</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Prenez une photo et laissez l'IA faire le reste</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {plants.map(plant => {
              const task0 = plant.taches?.[0];
              const next = task0 ? getNextTaskDate(plant, task0) : null;
              const daysLeft = next ? Math.floor((next - new Date()) / 86400000) : null;
              const isUrgent = daysLeft !== null && daysLeft <= 1;
              return (
                <div key={plant.id} onClick={() => { setSelectedPlant(plant); setView("plant"); }}
                  style={{ background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", cursor: "pointer", border: `2px solid ${isUrgent ? "#fb923c" : "transparent"}` }}>
                  <img src={plant.photo} style={{ width: "100%", height: 110, objectFit: "cover" }} />
                  <div style={{ padding: "10px 10px 12px" }}>
                    <div style={{ fontSize: 18 }}>{plant.emoji}</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1a3a2a", marginTop: 2 }}>{plant.nom}</div>
                    <div style={{ fontSize: 10, color: "#86a892", fontStyle: "italic" }}>{plant.nom_latin}</div>
                    {next && <div style={{ marginTop: 6, fontSize: 11, color: isUrgent ? "#dc2626" : "#52a26e", fontWeight: 600 }}>{TASK_ICONS[task0.type]} {daysLeft < 0 ? "En retard !" : daysLeft === 0 ? "Aujourd'hui !" : `J-${daysLeft}`}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderAdd = () => (
    <div style={{ paddingBottom: 100 }}>
      <div style={S.header}>
        <button onClick={() => { setView("home"); setPreview(null); setImageData(null); }} style={S.backBtn}>← Retour</button>
        <div style={S.title}>Nouvelle plante</div>
        <div style={{ color: "#a7d7b0", fontSize: 13, marginTop: 4 }}>Prenez une photo claire de votre plante</div>
      </div>
      <div style={{ padding: "24px 16px" }}>
        <div onClick={() => !loading && fileRef.current?.click()}
          style={{ background: preview ? "transparent" : "#f0faf3", border: `2px dashed ${preview ? "transparent" : "#6fba85"}`, borderRadius: 20, height: preview ? "auto" : 220, display: "flex", alignItems: "center", justifyContent: "center", cursor: loading ? "wait" : "pointer", overflow: "hidden", marginBottom: 20 }}>
          {preview ? <img src={preview} style={{ width: "100%", borderRadius: 18, maxHeight: 340, objectFit: "cover" }} /> :
            <div style={{ textAlign: "center", color: "#52a26e" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Appuyez pour choisir une photo</div>
              <div style={{ fontSize: 12, marginTop: 6, color: "#86a892" }}>Prenez la plante entière si possible</div>
            </div>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
        {loadingMsg && <div style={{ background: "#f0faf3", border: "1px solid #6fba85", borderRadius: 12, padding: "12px 16px", marginBottom: 16, color: "#1a3a2a", fontSize: 14, textAlign: "center" }}>{loadingMsg}</div>}
        {preview && !loading && (
          <div>
            <button onClick={analyzeAndAdd} style={{ width: "100%", background: "linear-gradient(135deg, #16a34a, #15803d)", color: "white", border: "none", borderRadius: 16, padding: "18px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'Georgia', serif", boxShadow: "0 4px 20px rgba(22,163,74,0.35)" }}>
              🤖 Identifier & Créer le planning
            </button>
            <button onClick={() => { setPreview(null); setImageData(null); }} style={{ width: "100%", background: "transparent", color: "#86a892", border: "none", padding: "12px", fontSize: 14, cursor: "pointer", marginTop: 8 }}>Choisir une autre photo</button>
          </div>
        )}
        {loading && <div style={{ textAlign: "center", padding: "20px" }}><div style={{ fontSize: 36, animation: "spin 1s linear infinite", display: "inline-block" }}>🌿</div><div style={{ fontSize: 14, color: "#52a26e", marginTop: 12, fontWeight: 600 }}>{loadingMsg}</div></div>}

        {/* Confirmation screen */}
        {pendingPlant && !loading && (
          <div style={{ background: "white", borderRadius: 20, padding: 20, border: "1px solid #d1fae5" }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 40 }}>{pendingPlant.emoji}</div>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: "#1a3a2a" }}>{pendingPlant.nom}</div>
              <div style={{ fontSize: 12, color: "#86a892", fontStyle: "italic" }}>{pendingPlant.nom_latin}</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8, lineHeight: 1.5 }}>{pendingPlant.description}</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#1a3a2a", marginBottom: 8, textAlign: "center" }}>C'est bien cette plante ?</div>
            <button onClick={confirmPlant} style={{ width: "100%", background: "linear-gradient(135deg, #16a34a, #15803d)", color: "white", border: "none", borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}>
              ✅ Oui, c'est ça !
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={correction}
                onChange={e => setCorrection(e.target.value)}
                placeholder="Non, c'est un/une…"
                style={{ flex: 1, border: "1px solid #d1fae5", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none" }}
                onKeyDown={e => e.key === "Enter" && correctAndRetry()}
              />
              <button onClick={correctAndRetry} disabled={!correction.trim()} style={{ background: correction.trim() ? "#f0fdf4" : "#f3f4f6", color: correction.trim() ? "#16a34a" : "#9ca3af", border: "1px solid #d1fae5", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: correction.trim() ? "pointer" : "default" }}>
                🔄
              </button>
            </div>
            <button onClick={() => { setPendingPlant(null); setPreview(null); setImageData(null); }} style={{ width: "100%", background: "transparent", color: "#9ca3af", border: "none", padding: "10px", fontSize: 12, cursor: "pointer", marginTop: 6 }}>
              Annuler
            </button>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const renderPlant = () => {
    const p = selectedPlant; if (!p) return null;
    return (
      <div style={{ paddingBottom: 100 }}>
        <div style={{ position: "relative" }}>
          <img src={p.photo} style={{ width: "100%", height: 260, objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, transparent 40%, rgba(0,0,0,0.6) 100%)" }} />
          <button onClick={() => setView("home")} style={{ position: "absolute", top: 16, left: 16, background: "rgba(0,0,0,0.4)", border: "none", color: "white", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>← Retour</button>
          <div style={{ position: "absolute", bottom: 20, left: 20 }}>
            <div style={{ fontSize: 28 }}>{p.emoji}</div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, color: "white", fontWeight: 700 }}>{p.nom}</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontStyle: "italic" }}>{p.nom_latin}</div>
          </div>
        </div>
        <div style={{ padding: "20px 16px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {[{ label: "☀️ " + p.luminosite, bg: "#fefce8", color: "#854d0e" }, { label: "💧 " + p.humidite, bg: "#eff6ff", color: "#1e3a5f" }, { label: "🌱 " + p.difficulte, bg: "#f0fdf4", color: "#14532d" }].map((pill, i) => (
              <span key={i} style={{ background: pill.bg, color: pill.color, borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 600 }}>{pill.label}</span>
            ))}
          </div>
          <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.6, marginBottom: 16 }}>{p.description}</p>
          {p.conseils_saison && <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "12px 14px", marginBottom: 20, fontSize: 13, color: "#15803d" }}>🌿 <strong>Conseil de saison :</strong> {p.conseils_saison}</div>}
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 16, fontWeight: 700, color: "#1a3a2a", marginBottom: 12 }}>Planning d'entretien</div>
          {(p.taches || []).map((task, i) => {
            const next = getNextTaskDate(p, task);
            const daysLeft = Math.floor((next - new Date()) / 86400000);
            const isUrgent = daysLeft <= 1;
            return (
              <div key={i} style={{ background: "white", borderRadius: 14, padding: "14px 16px", marginBottom: 10, border: `1px solid ${isUrgent ? "#fca5a5" : "#e5f0e8"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: (TASK_COLORS[task.type] || "#ccc") + "30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{TASK_ICONS[task.type]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1a3a2a", textTransform: "capitalize" }}>{task.type}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{task.description}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: isUrgent ? "#dc2626" : "#52a26e", fontWeight: 700 }}>{daysLeft < 0 ? `${-daysLeft}j retard` : daysLeft === 0 ? "Aujourd'hui" : `J-${daysLeft}`}</div>
                    <div style={{ fontSize: 10, color: "#9ca3af" }}>tous les {task.frequence_jours}j</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={() => markDone(p.id, task.type)} style={{ flex: 1, background: isUrgent ? TASK_COLORS[task.type] : "#f0faf3", color: isUrgent ? "white" : "#16a34a", border: isUrgent ? "none" : "1px solid #bbf7d0", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ Fait</button>
                  <button onClick={() => { if(window.confirm("Supprimer la tâche " + task.type + " ?")) deleteTask(p.id, task.type); }} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 14px", fontSize: 13, cursor: "pointer" }}>🗑️</button>
                </div>
              </div>
            );
          })}
          <button onClick={() => setEditingPlant({ ...p })} style={{ width: "100%", marginTop: 12, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 12, padding: "12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>✏️ Modifier les infos</button>
          <button onClick={() => { setPlants(prev => prev.filter(pl => pl.id !== p.id)); setView("home"); }} style={{ width: "100%", marginTop: 10, background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 12, padding: "12px", fontSize: 13, cursor: "pointer" }}>🗑️ Supprimer cette plante</button>
        </div>
      </div>
    );
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const firstDay = getFirstDay(calYear, calMonth);
    const today = new Date();
    return (
      <div style={{ paddingBottom: 100 }}>
        <div style={S.header}>
          <div style={S.title}>📅 Calendrier</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <button onClick={() => { const d = new Date(calYear, calMonth - 1); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>‹</button>
            <div style={{ flex: 1, textAlign: "center", color: "white", fontWeight: 700, fontSize: 16 }}>{MONTHS_FR[calMonth]} {calYear}</div>
            <button onClick={() => { const d = new Date(calYear, calMonth + 1); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>›</button>
          </div>
        </div>
        <div style={{ padding: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
            {DAYS_FR.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#86a892", padding: "4px 0" }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {Array(firstDay).fill(null).map((_, i) => <div key={`e${i}`} />)}
            {Array(daysInMonth).fill(null).map((_, i) => {
              const day = i + 1;
              const dayTasks = getTasksForDay(day);
              const isToday = today.getDate() === day && today.getMonth() === calMonth && today.getFullYear() === calYear;
              return (
                <div key={day} style={{ background: isToday ? "#dcfce7" : "white", border: isToday ? "2px solid #16a34a" : "1px solid #e5f0e8", borderRadius: 10, padding: "6px 4px", minHeight: 52 }}>
                  <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? "#16a34a" : "#374151", textAlign: "center" }}>{day}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center", marginTop: 2 }}>
                    {dayTasks.slice(0, 3).map((t, idx) => <div key={idx} title={`${t.plant.nom} — ${t.task.type}`} style={{ width: 14, height: 14, borderRadius: 4, background: TASK_COLORS[t.task.type] || "#ccc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8 }}>{TASK_ICONS[t.task.type]}</div>)}
                    {dayTasks.length > 3 && <div style={{ fontSize: 8, color: "#86a892", lineHeight: "14px" }}>+{dayTasks.length - 3}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 20, background: "white", borderRadius: 14, padding: "14px 16px", border: "1px solid #e5f0e8" }}>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 13, fontWeight: 700, color: "#1a3a2a", marginBottom: 10 }}>Légende</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {Object.entries(TASK_ICONS).map(([type, icon]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, background: TASK_COLORS[type] }} />
                  <span style={{ color: "#374151", textTransform: "capitalize" }}>{icon} {type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const saveEdit = () => {
    setPlants(prev => prev.map(p => p.id === editingPlant.id ? { ...editingPlant } : p));
    setSelectedPlant({ ...editingPlant });
    setEditingPlant(null);
  };

  const EditModal = () => {
    if (!editingPlant) return null;
    const field = (label, key, multiline) => (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#52a26e", marginBottom: 4 }}>{label}</div>
        {multiline
          ? <textarea value={editingPlant[key] || ""} onChange={e => setEditingPlant(prev => ({ ...prev, [key]: e.target.value }))}
              style={{ width: "100%", border: "1px solid #d1fae5", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", resize: "none", height: 70, fontFamily: "inherit" }} />
          : <input value={editingPlant[key] || ""} onChange={e => setEditingPlant(prev => ({ ...prev, [key]: e.target.value }))}
              style={{ width: "100%", border: "1px solid #d1fae5", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none" }} />
        }
      </div>
    );
    const taskField = (task, key, label, type = "text") => (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, color: "#6b7280", width: 90, flexShrink: 0 }}>{TASK_ICONS[task.type]} {label}</div>
        <input type={type} value={task[key]} onChange={e => setEditingPlant(prev => ({
          ...prev, taches: prev.taches.map(t => t.type === task.type ? { ...t, [key]: type === "number" ? parseInt(e.target.value) || 1 : e.target.value } : t)
        }))} style={{ flex: 1, border: "1px solid #d1fae5", borderRadius: 8, padding: "6px 10px", fontSize: 13, outline: "none" }} />
      </div>
    );
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, overflowY: "auto", padding: "20px 16px" }}>
        <div style={{ background: "white", borderRadius: 20, padding: 20, maxWidth: 430, margin: "0 auto" }}>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 18, fontWeight: 700, color: "#1a3a2a", marginBottom: 16 }}>✏️ Modifier la plante</div>
          {field("Nom commun", "nom")}
          {field("Nom latin", "nom_latin")}
          {field("Emoji", "emoji")}
          {field("Description", "description", true)}
          {field("Luminosité", "luminosite")}
          {field("Humidité", "humidite")}
          {field("Conseil de saison", "conseils_saison", true)}
          {editingPlant.taches?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#52a26e", marginBottom: 8 }}>Fréquences (jours)</div>
              {editingPlant.taches.map(task => taskField(task, "frequence_jours", task.type, "number"))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={() => setEditingPlant(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 12, padding: 14, cursor: "pointer", fontSize: 14 }}>Annuler</button>
            <button onClick={saveEdit} style={{ flex: 2, background: "linear-gradient(135deg, #16a34a, #15803d)", color: "white", border: "none", borderRadius: 12, padding: 14, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>Sauvegarder</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "'Helvetica Neue', sans-serif", maxWidth: 430, margin: "0 auto", background: "#f8faf8", minHeight: "100vh" }}>
      {showKeyInput && <KeyModal />}
      {editingPlant && <EditModal />}
      {view === "home" && renderHome()}
      {view === "add" && renderAdd()}
      {view === "plant" && renderPlant()}
      {view === "calendar" && renderCalendar()}
      {view !== "add" && (
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "white", borderTop: "1px solid #e5f0e8", display: "flex", padding: "8px 0 16px", boxShadow: "0 -4px 20px rgba(0,0,0,0.06)", zIndex: 100 }}>
          {[{ id: "home", icon: "🌿", label: "Plantes" }, { id: "calendar", icon: "📅", label: "Calendrier" }].map(tab => (
            <button key={tab.id} onClick={() => setView(tab.id)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: "8px 0 2px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 22 }}>{tab.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: view === tab.id ? "#16a34a" : "#9ca3af" }}>{tab.label}</span>
            </button>
          ))}
          <button onClick={() => { setPreview(null); setImageData(null); setLoadingMsg(""); setView("add"); }} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: "4px 0 2px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, #16a34a, #15803d)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(22,163,74,0.4)", marginTop: -16 }}>
              <span style={{ fontSize: 24, color: "white" }}>+</span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a" }}>Ajouter</span>
          </button>
        </div>
      )}
    </div>
  );
}
