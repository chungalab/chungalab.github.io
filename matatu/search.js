// Search logic only (no DOM), so tests.html and app.js can both import it.

// Lowercase, drop accents, delete apostrophes and dots (langa'Ata -> langata, K.U. -> ku),
// turn every other symbol (/ - , ( ) ...) into a space.
export function normalise(text) {
  return String(text == null ? "" : text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Edit distance between a and b, giving up early (returns max + 1) once it must exceed max.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// The CBD stage a route boards at, or null.
// starts_from holds only a name and "Ngara"/"Muthurwa" exist twice, so the stage must also list the route.
function boardStageFor(route, stages) {
  const start = route.starts_from && route.starts_from[0];
  if (start) {
    return (
      stages.find((s) => s.name === start && s.routes.includes(route.short_name)) ||
      stages.find((s) => s.name === start) ||
      null
    );
  }
  // No start: a stage that lists the route, else the first stop of a trip that is a stage.
  const listed = stages.find((s) => s.routes.includes(route.short_name));
  if (listed) return listed;
  for (const d of route.directions) {
    for (const stop of d.stops) {
      const hit = stages.find((s) => s.name === stop);
      if (hit) return hit;
    }
  }
  return null;
}

// Builds everything once at load. aliases is { "bangu": ["kariobangi"], ... }.
export function buildIndex(routes, stages, aliases) {
  const places = new Map(); // normalised name -> place
  const vocab = new Map(); // token -> Set of places
  const routeSets = new Map(); // place -> Set of route indexes

  routes.forEach((route, ri) => {
    route.directions.forEach((dir, di) => {
      dir.stops.forEach((raw, i) => {
        const key = normalise(raw);
        if (!key) return;
        let place = places.get(key);
        if (!place) {
          place = { key, name: raw, tokens: key.split(" "), occ: [], routeCount: 0 };
          places.set(key, place);
          routeSets.set(place, new Set());
          for (const t of place.tokens) {
            if (!vocab.has(t)) vocab.set(t, new Set());
            vocab.get(t).add(place);
          }
        }
        place.occ.push({ ri, di, i });
        routeSets.get(place).add(ri);
      });
    });
  });
  for (const [place, set] of routeSets) place.routeCount = set.size;

  const aliasMap = new Map();
  for (const [k, targets] of Object.entries(aliases || {})) {
    const nk = normalise(k);
    const nt = (targets || []).map(normalise).filter(Boolean);
    if (nk && nt.length) aliasMap.set(nk, nt);
  }

  const info = routes.map((route) => {
    const sf = route.starts_from || [];
    // Inbound = the trip that ends at (or is headed to) the start stage. Only trust it when exactly some,
    // not all, trips match; otherwise accept both directions.
    const inbound = route.directions.map(
      (d) => sf.length > 0 && (sf.includes(d.stops[d.stops.length - 1]) || sf.includes(d.headsign)),
    );
    const clear = inbound.some(Boolean) && !inbound.every(Boolean);
    return {
      board: boardStageFor(route, stages),
      inbound: clear ? inbound : route.directions.map(() => false),
    };
  });

  // Places reachable from a CBD stage rank above ones only served by routes that skip the CBD.
  for (const place of places.values()) place.boardable = place.occ.some((o) => info[o.ri].board) ? 1 : 0;

  return { routes, stages, places, vocab, aliasMap, info };
}

// Places whose words match one query token. Tiers: 0 exact word, 1 word starts with it,
// 2 word contains it, 3+ typo (fuzzy). A lower tier is only used when the higher ones found nothing.
function matchToken(index, tok) {
  const hits = new Map(); // place -> tier
  const add = (word, tier) => {
    for (const p of index.vocab.get(word)) {
      if (!hits.has(p) || hits.get(p) > tier) hits.set(p, tier);
    }
  };
  for (const word of index.vocab.keys()) {
    if (word === tok) add(word, 0);
    else if (word.startsWith(tok)) add(word, 1);
  }
  if (hits.size) return hits;
  if (tok.length >= 3) {
    for (const word of index.vocab.keys()) if (word.includes(tok)) add(word, 2);
    if (hits.size) return hits;
  }
  if (tok.length >= 4) {
    const max = tok.length >= 7 ? 2 : 1;
    for (const word of index.vocab.keys()) {
      const d = distance(tok, word, max);
      if (d <= max) add(word, 3 + d / 10);
    }
  }
  return hits;
}

// Every query word must match (AND). Returns [{ place, score }], lower score = better.
function searchTerm(index, term) {
  const toks = term.split(" ").filter(Boolean);
  if (!toks.length) return [];
  let acc = null;
  for (const tok of toks) {
    const m = matchToken(index, tok);
    if (!m.size) return [];
    if (!acc) {
      acc = new Map(m);
    } else {
      for (const [place, score] of acc) {
        if (m.has(place)) acc.set(place, score + m.get(place));
        else acc.delete(place);
      }
    }
  }
  const out = [];
  for (const [place, score] of acc) out.push({ place, score: place.key === term ? score - 1 : score });
  return out;
}

function byRank(a, b) {
  return (
    b.place.boardable - a.place.boardable ||
    a.score - b.score ||
    a.place.tokens.length - b.place.tokens.length ||
    b.place.routeCount - a.place.routeCount ||
    a.place.key.localeCompare(b.place.key)
  );
}

// Returns { places: [{ place, score }], alias } with the best `limit` places. alias is the text searched
// when the query was an alias key (e.g. "bangu"), else null.
export function search(index, query, limit = 8) {
  const q = normalise(query);
  if (q.length < 1) return { places: [], alias: null };

  const targets = index.aliasMap.get(q);
  if (targets) {
    const best = new Map();
    for (const t of targets) {
      for (const r of searchTerm(index, t)) {
        if (!best.has(r.place) || best.get(r.place).score > r.score) best.set(r.place, r);
      }
    }
    if (best.size) {
      return { places: [...best.values()].sort(byRank).slice(0, limit), alias: targets.join(" / ") };
    }
  }
  return { places: searchTerm(index, q).sort(byRank).slice(0, limit), alias: null };
}

// Closest spelling for a query that found nothing, as a place name, or null.
export function didYouMean(index, query) {
  const toks = normalise(query).split(" ").filter(Boolean);
  if (!toks.length) return null;
  let best = null;
  for (const tok of toks) {
    if (tok.length < 4) return null;
    const max = Math.min(3, Math.ceil(tok.length / 3));
    let pick = null;
    for (const [word, set] of index.vocab) {
      const d = distance(tok, word, max);
      if (d > max) continue;
      // Equal distance: the word sharing more starting letters wins (kahua -> kahawa, not karura), then the busier word.
      let prefix = 0;
      while (prefix < tok.length && prefix < word.length && tok[prefix] === word[prefix]) prefix++;
      let popular = 0;
      let top = index.places.get(word) || null; // a place named exactly this word ("Kahawa") beats longer names
      for (const p of set) {
        popular += p.routeCount;
        if (!top || (!index.places.has(word) && p.routeCount > top.routeCount)) top = p;
      }
      if (
        !pick ||
        d < pick.d ||
        (d === pick.d && (prefix > pick.prefix || (prefix === pick.prefix && popular > pick.popular)))
      ) {
        pick = { d, prefix, popular, top };
      }
    }
    if (!pick) return null;
    if (!best) best = pick.top; // the first word decides which place to suggest
  }
  return best ? best.name : null;
}

// One entry per route that serves `place`, best direction only, fewest stops first.
// board is a stage object or null (route does not pass a CBD stage).
export function plansForPlace(index, place) {
  const best = new Map(); // route index -> plan
  for (const o of place.occ) {
    const route = index.routes[o.ri];
    const dir = route.directions[o.di];
    const approx = index.info[o.ri].inbound[o.di]; // only seen on the trip heading into the CBD
    const plan = {
      route: route.short_name,
      longName: route.long_name,
      headsign: dir.headsign,
      board: index.info[o.ri].board,
      stopsToGo: approx ? dir.stops.length - 1 - o.i : o.i,
      stops: approx ? dir.stops.slice(o.i).reverse() : dir.stops.slice(0, o.i + 1),
      approx,
    };
    const cur = best.get(o.ri);
    if (
      !cur ||
      (cur.approx && !plan.approx) ||
      (cur.approx === plan.approx && plan.stopsToGo < cur.stopsToGo)
    ) {
      best.set(o.ri, plan);
    }
  }
  return [...best.values()].sort((a, b) => a.stopsToGo - b.stopsToGo || a.route.localeCompare(b.route));
}

export function stopsText(n) {
  return n === 0 ? "Starts here" : n === 1 ? "1 stop" : n + " stops";
}

// Clearer name for a stage; labels maps "lat,lon" -> text (stage-labels.json).
export function stageLabel(stage, labels) {
  return (labels && labels[stage.lat + "," + stage.lon]) || stage.name;
}
