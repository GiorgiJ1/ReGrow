const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * Fetch Narvesen locations in Latvia from OpenStreetMap Overpass.
 * Returns array of { id, name, lat, lng } with stable IDs.
 */
export async function fetchNarvesenLatvia({ timeoutSec = 60 } = {}) {
  // Latvia as area by ISO code.
  // "nwr" = nodes/ways/relations.
  const query = `
[out:json][timeout:${timeoutSec}];
area["ISO3166-1"="LV"][admin_level=2]->.lv;

(
  nwr(area.lv)["brand"="Narvesen"];
  nwr(area.lv)["name"~"Narvesen",i];
);

out center tags;
`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: query })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  const shops = elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (typeof lat !== "number" || typeof lng !== "number") return null;

      const tags = el.tags ?? {};
      const name =
        tags.name ||
        (tags.brand ? `${tags.brand}` : null) ||
        "Narvesen";

      // Stable unique id so duplicates don’t happen across imports
      const id = `osm:${el.type}:${el.id}`;

      return { id, name, lat, lng };
    })
    .filter(Boolean);

  // Some OSM data may include weird duplicates; dedupe by id
  const seen = new Set();
  return shops.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}