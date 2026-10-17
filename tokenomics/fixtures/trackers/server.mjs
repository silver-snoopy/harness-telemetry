#!/usr/bin/env node
// Test-only HTTP stand-in for the tracker APIs (Plan 7, D-TESTKIT); excluded from ENGINE.json like the other fixtures.
//   node server.mjs <routes.mjs> <requests.jsonl>
// Listens on 127.0.0.1 (an ephemeral port), prints `{"port":N}` on stdout, and answers every request with the routes
// module's default export `(req, body) → {status, json}` (sync or async). Each request is appended to the log file
// as one JSON line `{method, path, headers, body}` before it is answered. STDLIB ONLY.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [routesPath, logPath] = process.argv.slice(2);
const routes = (await import(pathToFileURL(routesPath).href)).default;

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks).toString('utf8');
    appendFileSync(logPath, JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body }) + '\n');
    let out;
    try { out = await routes(req, body); } catch (e) { out = { status: 500, json: { error: String(e?.message ?? e) } }; }
    const { status = 200, json = null } = out ?? {};
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
});
server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: server.address().port }) + '\n'));
process.on('SIGTERM', () => process.exit(0));
