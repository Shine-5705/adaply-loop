import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseSession, redact, analyze, renderBlock, applyBlock, START, END } from '../src/engine.mjs';

const dir = new URL('../examples/sessions/', import.meta.url).pathname;
const files = ['claude-code', 'codex'].flatMap((h) => fs.readdirSync(dir + h).map((f) => ({ name: `${h}/${f}`, text: fs.readFileSync(path.join(dir, h, f), 'utf8') })));

test('parses Claude Code and Codex formats, skipping tool results and env context', () => {
  const cc = parseSession(files.find((f) => f.name.includes('add-gst')).text);
  assert.equal(cc.harness, 'claude-code');
  assert.equal(cc.turns.length, 4);
  const cx = parseSession(files.find((f) => f.name.includes('reminders')).text);
  assert.equal(cx.harness, 'codex');
  assert.equal(cx.sessionId, 'cx-1411');
  assert.ok(!cx.turns.some((t) => t.text.includes('environment_context')));
});

test('redacts secrets before analysis', () => {
  const r = redact('key sk-test_51HxQabcdefghijklmnopqrstuv and ghp_abcdefghijklmnopqrstuvwxyz123 mail a@b.co');
  assert.equal(r.hits, 3);
  assert.ok(!/sk-test|ghp_|a@b\.co/.test(r.text));
});

test('adopts only rules corrected in 2+ sessions', () => {
  const { gated } = analyze(files, '');
  const adopted = gated.filter((g) => g.adopt).map((g) => g.rule);
  assert.ok(adopted.some((r) => /pnpm/.test(r)));
  assert.ok(adopted.some((r) => /src\/gen/.test(r)));
  assert.ok(adopted.some((r) => /vitest/.test(r)));
  assert.ok(!adopted.some((r) => /tokens\.css/.test(r)), 'one-off correction must be held');
  const all = JSON.stringify(gated);
  assert.ok(!all.includes('sk-test_51'), 'evidence must not contain secrets');
});

test('gate holds rules already present in AGENTS.md', () => {
  const { gated } = analyze(files, '- Use vitest, not jest.\n');
  assert.equal(gated.find((g) => /vitest/.test(g.rule)).adopt, false);
});

test('block is idempotent when re-applied', () => {
  const { gated } = analyze(files, '');
  const once = applyBlock('# AGENTS.md\n\n- Keep it simple.\n', renderBlock(gated, 1, '2026-11-18'));
  const twice = applyBlock(once, renderBlock(gated, 2, '2026-11-18'));
  assert.equal(twice.split(START).length, 2);
  assert.equal(twice.split(END).length, 2);
  assert.ok(twice.includes('- Keep it simple.'));
});
