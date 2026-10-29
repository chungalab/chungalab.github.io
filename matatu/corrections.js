// Corrections layer: corrections.json can mark a route "verify" (badge, sorts first) or "hide" (gone everywhere).
// Route values are the original data names ("0027", not "27"). The data files themselves are never changed:
// hidden routes are filtered out in memory after loading. Pure functions, no DOM.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// raw is whatever corrections.json held; a missing or broken file arrives as {} (or anything) and gives no corrections.
// If a route is both verified and hidden, hidden wins.
export function parseCorrections(raw) {
  const hidden = new Set();
  const verified = new Map();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry.route !== "string" || !entry.route) continue;
      if (entry.action === "hide") hidden.add(entry.route);
      else if (entry.action === "verify") verified.set(entry.route, entry);
    }
  }
  for (const route of hidden) verified.delete(route);
  return { hidden, verified };
}

export const isHidden = (corr, route) => corr.hidden.has(route);
export const isVerified = (corr, route) => corr.verified.has(route);

// Routes and stages without the hidden routes. Stage objects are copied so the loaded data is not edited.
export function visibleData(routes, stages, corr) {
  if (!corr.hidden.size) return { routes, stages };
  return {
    routes: routes.filter((r) => !corr.hidden.has(r.short_name)),
    stages: stages.map((s) => ({ ...s, routes: s.routes.filter((r) => !corr.hidden.has(r)) })),
  };
}

// "✓ Verified Oct 2026" for a verified route, "" for any other (or when its date is unreadable).
export function verifiedLabel(corr, route) {
  const entry = corr.verified.get(route);
  const m = entry && /^(\d{4})-(\d{2})/.exec(String(entry.date));
  const month = m && MONTHS[Number(m[2]) - 1];
  return month ? "✓ Verified " + month + " " + m[1] : "";
}

// Verified plans first. Among them, routes that board at a CBD stage come before routes that do not (a rider
// can act on those). Otherwise the order plansForPlace() gave is kept (fewest stops, then route number).
export function verifiedFirst(plans, corr) {
  const yes = plans.filter((p) => corr.verified.has(p.route));
  if (!yes.length) return plans;
  return [
    ...yes.filter((p) => p.board),
    ...yes.filter((p) => !p.board),
    ...plans.filter((p) => !corr.verified.has(p.route)),
  ];
}
