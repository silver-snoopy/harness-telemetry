// Fake implementation for scripts/migrations.test.mjs: output depends only on TOKENOMICS_MIGRATIONS.
import { mkdirSync, writeFileSync } from 'node:fs';
const on = new Set((process.env.TOKENOMICS_MIGRATIONS ?? '').split(',').filter((s) => s && s !== 'none'));
mkdirSync('out', { recursive: true });
writeFileSync('out/a.txt', on.has('demo') ? 'demo\n' : 'base\n');
if (on.has('demo')) writeFileSync('out/b.txt', 'added\n');
