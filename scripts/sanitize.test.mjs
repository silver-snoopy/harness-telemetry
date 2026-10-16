import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeText, sanitizeRecord, sanitizeValue } from './sanitize.mjs';

test('free text is masked to the same length, ids survive at their offsets', () => {
  const t = 'Fix PROJ-12 in feat/12-x please';
  const s = sanitizeText(t, ['PROJ-12']);
  assert.equal(s.length, t.length);
  assert.equal(s.slice(4, 11), 'PROJ-12');
  assert.doesNotMatch(s, /please/);
});

test('leading < is preserved so skip rules still apply', () => {
  assert.equal(sanitizeText('<system-reminder>secret', [])[0], '<');
});

test('absolute paths are removed', () => {
  assert.doesNotMatch(sanitizeText('see /Users/dan/x.txt', []), /dan/);
});

test('structural fields of a record are untouched', () => {
  const rec = { type: 'assistant', timestamp: '2026-10-01T10:00:00Z', sessionId: 's', gitBranch: 'feat/1-a',
    message: { id: 'msg_1', model: 'm', usage: { input_tokens: 5 }, content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'general-purpose', description: 'PROJ-1 do it', prompt: 'secret' } }] } };
  const out = sanitizeRecord(rec, { keepIds: ['PROJ-1'] });
  assert.equal(out.message.usage.input_tokens, 5);
  assert.equal(out.message.content[0].name, 'Agent');
  assert.equal(out.message.content[0].input.subagent_type, 'general-purpose');
  assert.match(out.message.content[0].input.description, /^PROJ-1/);
  assert.doesNotMatch(JSON.stringify(out), /secret/);
});

test('subagent meta agentType is kept verbatim; ids kept, free text masked', () => {
  const out = sanitizeValue({ agentType: 'general-purpose', description: 'PROJ-9 secret task' }, ['PROJ-9']);
  assert.equal(out.agentType, 'general-purpose');
  assert.equal(out.description.slice(0, 6), 'PROJ-9');
  assert.doesNotMatch(out.description, /secret/);
});

test('kept keys keep only string values; arrays under them are masked', () => {
  const out = sanitizeRecord({ name: ['private words'], type: 'assistant' }, { keepIds: [] });
  assert.equal(out.type, 'assistant');
  assert.deepEqual(out.name, ['xxxxxxx xxxxx']);
});

test('inside an input object only subagent_type and skill survive', () => {
  const rec = { message: { content: [{ type: 'tool_use', name: 'Skill', input: {
    name: 'secret-agent', id: 'my password', type: 'hunter2', role: 'ceo', version: 'x',
    subagent_type: 'general-purpose', skill: 'deep-research' } }] } };
  const input = sanitizeRecord(rec, { keepIds: [] }).message.content[0].input;
  assert.equal(input.subagent_type, 'general-purpose');
  assert.equal(input.skill, 'deep-research');
  const orig = { name: 'secret-agent', id: 'my password', type: 'hunter2', role: 'ceo', version: 'x' };
  for (const k of Object.keys(orig)) assert.equal(input[k], orig[k].replace(/\S/g, 'x'), k);
  assert.doesNotMatch(JSON.stringify(input), /secret|password|hunter2|ceo/);
});

test('astral characters keep length and id offsets (UTF-16 units)', () => {
  const t = '😀 Fix PROJ-12 ok';
  const s = sanitizeText(t, ['PROJ-12']);
  assert.equal(s.length, 17);
  assert.equal(s.indexOf('PROJ-12'), 7);
  assert.equal(s.slice(7, 14), 'PROJ-12');
});

test('a string starting with an absolute path does not look like a skip-marker', () => {
  const s = sanitizeText('/Users/dan/x is it', []);
  assert.notEqual(s[0], '<');
  assert.doesNotMatch(s, /dan/);
  assert.equal(sanitizeText('<system-reminder>secret', [])[0], '<');
});

test('empty or non-string keep ids are ignored and terminate', () => {
  assert.equal(sanitizeText('abc def', ['']), 'xxx xxx');
  assert.equal(sanitizeText('abc def', [null, '']), 'xxx xxx');
});

test('a kept id still has word boundaries after masking (the case-id miner relies on them)', () => {
  const s = sanitizeText('fix(ADR-028): see "PROJ-12".', ['ADR-028', 'PROJ-12']);
  assert.equal(s, 'xxx(ADR-028)x xxx "PROJ-12"x');
  assert.match(s, /\bADR-028\b/);
});

test('speed is kept (ccusage rejects usage records whose speed is masked)', () => {
  assert.equal(sanitizeValue({ usage: { speed: 'standard', service_tier: 'standard' } }, []).usage.speed, 'standard');
});

test('free-text object keys are masked, schema-like keys stay', () => {
  const s = sanitizeValue({ answers: { 'Which plan do we pick?': 'a', 'Which plan do we pic?': 'b' }, message: { id: 'm' } }, []);
  assert.deepEqual(Object.keys(s.answers).map((k) => k.length), ['Which plan do we pick?'.length, 'Which plan do we pic?'.length]);
  assert.doesNotMatch(Object.keys(s.answers).join(), /Which|plan/);
  assert.equal(Object.keys(s.answers).length, 2);
  assert.equal(s.message.id, 'm');
});

test('kept keys keep a string only when it matches the key pattern', () => {
  const s = sanitizeValue({ type: 'Free text here', role: 'assistant', model: 'claude-opus-5', id: 'two words', version: '2.1.3', gitBranch: 'feat/x', agentType: 'general-purpose' }, []);
  assert.equal(s.type, 'xxxx xxxx xxxx');
  assert.equal(s.role, 'assistant');
  assert.equal(s.model, 'claude-opus-5');
  assert.equal(s.id, 'xxx xxxxx');
  assert.equal(s.gitBranch, 'feat/x');
  assert.equal(s.agentType, 'general-purpose');
});

test('name is kept only on tool_use objects or tools elements, and only if tool-name shaped', () => {
  const s = sanitizeValue({
    content: [{ type: 'tool_use', name: 'mcp__srv__do_it' }, { type: 'tool_use', name: 'My Private Idea' }, { type: 'x', name: 'Agent' }],
    tools: [{ name: 'Read' }], title: { name: 'proj-kb-f0' } }, []);
  assert.equal(s.content[0].name, 'mcp__srv__do_it');
  assert.equal(s.content[1].name, 'xx xxxxxxx xxxx');
  assert.equal(s.content[2].name, 'xxxxx');
  assert.equal(s.tools[0].name, 'Read');
  assert.equal(s.title.name, 'xxxxxxxxxx');
});

test('kept ids are restored only at word boundaries', () => {
  assert.equal(sanitizeText('domain main, mainly main', ['main']), 'xxxxxx main, xxxxxx main');
  assert.equal(sanitizeText('ADR-028', ['ADR-028']), 'ADR-028');
  assert.equal(sanitizeText('xADR-028', ['ADR-028']), 'xxxxxxxx');
});

test('colliding masked keys: kept distinct while possible, throw when impossible', () => {
  const mk = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String.fromCharCode(0x100 + i), i]));
  assert.equal(Object.keys(sanitizeValue(mk(30), [])).length, 30);
  assert.throws(() => sanitizeValue(mk(60), []), /distinct/);
});
