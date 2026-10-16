export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const OBSERVER = new Set(['capturedAt', 'user', 'repo', 'branch']);
export function accountingPayload(line) {
  return Object.fromEntries(Object.entries(line).filter(([k]) => !OBSERVER.has(k)));
}
