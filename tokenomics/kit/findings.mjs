export const CLASSES = ['error', 'conflict', 'limitation', 'unverified'];
export function finding(cls, rule, where = {}, message = '') {
  if (!CLASSES.includes(cls)) throw new Error(`bad class ${cls}`);
  return { class: cls, rule, file: where.file ?? null, line: where.n ?? null, message };
}
export function exitCode(findings, mode) {
  if (findings.some((f) => f.class === 'error')) return 1;
  if (mode === 'port' && findings.some((f) => f.class === 'conflict')) return 1;
  return 0;
}
