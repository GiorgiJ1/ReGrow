const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const addModeBtn = document.getElementById("addModeBtn");
const leaderboardEl = document.getElementById("leaderboard");

const myPicksEl = document.getElementById("myPicks");
const clearAllBtn = document.getElementById("clearAllBtn");

function setStatus(msg) { statusEl.textContent = msg; }

// Grounds estimation knobs (customer-facing values)
const GRAMS_PER_CUP = 12;
const AVAIL_RATE = 0.85;

const map = L.map("map", { zoomControl: true }).setView([56.9496, 24.1052], 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let layer = L.layerGroup().addTo(map);

let addMode = false;
addModeBtn?.addEventListener("click", () => {
  addMode = !addMode;
  addModeBtn.textContent = `Add shop: ${addMode ? "ON" : "OFF"}`;
});

refreshBtn?.addEventListener("click", load);

clearAllBtn?.addEventListener("click", async () => {
  // clear all reserved/bought items
  const picks = getCurrentPicksFromLastLoad();
  if (picks.length === 0) return;

  const ok = confirm(`Clear all (${picks.length}) items back to Available?`);
  if (!ok) return;

  for (const p of picks) {
    await doMarket(p, "clear", { silent: true });
  }
  await load();
});

map.on("click", async (e) => {
  if (!addMode) return;

  const name = prompt("Shop name?");
  if (!name) return;

  const id = prompt("Unique ID? (example: myshop1)");
  if (!id) return;

  const body = { id, name, lat: e.latlng.lat, lng: e.latlng.lng };

  const res = await fetch("/api/shops", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const out = await res.json();
  if (!res.ok || out.ok === false) {
    alert("Failed: " + (out.error || res.status));
    return;
  }

  addMode = false;
  addModeBtn.textContent = "Add shop: OFF";
  await load();
});

// We keep the last loaded shops to render picks + clear all
let LAST_SHOPS = [];

load();

async function load() {
  setStatus("Loading shops…");
  leaderboardEl.textContent = "—";
  layer.clearLayers();

  let data;
  try {
    const res = await fetch("/api/shops");
    data = await res.json();
  } catch (e) {
    setStatus("Failed to load /api/shops\n" + String(e));
    return;
  }

  const shops = data.shops || [];
  LAST_SHOPS = shops;

  setStatus(`Day: ${data.day}\nShops: ${shops.length}\nClick circles to reserve / buy.`);

  renderLeaderboard(shops);
  renderMyPicks(shops);

  const bounds = [];
  for (const shop of shops) {
    bounds.push([shop.lat, shop.lng]);

    const style = styleForCups(shop.cups);

    const circle = L.circleMarker([shop.lat, shop.lng], {
      radius: style.radius,
      color: style.color,
      weight: 2,
      fillColor: style.color,
      fillOpacity: 0.35
    });

    circle.on("click", () => openMarketplacePanel(shop, circle));
    circle.bindTooltip(`${shop.name} • ${shop.cups} cups`, { sticky: true });
    circle.addTo(layer);
  }

  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
}

function getCurrentPicksFromLastLoad() {
  return (LAST_SHOPS || []).filter((s) => {
    const st = String(s?.market?.status || "AVAILABLE").toUpperCase();
    return st === "RESERVED" || st === "SOLD";
  });
}

/* -------------------- Right panel: leaderboard -------------------- */

function renderLeaderboard(shops) {
  const sorted = [...shops]
    .sort((a, b) => (b.cups ?? 0) - (a.cups ?? 0))
    .slice(0, 8);

  if (sorted.length === 0) {
    leaderboardEl.textContent = "No shops yet.";
    return;
  }

  leaderboardEl.innerHTML = sorted.map(s => `
    <div class="lb-row">
      <div class="name">${escapeHtml(s.name)}</div>
      <div class="cups">${Number(s.cups ?? 0)} cups</div>
    </div>
  `).join("");
}

/* -------------------- Left panel: My picks -------------------- */

function renderMyPicks(shops) {
  const picks = shops
    .map((s) => ({
      ...s,
      _status: String(s?.market?.status || "AVAILABLE").toUpperCase()
    }))
    .filter((s) => s._status === "RESERVED" || s._status === "SOLD")
    .sort((a, b) => {
      // SOLD first, then RESERVED, then by available kg desc
      const rank = (st) => (st === "SOLD" ? 0 : 1);
      const ar = availableKg(a.cups);
      const br = availableKg(b.cups);
      return rank(a._status) - rank(b._status) || (br - ar);
    });

  if (!picks.length) {
    myPicksEl.innerHTML = `<div class="empty">No reserved/bought items yet. Click a location and reserve/buy.</div>`;
    clearAllBtn.disabled = true;
    return;
  }

  clearAllBtn.disabled = false;

  myPicksEl.innerHTML = picks.map((p) => {
    const st = p._status;
    const badgeColor = statusColor(st);
    const badgeText = statusLabel(st);

    const cups = Number(p.cups ?? 0);
    const ready = availableKg(cups);

    return `
      <div class="pick" data-id="${escapeHtml(p.id)}">
        <div class="pick-top">
          <div class="pick-name">${escapeHtml(p.name)}</div>
          <div class="pick-badge" style="color:${badgeColor}">${badgeText}</div>
        </div>

        <div class="pick-meta">
          <div class="pick-row"><span>cups today</span><b>${cups}</b></div>
          <div class="pick-row"><span>ready for reuse</span><b>${formatKg(ready)}</b></div>
        </div>

        <div class="pick-actions">
          <button class="removeBtn" data-id="${escapeHtml(p.id)}">Remove</button>
          <button class="focusBtn" data-lat="${p.lat}" data-lng="${p.lng}">Focus</button>
        </div>
      </div>
    `;
  }).join("");

  // wire buttons (event delegation)
  myPicksEl.querySelectorAll(".removeBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const shop = (LAST_SHOPS || []).find((s) => s.id === id);
      if (!shop) return;
      await doMarket(shop, "clear");
      await load();
    });
  });

  myPicksEl.querySelectorAll(".focusBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lat = Number(btn.getAttribute("data-lat"));
      const lng = Number(btn.getAttribute("data-lng"));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
    });
  });
}

/* -------------------- Map styling (unchanged behavior) -------------------- */

function styleForCups(cups) {
  const c = Math.max(0, Number(cups || 0));
  const radius = clamp(7 + Math.sqrt(c) * 1.25, 7, 34);

  let color = "#37d67a";
  if (c >= 60) color = "#f6c945";
  if (c >= 200) color = "#ff4d4d";

  return { radius, color };
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

/* -------------------- Customer numbers -------------------- */

function calcGroundsKg(cups) {
  const grams = Math.max(0, cups) * GRAMS_PER_CUP;
  return grams / 1000;
}
function availableKg(cups) {
  return calcGroundsKg(cups) * AVAIL_RATE;
}
function formatKg(x) { return `${x.toFixed(2)} kg`; }

/* -------------------- Status helpers -------------------- */

function statusColor(status) {
  const s = String(status || "AVAILABLE").toUpperCase();
  if (s === "SOLD") return "#ff4d4d";
  if (s === "RESERVED") return "#f6c945";
  return "#37d67a";
}
function statusLabel(status) {
  const s = String(status || "AVAILABLE").toUpperCase();
  if (s === "SOLD") return "Bought";
  if (s === "RESERVED") return "Reserved";
  return "Available";
}

/* -------------------- Popup (keep map look; only shows customer-friendly info) -------------------- */

function openMarketplacePanel(shop, circle) {
  const cups = Number(shop.cups ?? 0);
  const groundsKg = calcGroundsKg(cups);
  const readyKg = groundsKg * AVAIL_RATE;

  const market = shop.market || { status: "AVAILABLE" };
  const st = market.status || "AVAILABLE";

  // keep your “nice popup” look; hide non-essential text
  const html = `
    <div style="min-width:320px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px">
        <div style="font-weight:900;font-size:20px;line-height:1.1">${escapeHtml(shop.name)}</div>
        <div style="
          padding:6px 12px;border-radius:999px;
          border:1px solid rgba(0,0,0,.06);
          background: rgba(0,0,0,.04);
          font-weight:900;
          color:${statusColor(st)};
          ">
          ${statusLabel(st)}
        </div>
      </div>

      <div style="display:grid;gap:10px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="opacity:.75">cups today</div>
          <div style="font-weight:900">${cups}</div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="opacity:.75">used grounds (est.)</div>
          <div style="font-weight:900">${formatKg(groundsKg)}</div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="opacity:.75">ready for reuse</div>
          <div style="font-weight:900">${formatKg(readyKg)}</div>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
        <button id="reserveBtn"
          style="flex:1;min-width:95px;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.08);
                 background: rgba(0,0,0,.04); font-weight:900; cursor:pointer">
          Reserve
        </button>

        <button id="buyBtn"
          style="flex:1;min-width:95px;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.08);
                 background: rgba(0,0,0,.07); font-weight:900; cursor:pointer">
          Buy
        </button>

        <button id="clearBtn"
          style="flex:1;min-width:95px;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.08);
                 background: rgba(0,0,0,.02); font-weight:900; cursor:pointer">
          Reset
        </button>
      </div>
    </div>
  `;

  circle.bindPopup(html, { maxWidth: 420 }).openPopup();

  setTimeout(() => {
    const reserveBtn = document.getElementById("reserveBtn");
    const buyBtn = document.getElementById("buyBtn");
    const clearBtn = document.getElementById("clearBtn");

    if (reserveBtn) reserveBtn.onclick = async () => { await doMarket(shop, "reserve"); await load(); };
    if (buyBtn) buyBtn.onclick = async () => { await doMarket(shop, "buy"); await load(); };
    if (clearBtn) clearBtn.onclick = async () => { await doMarket(shop, "clear"); await load(); };
  }, 0);
}

/* -------------------- Market API -------------------- */

async function doMarket(shop, action, opts = {}) {
  const actor = "consumer";

  try {
    const res = await fetch(`/api/market/${encodeURIComponent(shop.id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, actor })
    });

    const out = await res.json();
    if (!res.ok || out.ok === false) {
      if (!opts.silent) alert("Action failed: " + (out.error || res.status));
      return;
    }

    if (!opts.silent) setStatus(`Action '${action}' saved for ${shop.name}`);
  } catch (e) {
    if (!opts.silent) alert("Network error: " + String(e));
  }
}

/* -------------------- Utils -------------------- */

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}