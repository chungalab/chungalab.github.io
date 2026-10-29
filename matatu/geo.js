// Distance, direction and "nearest stage" helpers, plus a one-shot GPS lookup.
// The position is only held in memory by the caller. It is never stored or sent anywhere.
// Nothing here touches the page or `navigator` until getPosition() is called, so tests.html can import it.

export const FAR_M = 5000; // further than this from every stage: "you're far from the CBD stages"

const EARTH_M = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;
const POINTS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

// a and b are { lat, lon }. Straight-line (haversine) distance in metres.
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

// Compass direction from a to b, as one of 8 words ("north-east").
export function bearingText(a, b) {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return POINTS[Math.round(deg / 45) % 8];
}

// "330 m north-east", or "1.2 km east" from 1 km up. Under 15 m is just "right here".
export function describe(from, to) {
  const m = distanceM(from, to);
  if (m < 15) return "right here";
  const far = m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 10) * 10 + " m";
  return far + " " + bearingText(from, to);
}

// The n closest stages to `pos` ({ lat, lon }), nearest first: [{ stage, distance, text }].
export function nearestStages(pos, stages, n = 3) {
  return stages
    .map((stage) => ({ stage, distance: distanceM(pos, stage), text: describe(pos, stage) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}

// True when even the nearest stage is further than FAR_M. `nearest` comes from nearestStages().
export const isFar = (nearest) => !nearest.length || nearest[0].distance > FAR_M;

// True when the search box holds one of the "show me the nearest stage" phrases (any case) rather than a place.
// Whole phrases only, so a place name such as "Kariobangi" is never taken for one.
const NEAR_ME = ["nearest", "nearest stage", "near me", "stage near me", "karibu", "karibu nami"];
export function isNearMe(text) {
  const t = String(text).toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return NEAR_ME.includes(t);
}

// One-shot GPS lookup. Resolves { lat, lon }; rejects { kind: "denied" | "unavailable" | "timeout" | "unsupported" }.
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject({ kind: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => reject({ kind: err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

// Friendly text for each failure kind (and "far").
export function friendlyMessage(kind) {
  switch (kind) {
    case "denied":
      return "No problem. You can still search by place. To use this later, allow location for this site in your browser settings.";
    case "far":
      return "You're far from the CBD stages. Search for where you're going to see which stage to board at.";
    case "unsupported":
      return "This browser can't share your location. You can still search by place.";
    default:
      return "We couldn't find your location right now. Try again, or search by place.";
  }
}
