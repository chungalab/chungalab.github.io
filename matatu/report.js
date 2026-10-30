// "Report a mistake": builds, validates and sends a report. Pure functions, no DOM and no navigator, so tests.html can
// import it. Reports go to Formspree, which emails them to us; a person checks every one before anything changes.
// The report has no name, phone or email field. Location is added only when the person taps the 📍 button.

export const ENDPOINT = "https://formspree.io/f/xljjleqv";

export const REASONS = ["Stage has moved", "Route no longer runs", "Wrong destination", "Something else"];

const DETAILS_MAX = 500; // a short note is enough; keeps the email small

// The address of the report screen. route is the original data value ("0027", not "27").
export function reportHref({ route, stage, to }) {
  return "#/report?" + new URLSearchParams({ route: route || "", stage: stage || "", to: to || "" });
}

// The fields Formspree receives. route is the original data value, route_display the number riders see, and
// route_name the full long_name (so routes that share a number can be told apart). pos is {lat, lon} or null.
// Throws if no valid reason was chosen. _gotcha is the honeypot: people leave it empty.
export function buildReport({ route, display, name, stage, to, reason, details, pos, gotcha }) {
  if (!REASONS.includes(reason)) throw new Error("Please choose what is wrong.");
  const report = {
    route: route || "",
    route_display: display || "",
    route_name: name || "",
    board_stage: stage || "",
    destination: to || "",
    reason,
    details: String(details || "").trim().slice(0, DETAILS_MAX),
    _gotcha: gotcha || "",
  };
  if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon)) {
    report.lat = pos.lat;
    report.lon = pos.lon;
  }
  return report;
}

// Sends the report. Resolves {ok: true} on success, otherwise {ok: false, offline}: offline is true when the
// request could not leave the phone at all. fetchFn can be swapped for a fake in tests.
export async function sendReport(report, fetchFn = fetch) {
  try {
    const res = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(report),
    });
    return res.ok ? { ok: true } : { ok: false, offline: false };
  } catch (err) {
    return { ok: false, offline: true };
  }
}
