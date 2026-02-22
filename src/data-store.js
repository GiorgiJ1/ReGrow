import fs from "fs";

export function createStore({ filePath }) {
  function read() {
    if (!fs.existsSync(filePath)) return { shops: [], productionByDay: {}, marketByDay: {} };
    const raw = fs.readFileSync(filePath, "utf-8");
    try {
      const data = JSON.parse(raw);
      data.shops ??= [];
      data.productionByDay ??= {};
      data.marketByDay ??= {};
      return data;
    } catch {
      return { shops: [], productionByDay: {}, marketByDay: {} };
    }
  }

  function write(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  function todayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // deterministic demo seeding so you see non-zero
  function hashToInt(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function seededCups(day, shopId) {
    const n = hashToInt(`${day}:${shopId}`);
    const r = n % 1000;
    if (r < 200) return 0;
    if (r < 750) return 10 + (r % 111);
    return 150 + (r % 171);
  }

  function ensureDaySeeded(data, day) {
    data.productionByDay ??= {};
    data.productionByDay[day] ??= {};
    const prod = data.productionByDay[day];

    const hasAny = (data.shops || []).some((s) =>
      Object.prototype.hasOwnProperty.call(prod, s.id)
    );

    if (!hasAny) {
      for (const s of data.shops || []) {
        prod[s.id] = seededCups(day, s.id);
      }
      write(data);
    }
  }

  function ensureMarketDay(data, day) {
    data.marketByDay ??= {};
    data.marketByDay[day] ??= {};
    return data.marketByDay[day];
  }

  function getMarketEntry(data, day, id) {
    const dayMarket = ensureMarketDay(data, day);
    dayMarket[id] ??= {
      status: "AVAILABLE", // AVAILABLE | RESERVED | SOLD
      reserved_by: null,
      reserved_at: null,
      purchased_by: null,
      purchased_at: null,
      notes: null
    };
    return dayMarket[id];
  }

  return {
    getAll(day = todayISO()) {
      const data = read();
      ensureDaySeeded(data, day);

      const prod = data.productionByDay?.[day] || {};
      const dayMarket = ensureMarketDay(data, day);

      return {
        day,
        shops: (data.shops || []).map((s) => ({
          ...s,
          cups: Number(prod[s.id] ?? 0),
          market: dayMarket[s.id] ?? null
        }))
      };
    },

    setCups({ id, cups, day = todayISO() }) {
      const data = read();
      data.productionByDay ??= {};
      data.productionByDay[day] ??= {};
      data.productionByDay[day][id] = cups;

      // ensure marketplace entry exists too
      getMarketEntry(data, day, id);

      write(data);
      return { ok: true, day, id, cups };
    },

    addShop({ id, name, lat, lng }) {
      const data = read();
      if (data.shops.some((s) => s.id === id)) return { ok: false, error: "ID already exists" };

      data.shops.push({ id, name, lat, lng });

      const day = todayISO();
      data.productionByDay[day] ??= {};
      if (!Object.prototype.hasOwnProperty.call(data.productionByDay[day], id)) {
        data.productionByDay[day][id] = seededCups(day, id);
      }

      getMarketEntry(data, day, id);

      write(data);
      return { ok: true };
    },

    addManyShops(shops) {
      const data = read();
      const existing = new Set(data.shops.map((s) => s.id));
      let added = 0;

      for (const s of shops) {
        if (!s?.id || existing.has(s.id)) continue;
        data.shops.push({ id: s.id, name: s.name, lat: s.lat, lng: s.lng });
        existing.add(s.id);
        added++;
      }

      const day = todayISO();
      data.productionByDay[day] ??= {};
      for (const s of shops) {
        if (!s?.id) continue;
        if (!Object.prototype.hasOwnProperty.call(data.productionByDay[day], s.id)) {
          data.productionByDay[day][s.id] = seededCups(day, s.id);
        }
        getMarketEntry(data, day, s.id);
      }

      write(data);
      return { ok: true, added, total: data.shops.length };
    },

    // ✅ NEW: reserve or buy used grounds
    setMarketAction({ id, action, actor, day = todayISO() }) {
      const data = read();
      ensureDaySeeded(data, day);

      const entry = getMarketEntry(data, day, id);
      const now = new Date().toISOString();

      if (action === "reserve") {
        if (entry.status === "SOLD") return { ok: false, error: "Already sold" };
        entry.status = "RESERVED";
        entry.reserved_by = actor || "anonymous";
        entry.reserved_at = now;
        write(data);
        return { ok: true, day, id, market: entry };
      }

      if (action === "buy") {
        entry.status = "SOLD";
        entry.purchased_by = actor || "anonymous";
        entry.purchased_at = now;
        write(data);
        return { ok: true, day, id, market: entry };
      }

      if (action === "clear") {
        entry.status = "AVAILABLE";
        entry.reserved_by = null;
        entry.reserved_at = null;
        entry.purchased_by = null;
        entry.purchased_at = null;
        write(data);
        return { ok: true, day, id, market: entry };
      }

      return { ok: false, error: "Unknown action" };
    }
  };
}