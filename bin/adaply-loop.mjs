#!/usr/bin/env node
// adaply-loop CLI: scan agent session logs, propose learned rules, apply to AGENTS.md with versioning + rollback.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyze, renderBlock, applyBlock, VERSION } from '../src/engine.mjs';

const [cmd = 'help', ...args] = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--json', '--yes'].includes(args[i - 1])));
const repo = path.resolve(flag('repo', '.'));
const agentsPath = path.join(repo, 'AGENTS.md');
const stateDir = path.join(repo, '.adaply');
const c = process.stdout.isTTY ? { d: (s) => `\x1b[2m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` } : { d: (s) => s, g: (s) => s, r: (s) => s, b: (s) => s };

function walk(p, acc = []) {
  if (!fs.existsSync(p)) return acc;
  const st = fs.statSync(p);
  if (st.isFile()) { if (p.endsWith('.jsonl')) acc.push(p); return acc; }
  for (const e of fs.readdirSync(p)) walk(path.join(p, e), acc);
  return acc;
}
function defaultSources() {
  const h = os.homedir();
  return [path.join(h, '.claude', 'projects'), path.join(h, '.codex', 'sessions')].filter(fs.existsSync);
}
function load() {
  const srcs = positional.length ? positional : defaultSources();
  if (!srcs.length) { console.error('No session logs found. Pass a path, e.g. `adaply-loop scan ~/.claude/projects`.'); process.exit(2); }
  const files = srcs.flatMap((s) => walk(path.resolve(s))).map((f) => ({ name: path.relative(process.cwd(), f), text: fs.readFileSync(f, 'utf8') }));
  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  return { files, existing, result: analyze(files, existing, { minSessions: Number(flag('min-sessions', 2)) }) };
}
function versions() { const d = path.join(stateDir, 'versions'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort() : []; }

function report(r) {
  const byH = r.sessions.reduce((m, s) => ((m[s.harness] = (m[s.harness] || 0) + 1), m), {});
  console.log(c.b(`Adaply Loop ${VERSION}`) + c.d(`  ${r.sessions.length} sessions (${Object.entries(byH).map(([k, v]) => `${v} ${k}`).join(', ')}) · ${r.corrections.length} corrections · ${r.redactions} secrets redacted`));
  console.log();
  for (const g of r.gated) {
    console.log(`${g.adopt ? c.g('✔ ADOPT') : c.d('· hold ')}  ${c.b(g.id)}  ${g.rule}`);
    console.log(c.d(`          ${g.occurrences}x in ${g.sessions} session(s) · ${g.harnesses.join(', ')} · ` + g.checks.map((x) => `${x.pass ? '✓' : '✗'} ${x.name}`).join('  ')));
    for (const e of g.evidence.slice(0, 2)) console.log(c.d(`          “${e.quote.replace(/\s+/g, ' ').slice(0, 110)}”  — ${path.basename(e.file)}`));
  }
}

if (cmd === 'scan') {
  const { result } = load();
  if (flag('json')) console.log(JSON.stringify(result, null, 2)); else report(result);
} else if (cmd === 'propose' || cmd === 'apply') {
  const { result, existing } = load();
  const v = versions().length + 1;
  const block = renderBlock(result.gated, v);
  const next = applyBlock(existing, block);
  if (cmd === 'propose') { report(result); console.log('\n' + c.b('Proposed AGENTS.md block:') + '\n' + block); }
  else {
    fs.mkdirSync(path.join(stateDir, 'versions'), { recursive: true });
    const rec = { version: v, at: new Date().toISOString(), previous: existing, next, adopted: result.gated.filter((g) => g.adopt), held: result.gated.filter((g) => !g.adopt).map(({ evidence, ...g }) => g) };
    fs.writeFileSync(path.join(stateDir, 'versions', `v${String(v).padStart(4, '0')}.json`), JSON.stringify(rec, null, 2));
    fs.writeFileSync(agentsPath, next);
    console.log(c.g(`✔ Wrote ${path.relative(process.cwd(), agentsPath) || 'AGENTS.md'} (v${v}, ${rec.adopted.length} rule(s)). Roll back with: adaply-loop rollback`));
  }
} else if (cmd === 'rollback') {
  const vs = versions();
  if (!vs.length) { console.error('Nothing to roll back.'); process.exit(1); }
  const last = path.join(stateDir, 'versions', vs.at(-1));
  const rec = JSON.parse(fs.readFileSync(last, 'utf8'));
  if (rec.previous) fs.writeFileSync(agentsPath, rec.previous); else fs.rmSync(agentsPath, { force: true });
  fs.renameSync(last, last.replace(/\.json$/, '.rolled-back'));
  console.log(c.g(`✔ Rolled back v${rec.version}.`));
} else if (cmd === 'log') {
  for (const f of versions()) { const r = JSON.parse(fs.readFileSync(path.join(stateDir, 'versions', f), 'utf8')); console.log(`v${r.version}  ${r.at}  ${r.adopted.length} adopted, ${r.held.length} held`); }
} else {
  console.log(`adaply-loop ${VERSION} — turn repeated corrections to coding agents into tested team rules

Usage:
  adaply-loop scan    [paths...] [--json]          find recurring corrections (default: ~/.claude/projects, ~/.codex/sessions)
  adaply-loop propose [paths...] [--repo DIR]      show the AGENTS.md block that would be written
  adaply-loop apply   [paths...] [--repo DIR]      write it (versioned in .adaply/versions)
  adaply-loop rollback [--repo DIR]                undo the last apply
  adaply-loop log     [--repo DIR]                 list versions
Options: --min-sessions N (default 2)`);
}
