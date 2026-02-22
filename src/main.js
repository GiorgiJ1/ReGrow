import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createStore } from "./data-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 3000);

const store = createStore({
  filePath: path.join(__dirname, "..", "data.json")
});

// Serve Leaflet locally
app.use("/leaflet", express.static(path.join(__dirname, "..", "node_modules", "leaflet", "dist")));

// Serve frontend
app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));

app.get("/favicon.ico", (req, res) => res.status(204).end());
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/shops", (req, res) => {
  const day = typeof req.query.day === "string" ? req.query.day : undefined;
  res.json(store.getAll(day));
});

app.post("/api/shops/:id/cups", (req, res) => {
  const id = req.params.id;
  const cups = Number(req.body?.cups);
  const day = typeof req.body?.day === "string" ? req.body.day : undefined;

  if (!Number.isFinite(cups) || cups < 0) {
    return res.status(400).json({ ok: false, error: "cups must be a non-negative number" });
  }
  res.json(store.setCups({ id, cups, day }));
});

app.post("/api/shops", (req, res) => {
  const { id, name, lat, lng } = req.body ?? {};
  if (!id || !name) return res.status(400).json({ ok: false, error: "id and name required" });

  const nlat = Number(lat), nlng = Number(lng);
  if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) {
    return res.status(400).json({ ok: false, error: "lat/lng must be numbers" });
  }
  res.json(store.addShop({ id, name, lat: nlat, lng: nlng }));
});

// ✅ NEW: marketplace action: reserve/buy/clear
app.post("/api/market/:id", (req, res) => {
  const id = req.params.id;
  const action = String(req.body?.action || "");
  const actor = typeof req.body?.actor === "string" ? req.body.actor : "consumer";
  const day = typeof req.body?.day === "string" ? req.body.day : undefined;

  if (!["reserve", "buy", "clear"].includes(action)) {
    return res.status(400).json({ ok: false, error: "action must be reserve|buy|clear" });
  }

  res.json(store.setMarketAction({ id, action, actor, day }));
});

app.listen(PORT, () => console.log(`App running on http://localhost:${PORT}`));