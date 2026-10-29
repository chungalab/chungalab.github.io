// Leaflet wrapper. Leaflet (global L) is loaded from vendor/leaflet/ by index.html.

import { displayRoute } from "./routenames.js";

const CBD_CENTRE =[-1.286, 36.828];
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Relative to index.html, so marker icons also resolve after the folder is published under /matatu/.
L.Icon.Default.imagePath = "vendor/leaflet/images/";

export function routeHref(route) {
  return "#/route/" + encodeURIComponent(route);
}

// Builds <ul class="chips"> with one link per route number.
export function routeChips(routes) {
  const ul = document.createElement("ul");
  ul.className = "chips";
  for (const r of routes) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = routeHref(r);
    a.textContent = displayRoute(r);
    li.append(a);
    ul.append(li);
  }
  return ul;
}

function popupFor(stage) {
  const box = document.createElement("div");
  box.className = "stage-popup";
  const title = document.createElement("strong");
  title.className = "popup-title";
  title.textContent = stage.label || stage.name;
  const count = document.createElement("div");
  count.className = "popup-count";
  count.textContent = stage.routes.length + (stage.routes.length === 1 ? " route" : " routes");
  const chips = document.createElement("div");
  chips.className = "popup-chips";
  chips.append(routeChips(stage.routes));
  box.append(title, count, chips);
  return box;
}

// Draws a map in `el` with one pin per stage. Returns the Leaflet map (call .remove() to discard it).
// onSelect(stage) runs when a pin is tapped.
export function showStages(el, stages, onSelect) {
  const map = L.map(el).setView(CBD_CENTRE, 15);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

  const points = [];
  map.stageMarkers = new Map(); // stage -> its marker, so focusStage() can find it
  for (const stage of stages) {
    const point = [stage.lat, stage.lon];
    points.push(point);
    const marker = L.marker(point, { title: stage.label || stage.name, alt: stage.label || stage.name });
    map.stageMarkers.set(stage, marker);
    marker
      .addTo(map)
      .bindPopup(popupFor(stage), {
        maxWidth: 260,
        // Keep the popup clear of the zoom buttons (top-left) and the map edges when it pans into view.
        autoPanPaddingTopLeft: [60, 20],
        autoPanPaddingBottomRight: [20, 20],
      })
      .on("click", () => onSelect && onSelect(stage));
  }
  // The pin icon is 41px tall above its point and the zoom buttons sit top-left, so pad more there.
  if (points.length) {
    map.fitBounds(points, {
      paddingTopLeft: [60, 60],
      paddingBottomRight: [40, 30],
      maxZoom: 17,
    });
  }
  return map;
}

// Pans to a stage's pin and opens its popup. Does nothing if the stage isn't on this map.
export function focusStage(map, stage) {
  const marker = map.stageMarkers && map.stageMarkers.get(stage);
  if (!marker) return;
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 17));
  marker.openPopup();
}

// Draws "you are here" as a blue dot. The position is only used to draw it.
export function showUser(map, pos) {
  return L.circleMarker([pos.lat, pos.lon], {
    radius: 8,
    color: "#ffffff",
    weight: 2,
    fillColor: "#2563eb",
    fillOpacity: 1,
  })
    .addTo(map)
    .bindTooltip("You are here");
}
