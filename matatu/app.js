// Entry point: loads the data and runs the hash router
// (#/ home, #/results?q=, #/route/<number>?to=<place>, #/report?route=&stage=&to=, #/terms).
import { showStages as rawShowStages, routeChips, focusStage, showUser } from "./map.js";
import { getPosition, nearestStages, isFar, friendlyMessage, isNearMe } from "./geo.js";
import { displayRoute, initRouteNames } from "./routenames.js";
import { parseCorrections, isHidden, visibleData, verifiedLabel, verifiedFirst, groupMates } from "./corrections.js";
import { REASONS, reportHref, buildReport, sendReport } from "./report.js";
import {
  buildIndex,
  search as rawSearch,
  didYouMean as rawDidYouMean,
  plansForPlace,
  stopsText,
  stageLabel,
  normalise,
} from "./search.js";

// TEMPORARY performance timing, logged to the Console with a "[perf]" prefix. Measuring only, nothing is
// optimised. Set PERF = false to switch every log (and the wrappers below) off.
const PERF = false;
const perfLog = (...args) => PERF && console.log("[perf]", ...args);
const since = (t) => (performance.now() - t).toFixed(1) + " ms";
let perfCalls = 0; // search() calls and their total time during the current keystroke
let perfCallMs = 0;
let perfWord = { keys: 0, calls: 0 }; // running totals for the word being typed; reset on a new screen

function search(idx, q, limit) {
  if (!PERF) return rawSearch(idx, q, limit);
  const t = performance.now();
  const res = rawSearch(idx, q, limit);
  const dt = performance.now() - t;
  perfCalls++;
  perfCallMs += dt;
  perfLog('search("' + q + '"): ' + dt.toFixed(2) + " ms, " + res.places.length + " places");
  return res;
}

function didYouMean(idx, q) {
  if (!PERF) return rawDidYouMean(idx, q);
  const t = performance.now();
  const guess = rawDidYouMean(idx, q);
  perfLog('didYouMean("' + q + '"): ' + since(t) + " -> " + guess);
  return guess;
}

// Map: how long the Leaflet map takes to create, and (when tiles can load) until its first full set of tiles.
function showStages(box, list, onSelect) {
  if (!PERF) return rawShowStages(box, list, onSelect);
  const t = performance.now();
  const m = rawShowStages(box, list, onSelect);
  perfLog("map: " + list.length + " stage" + (list.length === 1 ? "" : "s") + " created in " + since(t));
  m.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) layer.once("load", () => perfLog("map: tiles loaded " + since(t) + " after creation"));
  });
  return m;
}

// Wraps one input event: time of the whole handler (search + building the suggestion rows), how many
// search() calls it made, and the running count for the word being typed.
function perfKeystroke(value, run) {
  perfCalls = 0;
  perfCallMs = 0;
  const t = performance.now();
  run();
  perfWord.keys++;
  perfWord.calls += perfCalls;
  perfLog(
    'typed "' + value + '": handler ' + since(t) + " (search " + perfCallMs.toFixed(2) + " ms in " + perfCalls +
      " call" + (perfCalls === 1 ? "" : "s") + "); this word so far: " + perfWord.keys + " keystrokes, " +
      perfWord.calls + " search() calls",
  );
}

const DATA_NOTE = "Based on 2019 data - confirm with the conductor.";

const EXAMPLES = ["Rongai", "Kariobangi", "Kahawa", "Kangemi", "Ngong", "Githurai"];

const screen = document.getElementById("screen");
let stages = [];
let index = null;
let corrections = parseCorrections(null); // replaced by start(); empty means no badges and nothing hidden

// Results order: verified routes first. (search.js already ordered them by stops; that order is kept within each group.)
const plansFor = (place) => verifiedFirst(plansForPlace(index, place), corrections);
// A plan-shaped record for a route that does not stop at the place being shown (an "other loop"): no stop count.
function offPlacePlan(name) {
  const ri = index.routes.findIndex((r) => r.short_name === name);
  if (ri < 0) return null;
  return { route: name, longName: index.routes[ri].long_name, board: index.info[ri].board, stopsToGo: null };
}
// The "✓ Verified Oct 2026" badge as a list of nodes: empty for routes that are not verified.
const badge = (route) => {
  const text = verifiedLabel(corrections, route);
  return text ? [el("small", "verified", text)] : [];
};
let longNames = new Map(); // original route value -> full long_name, for the report screen
let map = null;
let wantNearest = false; // set when "near me" is typed: Home runs "Nearest stage" as soon as it is drawn

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(...children) {
  const s = el("section");
  s.append(...children);
  return s;
}

const label = (stage) => stage.label || stage.name;
const resultsHref = (q) => "#/results?" + new URLSearchParams({ q });
const planHref = (route, placeKey) =>
  "#/route/" + encodeURIComponent(route) + "?" + new URLSearchParams({ to: placeKey });

function link(href, text, className) {
  const a = el("a", className, text);
  a.href = href;
  return a;
}

// Example searches as chips (shown before typing and when nothing matched).
function exampleChips() {
  const ul = el("ul", "chips");
  for (const name of EXAMPLES) {
    const li = el("li");
    li.append(link(resultsHref(name), name));
    ul.append(li);
  }
  return ul;
}

// Changing the hash fires "hashchange", which renders the new screen (and gives Back one entry per search).
// If the address is already the same, nothing would fire, so render directly.
function go(href) {
  if (new URL(href, location.href).href === location.href) route();
  else location.hash = href;
}

function searchForm(value, onInput) {
  const form = el("form", "search-form");
  form.setAttribute("role", "search");
  const input = el("input");
  input.type = "search";
  input.name = "q";
  input.value = value;
  input.placeholder = "Where are you going?";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.enterKeyHint = "search";
  input.setAttribute("aria-label", "Search for a destination");
  const button = el("button", "", "Search");
  button.type = "submit";
  form.append(input, button);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (isNearMe(q)) {
      wantNearest = true;
      go("#/");
    } else if (q) go(resultsHref(q));
  });
  if (onInput) {
    input.addEventListener("input", () => {
      if (PERF) perfKeystroke(input.value, () => onInput(input.value));
      else onInput(input.value);
    });
  }
  return form;
}

// "No places match" help: a "Did you mean" link when a close spelling exists, plus example chips.
function notFoundNodes(query) {
  const nodes = [el("p", "no-results", "No results for “" + query.trim() + "”.")];
  const guess = didYouMean(index, query);
  if (guess) {
    // A close spelling is the help; the generic example chips only appear when there is none.
    const p = el("p", "did-you-mean", "Did you mean ");
    p.append(link(resultsHref(guess), guess), "?");
    nodes.push(p);
    return nodes;
  }
  nodes.push(el("p", "muted", "Or try one of these:"), exampleChips());
  return nodes;
}

function suggestionNodes(value) {
  if (normalise(value).length < 2) return [el("p", "muted", "Type 2 or more letters, or try:"), exampleChips()];
  const res = search(index, value, 8);
  if (!res.places.length) return notFoundNodes(value);
  const ul = el("ul", "suggest-list");
  for (const { place } of res.places) {
    const plans = plansFor(place);
    const first = plans.find((p) => p.board);
    const sub = first
      ? "Route " + displayRoute(first.route) + " · board at " + label(first.board) + (plans.length > 1 ? " (+" + (plans.length - 1) + " more)" : "")
      : "No CBD stage in our data";
    const li = el("li");
    const a = link(resultsHref(place.name), "");
    a.append(el("span", "place-name", place.name), el("span", "sub", sub));
    li.append(a);
    ul.append(li);
  }
  return [ul];
}

// Search box plus live suggestions, shown on every screen. Home also shows example chips before typing.
// startNodes, if given, fill the list at first (a results screen with no matches shows its help here,
// so there is only ever one help panel).
function searchSection(value, isHome, startNodes) {
  const list = el("div", "suggestions");
  list.setAttribute("aria-live", "polite");
  let sec = null;
  const same = (v) => normalise(v) === normalise(value);
  const show = (v) => {
    if (!isHome && same(v)) list.replaceChildren(...(startNodes || []));
    else list.replaceChildren(...(isHome || normalise(v).length >= 2 ? suggestionNodes(v) : []));
    if (isHome || !sec || !sec.parentNode) return;
    // The rest of this screen belongs to the query it was drawn for. While the box says something else
    // (2+ letters), hide it so the live suggestions are the only content; typing the original back restores it.
    const stale = !same(v) && normalise(v).length >= 2;
    for (const other of sec.parentNode.children) if (other !== sec) other.hidden = stale;
    if (!stale) window.dispatchEvent(new Event("resize")); // lets a hidden Leaflet map redraw
  };
  if (startNodes) list.replaceChildren(...startNodes);
  else show("");
  const form = searchForm(value, show);
  // The little x in a search box fires "search" with an empty value: go back to the normal Home screen.
  if (!isHome) {
    form.querySelector("input").addEventListener("search", (e) => {
      if (!e.target.value.trim()) go("#/");
    });
  }
  sec = section(form, list);
  return sec;
}

function statusLine(text) {
  const p = el("p", "muted", text);
  p.setAttribute("role", "status");
  return p;
}

// "Nearest stage": asks for the position only when the button is tapped, then lists the 3 closest stages.
// The position is used to draw the list and a dot on the map, then forgotten. It is never sent anywhere.
function nearestSection(mapBox, select) {
  const button = el("button", "near-btn", "Nearest stage");
  button.type = "button";
  const out = el("div", "near");
  out.setAttribute("aria-live", "polite");
  let dot = null;

  button.addEventListener("click", async () => {
    const thisMap = map;
    button.disabled = true;
    out.replaceChildren(statusLine("Finding your location…"));
    let pos;
    try {
      pos = await getPosition();
    } catch (err) {
      if (map === thisMap) out.replaceChildren(statusLine(friendlyMessage(err && err.kind)));
      button.disabled = false;
      return;
    }
    button.disabled = false;
    if (map !== thisMap) return; // the person moved to another screen while we waited

    const nearest = nearestStages(pos, stages, 3);
    if (isFar(nearest)) {
      out.replaceChildren(statusLine(friendlyMessage("far")));
      return;
    }
    if (dot) dot.remove();
    dot = showUser(map, pos);

    const list = el("ul", "near-list");
    for (const { stage, text } of nearest) {
      const pick = el("button", "near-pick");
      pick.type = "button";
      pick.append(el("strong", "", label(stage)), el("span", "muted", text));
      pick.addEventListener("click", () => {
        select(stage);
        focusStage(map, stage);
        mapBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      const li = el("li", "near-item");
      li.append(pick, routeChips(stage.routes));
      list.append(li);
    }
    out.replaceChildren(el("h3", "", "Nearest stages"), list);
  });

  return section(button, out);
}

function renderHome() {
  const mapBox = el("div", "map");
  const info = el("div", "stage-info");
  info.setAttribute("aria-live", "polite");
  const select = (stage) => info.replaceChildren(el("h3", "", label(stage)), routeChips(stage.routes));
  const mapSection = section(
    el("h2", "", "All CBD stages (" + stages.length + ")"),
    el("p", "muted", "Tap a pin to see the matatu routes that board there."),
    mapBox,
    info,
  );

  const near = nearestSection(mapBox, select);
  screen.replaceChildren(searchSection("", true), near, mapSection);
  map = showStages(mapBox, stages, select);
  if (wantNearest) {
    wantNearest = false;
    near.querySelector(".near-btn").click(); // same code path as tapping the button
  }
}

// The small "Report a mistake" link. On a card it sits beside the card's own link, never inside it.
const reportLink = (plan, place) =>
  link(reportHref({ route: plan.route, stage: plan.board ? label(plan.board) : "", to: place.name }), "Report a mistake", "report-link");

function routeCard(plan, place) {
  const a = link(planHref(plan.route, place.key), "", "card");
  const body = el("span", "card-body");
  body.append(
    el("strong", "", plan.board ? "Board at: " + label(plan.board) : "No CBD stage in our data"),
    el("span", "muted", plan.longName),
    el(
      "span",
      "muted",
      plan.stopsToGo === null
        ? "Does not stop at " + place.name
        : stopsText(plan.stopsToGo) + (plan.stopsToGo ? " to " + place.name : ""),
    ),
    ...badge(plan.route),
    el("small", "data-note", DATA_NOTE),
  );
  a.append(el("span", "route-number", displayRoute(plan.route)), body);
  const wrap = el("div", "card-wrap");
  wrap.append(a, reportLink(plan, place));
  return wrap;
}

function placeGroup(place, open) {
  const details = el("details", "place");
  details.open = open;
  const plans = plansFor(place);
  const summary = el("summary");
  summary.append(el("span", "place-name", place.name), el("span", "muted", plans.length + (plans.length === 1 ? " route" : " routes")));
  details.append(summary);

  const boarded = plans.filter((p) => p.board);
  const others = plans.filter((p) => !p.board);
  // Routes in a corrections "group" (the two loops of route 14) are shown together: when a place shows one of
  // them, the group mates that do not stop here appear right below it, even though they miss this exact place.
  const shown = new Set(plans.map((p) => p.route));
  for (const plan of boarded) {
    details.append(routeCard(plan, place));
    const missing = groupMates(corrections, plan.route).filter((r) => !shown.has(r));
    const extra = missing.map(offPlacePlan).filter(Boolean);
    if (!extra.length) continue;
    details.append(el("small", "group-line", "Other loop to Kariobangi"));
    for (const mate of extra) {
      shown.add(mate.route);
      details.append(routeCard(mate, place));
    }
  }
  if (others.length) {
    details.append(el("h3", "group-title", "Doesn’t pass a CBD stage"));
    for (const plan of others) details.append(routeCard(plan, place));
  }
  return details;
}

// Draws the results for q. Returns false (and draws nothing) when there are none; the caller then
// shows the help panel under the search box instead.
function renderResults(q) {
  const res = search(index, q, 8);
  if (!res.places.length) {
    screen.replaceChildren();
    return false;
  }
  const body = section(el("h2", "", "Places matching “" + q.trim() + "”"));
  if (res.alias) body.append(el("p", "muted", "Showing results for “" + res.alias + "”."));
  body.append(el("p", "muted", "Tap a place to see its routes, then a route to see the stage on the map."));
  res.places.forEach(({ place }, i) => body.append(placeGroup(place, i === 0)));
  screen.replaceChildren(body);
  return true;
}

// A route seen from a destination: board stage on the map, then the stops in order.
function renderPlan(plan, place) {
  const head = section(
    link(resultsHref(place.name), "← Back to results", "back"),
    el("h2", "", "Route"),
    el("span", "route-number", displayRoute(plan.route)),
  );
  head.append(
    el("p", "lead", plan.board ? "Board at: " + label(plan.board) : "This route does not pass a CBD stage."),
    el("p", "muted", plan.longName),
    el("p", "muted", stopsText(plan.stopsToGo) + (plan.stopsToGo ? " to " + place.name : " at " + place.name)),
  );
  if (plan.approx) {
    head.append(el("p", "muted", "This place is only listed on the trip into town, so the stop count is approximate."));
  }
  head.append(...badge(plan.route), el("small", "data-note", DATA_NOTE), reportLink(plan, place));
  const sections = [head];

  const mapBox = el("div", "map");
  if (plan.board) {
    // A plain link: phones open their Maps app in walking mode. No API key, nothing sent from this page.
    const directions = link(
      "https://www.google.com/maps/dir/?" +
        new URLSearchParams({ api: "1", destination: plan.board.lat + "," + plan.board.lon, travelmode: "walking" }),
      "Directions to stage",
      "directions",
    );
    directions.target = "_blank";
    directions.rel = "noopener";
    sections.push(section(el("h2", "", "Where to board"), mapBox, directions));
  }

  const ol = el("ol", "stop-order");
  plan.stops.forEach((name, i) => {
    const li = el("li", i === plan.stops.length - 1 ? "dest" : "", name);
    if (i === plan.stops.length - 1) li.append(el("span", "tag", " ← you get off here"));
    ol.append(li);
  });
  sections.push(section(el("h2", "", "Stops to " + place.name), ol));

  const others = plan.board ? stages.filter((s) => s !== plan.board && s.routes.includes(plan.route)) : [];
  if (others.length) {
    const ul = el("ul", "stage-list");
    for (const s of others) ul.append(el("li", "", label(s)));
    sections.push(section(el("h2", "", "Also boards at"), ul));
  }

  screen.replaceChildren(...sections);
  if (plan.board) map = showStages(mapBox, [plan.board]);
}

// A route with no destination (tapped from a map pin): just the stages it boards at.
function renderRouteOnly(route) {
  const served = stages.filter((s) => s.routes.includes(route));

  const back = link("#/", "← All stages", "back");
  const head = section(back, el("h2", "", "Route"), el("span", "route-number", displayRoute(route)));

  if (!served.length) {
    head.append(el("p", "muted", "No CBD stage found for this route."));
    screen.replaceChildren(head);
    return;
  }

  const list = el("ul", "stage-list");
  for (const s of served) list.append(el("li", "", label(s)));
  const first = served[0];
  head.append(
    el("p", "muted", "Board at:"),
    list,
    ...badge(route),
    el("small", "data-note", DATA_NOTE),
    link(reportHref({ route, stage: served.length === 1 ? label(first) : "" }), "Report a mistake", "report-link"),
  );

  const mapBox = el("div", "map");
  screen.replaceChildren(head, section(el("h2", "", "Where to board"), mapBox));
  map = showStages(mapBox, served);
}

function renderRoute(name, placeKey) {
  if (isHidden(corrections, name)) {
    screen.replaceChildren(
      section(link("#/", "← Back to home", "back"), el("h2", "", "Route"), el("p", "lead", "This route is no longer listed.")),
    );
    return;
  }
  const place = placeKey && index.places.get(placeKey);
  const plan = place && plansForPlace(index, place).find((p) => p.route === name);
  if (plan) renderPlan(plan, place);
  else renderRouteOnly(name);
}

// "Report a mistake": the route, stage and destination come from the address and are shown as text. The person
// taps what is wrong, then Send. Location is read only if they tap 📍. Their choices stay on screen if sending fails.
function renderReport(params) {
  const route = params.get("route") || "";
  const stage = params.get("stage") || "";
  const to = params.get("to") || "";
  const display = route ? displayRoute(route) : "";
  const name = longNames.get(route) || "";
  let reason = "";
  let pos = null;

  const summary = el("p", "report-summary");
  const facts = [
    route && ["Route", display + (name ? " – " + name : "")],
    stage && ["Board at", stage],
    to && ["Going to", to],
  ].filter(Boolean);
  facts.forEach(([k, v], i) => {
    if (i) summary.append(el("br"));
    summary.append(el("strong", "", k + ": "), v);
  });

  const status = statusLine("");
  const send = el("button", "report-send", "Send report");
  send.type = "submit";
  send.disabled = true;

  const reasonBox = el("div", "reasons");
  reasonBox.setAttribute("role", "group");
  reasonBox.setAttribute("aria-label", "What’s wrong?");
  const reasonButtons = REASONS.map((text) => {
    const b = el("button", "reason-btn", text);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      reason = text;
      for (const other of reasonButtons) other.setAttribute("aria-pressed", String(other === b));
      send.disabled = false;
    });
    return b;
  });
  reasonBox.append(...reasonButtons);

  const here = el("button", "report-here", "📍 I’m standing at the new stage");
  here.type = "button";
  here.addEventListener("click", async () => {
    here.disabled = true;
    status.textContent = "Finding your location…";
    try {
      pos = await getPosition();
      here.textContent = "📍 Location added";
      status.textContent = "Thanks. Your location will be sent with this report.";
    } catch (err) {
      here.disabled = false;
      status.textContent = friendlyMessage(err && err.kind) + " You can still send the report without it.";
    }
  });

  const details = el("textarea");
  details.id = "report-details";
  details.name = "details";
  details.rows = 3;
  details.maxLength = 500;
  const detailsLabel = el("label", "", "Details (optional)");
  detailsLabel.htmlFor = details.id;

  // Honeypot: hidden from people; bots fill it in. Formspree drops reports where it is not empty.
  const trap = el("input");
  trap.type = "text";
  trap.name = "_gotcha";
  trap.tabIndex = -1;
  trap.autocomplete = "off";
  trap.setAttribute("aria-hidden", "true");
  const trapBox = el("div", "report-trap");
  trapBox.append(trap);

  const form = el("form", "report-form");
  form.append(
    el("h3", "", "What’s wrong?"),
    reasonBox,
    here,
    detailsLabel,
    details,
    trapBox,
    send,
    status,
    el("p", "muted", "No name, phone or email needed. A person checks every report."),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!reason) return;
    send.disabled = true;
    status.textContent = "Sending…";
    const result = await sendReport(
      buildReport({ route, display, name, stage, to, reason, details: details.value, pos, gotcha: trap.value }),
    );
    if (result.ok) {
      form.replaceChildren(el("p", "lead", "Asante sana! Your report helps every commuter on this route."), link("#/", "← Back to home", "back"));
      return;
    }
    send.disabled = false; // choices stay as they are
    status.textContent = result.offline
      ? "You seem to be offline. Your choices are kept. Please try again when you have a connection."
      : "Sorry, that did not go through. Your choices are kept. Please tap Send report again.";
  });

  screen.replaceChildren(
    section(link("#/", "← Back to home", "back"), el("h2", "", "Report a mistake"), summary, form),
  );
}

// Terms and privacy: plain text, no data needed. Add or change points here; keep the language simple.
function renderTerms() {
  const heading = (text) => el("h3", "", text);
  const list = (...items) => {
    const ul = el("ul");
    for (const item of items) ul.append(el("li", "", item));
    return ul;
  };
  const outside = (href, text) => {
    const a = link(href, text);
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  };

  const credits = el("ul");
  const osm = el("li", "", "Map tiles and map data: © ");
  osm.append(outside("https://www.openstreetmap.org/copyright", "OpenStreetMap contributors"), ".");
  credits.append(el("li", "", "Route data: Digital Matatus (2019)."), osm);

  const questions = el("p", "", "Questions or corrections? Please use the contact form: ");
  questions.append(outside("https://chungalab.github.io/contact.html", "chungalab.github.io/contact.html"));

  const body = section(
    link("#/", "← Back to home", "back"),
    el("h2", "", "Terms and privacy"),
    heading("What this app is"),
    el("p", "", "A free guide to matatu stages in the Nairobi CBD. It is not official. It is not linked to any sacco, county government or NTSA."),
    heading("About the information"),
    list(
      "The routes come from Digital Matatus (2019), plus corrections from users.",
      "It may be out of date.",
      "Always confirm with the conductor before you board.",
      "The app does not show fares or timetables.",
      "Please travel safely.",
      "Corrections are checked by a person before anything is changed.",
      "If you tap “Report a mistake”, your report is sent through Formspree to our email. Every report is checked by a person before any change is made.",
    ),
    heading("Privacy"),
    list(
      "No account, no tracking and no ads.",
      "Your location is used only when you tap a button, such as “Nearest stage”. For “Nearest stage” it stays on your phone and we never receive it.",
      "A report includes your location only if you tap the 📍 button on the report screen. Reports have no name, phone or email.",
      "“Directions to stage” opens Google Maps. Google Maps then sees the stage location.",
      "Map pictures (tiles) come from OpenStreetMap.",
    ),
    heading("No guarantee"),
    el("p", "", "The app is provided “as is”, with no guarantee that it is correct or always available."),
    heading("Credits"),
    credits,
    heading("Contact"),
    questions,
    heading("Your choice"),
    el("p", "", "Using this app is your choice. By using it, you accept these terms."),
    el("p", "swahili", "Kwa ufupi: Hii ni mwongozo tu. Thibitisha na kondakta kabla ya kupanda."),
  );
  body.classList.add("terms");
  screen.replaceChildren(body);
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const cut = raw.indexOf("?");
  const path = cut < 0 ? raw : raw.slice(0, cut);
  const params = new URLSearchParams(cut < 0 ? "" : raw.slice(cut + 1));
  try {
    return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), params };
  } catch (err) {
    return { parts: [], params };
  }
}

function route() {
  if (map) {
    map.remove();
    map = null;
  }
  const { parts, params } = parseHash();
  perfWord = { keys: 0, calls: 0 };
  const perfStart = performance.now();
  let perfScreen = "home";
  try {
    if (parts[0] === "results" && normalise(params.get("q") || "")) {
      const q = params.get("q");
      perfScreen = 'results "' + q + '"';
      const found = renderResults(q);
      screen.prepend(searchSection(q, false, found ? null : notFoundNodes(q)));
      if (!found) perfScreen += " (no results)";
    } else if (parts[0] === "results") {
      // An empty query never gets a results or no-results panel: show Home and fix the address.
      renderHome();
      history.replaceState(null, "", "#/");
    } else if (parts[0] === "terms") {
      perfScreen = "terms";
      renderTerms();
      screen.prepend(searchSection("", false));
    } else if (parts[0] === "report") {
      perfScreen = "report";
      renderReport(params);
      screen.prepend(searchSection("", false));
    } else if (parts[0] === "route" && parts[1]) {
      perfScreen = "route " + parts[1];
      renderRoute(parts[1], params.get("to"));
      screen.prepend(searchSection("", false));
    } else {
      renderHome();
    }
    perfLog("render " + perfScreen + ": " + since(perfStart) + " (includes the map when the screen has one)");
  } catch (err) {
    // Never leave the previous screen showing as if it were the new one.
    console.error(err);
    screen.replaceChildren(
      searchSection("", false),
      section(el("h2", "", "Something went wrong"), el("p", "muted", "Try another search, or reload the page.")),
    );
  }
  window.scrollTo(0, 0);
}

async function loadJson(url, required) {
  try {
    const t0 = performance.now();
    const res = await fetch(url);
    const t1 = performance.now();
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    perfLog("fetch " + url + ": response " + (t1 - t0).toFixed(1) + " ms, body+parse " + since(t1) + ", total " + since(t0));
    return data;
  } catch (err) {
    if (required) throw err;
    return {}; // aliases and labels are nice-to-have
  }
}

// Shown straight away while the data downloads: the search box is there but disabled.
function renderLoading() {
  const form = searchForm("", null);
  const input = form.querySelector("input");
  input.disabled = true;
  input.placeholder = "Loading routes…";
  form.querySelector("button").disabled = true;
  const status = el("p", "muted", "Loading routes…");
  status.setAttribute("role", "status");
  screen.replaceChildren(section(form, status));
}

function renderLoadError() {
  const retry = el("button", "retry", "Retry");
  retry.type = "button";
  retry.addEventListener("click", start);
  screen.replaceChildren(
    section(
      el("h2", "", "Couldn’t load the routes"),
      el(
        "p",
        "muted",
        navigator.onLine === false
          ? "You're offline, and the app hasn't saved its data yet. Connect to the internet once, then tap Retry. After that it works offline."
          : "This usually means the internet connection dropped. Check it, then tap Retry.",
      ),
      retry,
    ),
  );
}

// The header title always goes to a clean Home. On Home itself the address would not change, so go() draws
// Home again directly, which clears the search box. Ctrl/Cmd/Shift/middle clicks keep their normal meaning.
document.querySelector("header h1 a").addEventListener("click", (e) => {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (index) go("#/"); // while the data is still loading there is nothing else to show
});

// Offline support: sw.js saves the app and its data after the first visit. Failing to register is harmless.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// "Install app" button: only shown when the browser says the app can be installed.
let installEvent = null;
const installButton = el("button", "install-btn", "Install app");
installButton.type = "button";
installButton.hidden = true;
document.querySelector("footer").append(installButton);
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  installButton.hidden = true;
});
window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
});

let listening = false;

async function start() {
  renderLoading();
  try {
    const perfLoad = performance.now();
    const [stageData, allRoutes, aliases, labels, correctionData] = await Promise.all([
      loadJson("data/stages.json", true),
      loadJson("data/routes.json", true),
      loadJson("aliases.json", false),
      loadJson("stage-labels.json", false),
      loadJson("corrections.json", false), // missing or broken: no corrections, the app carries on
    ]);
    perfLog("fetch: all 5 data files ready in " + since(perfLoad) + " (they load in parallel)");
    corrections = parseCorrections(correctionData);
    // Hidden routes are removed here, once, in memory. Every screen then works from the visible data only.
    const visible = visibleData(allRoutes, stageData, corrections);
    const routes = visible.routes;
    stages = visible.stages;
    for (const s of stages) s.label = stageLabel(s, labels); // in memory only; data files stay untouched
    initRouteNames(routes.map((r) => r.short_name), corrections.labels); // display names only
    longNames = new Map(routes.map((r) => [r.short_name, r.long_name]));
    const perfIndex = performance.now();
    index = buildIndex(routes, stages, aliases);
    perfLog("buildIndex: " + index.places.size + " places, " + index.vocab.size + " words in " + since(perfIndex));
  } catch (err) {
    console.error(err);
    renderLoadError();
    return;
  }
  if (!listening) {
    window.addEventListener("hashchange", route);
    listening = true;
  }
  route(); // draws whatever screen the address asks for, now that the data is ready
}

start();
