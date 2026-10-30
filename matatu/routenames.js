// Route numbers as people say them. Display only: data, URLs and search keep the original values.
//   "0027" -> "27"      "11_2" -> "11"
// When cleaning would make two routes look the same ("11" and "11_2"), the extra one gets "(alt)".

let labels = new Map(); // original name -> label, only for routes that share a cleaned name

// Removes leading zeros and a technical "_2" style suffix.
export function cleanRoute(name) {
  return String(name).replace(/_\d+$/, "").replace(/^0+(?=\d)/, "");
}

// Call once with every route name in the data. Routes that would look identical after cleaning are
// told apart: the one without a suffix keeps the plain number, the others become "11 (alt)", "11 (alt 3)"...
// overrides (optional) is a Map of original name -> label from corrections.json ("relabel"); it wins over cleaning.
export function initRouteNames(allNames, overrides) {
  const groups = new Map();
  const fixed = new Map();
  for (const name of allNames) {
    if (overrides && overrides.has(name)) {
      fixed.set(name, overrides.get(name));
      continue;
    }
    const clean = cleanRoute(name);
    if (!groups.has(clean)) groups.set(clean, []);
    groups.get(clean).push(name);
  }
  labels = new Map(fixed);
  for (const [clean, members] of groups) {
    if (members.length < 2) continue;
    const suffixed = (n) => (/_\d+$/.test(n) ? 1 : 0);
    members.sort((a, b) => suffixed(a) - suffixed(b) || a.localeCompare(b));
    members.forEach((name, i) => labels.set(name, i === 0 ? clean : clean + (i === 1 ? " (alt)" : " (alt " + (i + 1) + ")")));
  }
}

export function displayRoute(name) {
  return labels.get(name) || cleanRoute(name);
}
