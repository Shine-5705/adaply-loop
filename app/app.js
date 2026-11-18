import { analyze, renderBlock, applyBlock } from '../src/engine.mjs';

const SAMPLE = ['claude-code/2026-11-09-add-gst-field.jsonl', 'claude-code/2026-11-11-invoice-pdf.jsonl', 'claude-code/2026-11-13-discount-tests.jsonl', 'claude-code/2026-11-16-dark-mode.jsonl', 'codex/2026-11-14-rollout-reminders.jsonl', 'codex/2026-11-17-rollout-export.jsonl'];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n) => `<svg class="icon"><use href="#i-${n}"/></svg>`;
const S = { loading: false, files: [], label: '', sample: false, base: '', current: '', result: null, versions: [], view: 'overview' };
const TITLES = { overview: 'Overview', sessions: 'Sessions', corrections: 'Corrections', rules: 'Rules diff', history: 'Version history' };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }
function go(v) {
  S.view = v; document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('on', n.dataset.v === v));
  document.querySelectorAll('.view').forEach((n) => n.classList.toggle('on', n.id === 'v-' + v));
  $('#title').textContent = TITLES[v]; $('#side').classList.remove('open'); history.replaceState(null, '', '#' + v);
}
document.querySelectorAll('.nav').forEach((n) => (n.onclick = () => go(n.dataset.v)));

// ---------- data ----------
async function loadSample(quiet = false) {
  S.loading = true; renderAll();
  const t0 = performance.now();
  const files = await Promise.all(SAMPLE.map(async (p) => ({ name: p, text: await (await fetch('../examples/sessions/' + p)).text() })));
  const base = await (await fetch('../examples/repo/AGENTS.md')).text();
  await new Promise((r) => setTimeout(r, Math.max(0, 450 - (performance.now() - t0))));
  setData(files, base, 'Sample workspace', true, quiet === true);
}
async function loadFiles(list) {
  const fl = [...list].filter((f) => f.name.endsWith('.jsonl'));
  if (!fl.length) return toast('Choose .jsonl session logs');
  S.loading = true; renderAll();
  const files = await Promise.all(fl.map(async (f) => ({ name: f.name, text: await f.text() })));
  setData(files, '', `${files.length} local file${files.length > 1 ? 's' : ''}`, false);
}
function setData(files, base, label, sample, quiet = false) {
  Object.assign(S, { files, base, current: base, label, sample, versions: [], loading: false });
  recompute(); renderAll(); if (!quiet) toast(`Analyzed ${files.length} sessions`);
}
function recompute() { S.result = analyze(S.files, S.base); }
function proposed() { return applyBlock(S.current, renderBlock(S.result.gated, S.versions.length + 1, new Date().toISOString().slice(0, 10))); }

// ---------- diff (LCS, side-by-side) ----------
function diffRows(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const rows = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { rows.push({ l: [i + 1, A[i]], r: [j + 1, B[j]], t: 'same' }); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { rows.push({ l: null, r: [j + 1, B[j]], t: 'add' }); j++; }
    else { rows.push({ l: [i + 1, A[i]], r: null, t: 'del' }); i++; }
  }
  return rows;
}
const line = (x, t) => x ? `<div class="ln ${t === 'same' ? '' : t}"><i>${x[0]}</i><u>${t === 'add' ? '+' : t === 'del' ? '−' : ''}</u><span>${esc(x[1]) || ' '}</span></div>` : `<div class="ln pad"><i></i><u></u><span></span></div>`;

// ---------- views ----------
function empty() {
  return `<div class="card drop" id="dropzone"><div class="empty"><div class="ic">${ic('layers')}</div>
  <h3>No sessions yet</h3><p>Open Claude Code or Codex session logs (<code>~/.claude/projects/**/*.jsonl</code>, <code>~/.codex/sessions/**/rollout-*.jsonl</code>) or drop them here. Or explore with the sample workspace.</p>
  <div class="row"><button class="btn primary" data-act="sample">${ic('play')}Load sample workspace</button><label class="btn" for="file">${ic('up')}Open logs</label></div></div></div>`;
}
function skeleton() {
  const k = `<div class="kpi"><div class="sk" style="width:50%"></div><div class="sk" style="width:35%;height:28px;margin-top:12px"></div></div>`;
  return `<div class="kpis">${k}${k}${k}${k}</div><div class="card">${'<div class="mini"><div class="sk" style="width:70%"></div><div class="sk" style="width:30%;margin-top:8px;height:10px"></div></div>'.repeat(5)}</div>`;
}
function vh(t, p, right = '') { return `<div class="vh"><div><h2>${t}</h2><p>${p}</p></div><div>${right}</div></div>`; }
const gateBadge = (g) => g.adopt ? `<span class="badge ok">${ic('check')}Adopt</span>` : `<span class="badge hold">Hold</span>`;

function overview(r) {
  const adopted = r.gated.filter((g) => g.adopt);
  const max = Math.max(...r.gated.map((g) => g.occurrences), 1);
  const harn = [...new Set(r.sessions.map((s) => s.harness))];
  return vh('Overview', `${esc(S.label)} · ${r.sessions.length} sessions from ${harn.map(esc).join(' and ')}`) +
  `<div class="kpis">
    <div class="kpi"><span>Sessions analyzed</span><b>${r.sessions.length}</b><small>${harn.map(esc).join(' · ')}</small></div>
    <div class="kpi"><span>Corrections found</span><b>${r.corrections.length}</b><small>${r.gated.length} distinct</small></div>
    <div class="kpi"><span>Rules passing gate</span><b>${adopted.length}<span style="font-size:16px;color:var(--muted)"> / ${r.gated.length}</span></b><small>recur in 2+ sessions</small></div>
    <div class="kpi"><span>Secrets redacted</span><b>${r.redactions}</b><small>before analysis, locally</small></div>
  </div>
  <div class="grid2">
    <div class="card"><div class="ch"><h3>Most repeated corrections</h3><span class="sp"></span><button class="btn ghost sm" data-go="corrections">View all</button></div>
      ${r.gated.slice(0, 5).map((g) => `<div class="mini"><div class="top"><span style="color:var(--ink);font:inherit">${esc(g.rule)}</span><span>${g.occurrences}× · ${g.sessions} sess.</span></div><div class="bar"><i style="width:${(g.occurrences / max) * 100}%"></i></div></div>`).join('')}
    </div>
    <div class="card"><div class="ch"><h3>Next step</h3></div><div style="padding:16px">
      <p style="margin:0 0 16px;font-size:14px">${adopted.length} rule${adopted.length === 1 ? '' : 's'} passed the gate and can be written to <code>AGENTS.md</code> as version ${S.versions.length + 1}.</p>
      <button class="btn primary" data-go="rules">${ic('diff')}Review the diff</button>
      <p class="note">Rules are adopted only when they recur across separate sessions and don't duplicate or contradict existing instructions.</p></div></div>
  </div>`;
}
function sessions(r) {
  const per = r.corrections.reduce((m, c) => ((m[c.file] = (m[c.file] || 0) + 1), m), {});
  return vh('Sessions', 'Agent session logs parsed in this browser tab.') +
  `<div class="card"><div class="tw"><table><thead><tr><th>Log file</th><th>Harness</th><th class="hide-sm">Session</th><th>Turns</th><th>Corrections</th></tr></thead><tbody>
  ${r.sessions.map((s) => `<tr><td style="color:var(--ink);word-break:break-all">${esc(s.name.split('/').pop())}</td><td><span class="badge">${esc(s.harness)}</span></td><td class="mono hide-sm">${esc(s.sessionId)}</td><td class="num">${s.turns}</td><td class="num">${per[s.name] || 0}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}
function corrections(r) {
  return vh('Corrections', 'Repeated corrections, clustered across sessions and harnesses. Click a row for evidence.') +
  `<div class="card"><div class="tw"><table><thead><tr><th style="width:28px"></th><th>Rule</th><th>Count</th><th class="hide-sm">Sessions</th><th class="hide-sm">Harnesses</th><th>Gate</th></tr></thead><tbody>
  ${r.gated.map((g, i) => `<tr class="click" data-row="${i}"><td><svg class="icon chev"><use href="#i-chev"/></svg></td><td><div class="rule">${esc(g.rule)}</div><div class="mono" style="font-size:12px;color:var(--muted)">${g.id}</div></td><td class="num">${g.occurrences}</td><td class="num hide-sm">${g.sessions}</td><td class="hide-sm">${g.harnesses.map((h) => `<span class="badge">${esc(h)}</span>`).join(' ')}</td><td>${gateBadge(g)}</td></tr>
  <tr class="ev" data-ev="${i}" hidden><td></td><td colspan="5"><div class="checks">${g.checks.map((c) => `<span class="${c.pass ? 'p' : 'f'}">${c.pass ? '✓' : '✗'} ${c.name} <span style="color:var(--muted)">· ${esc(c.detail)}</span></span>`).join('')}</div>
  ${g.evidence.map((e) => `<div class="quote">${esc(e.quote)}<small>${esc(e.file.split('/').pop())} · ${esc(e.harness)}${e.ts ? ' · ' + esc(e.ts.slice(0, 16).replace('T', ' ')) + ' UTC' : ''}</small></div>`).join('')}</td></tr>`).join('')}
  </tbody></table></div></div><p class="note">Detection in v0.1 is rule-based and transparent; every adopted rule links back to the exact messages it came from.</p>`;
}
function rules(r) {
  const next = proposed(), changed = next !== S.current;
  const rows = diffRows(S.current, next);
  const adds = rows.filter((x) => x.t === 'add').length, dels = rows.filter((x) => x.t === 'del').length;
  return vh('Rules diff', `AGENTS.md now (v${S.versions.length}) → proposed v${S.versions.length + 1}`,
    `<div style="display:flex;gap:8px"><button class="btn sm" data-act="download">${ic('down')}Download</button><button class="btn sm primary" data-act="apply" ${changed ? '' : 'disabled style="opacity:.5;pointer-events:none"'}>${ic('check')}Apply as v${S.versions.length + 1}</button></div>`) +
  `<div class="card"><div class="ch"><h3>AGENTS.md</h3><span class="badge ok">+${adds}</span><span class="badge" style="color:var(--bad)">−${dels}</span><span class="sp"></span><span class="mono" style="font-size:12px;color:var(--muted)">${r.gated.filter((g) => g.adopt).length} rules</span></div>
  <div class="diff"><div class="dh">Before · v${S.versions.length}</div><div class="dh">After · v${S.versions.length + 1}</div>
  ${rows.map((x) => line(x.l, x.t === 'same' ? 'same' : x.l ? 'del' : 'pad') + line(x.r, x.t === 'same' ? 'same' : x.r ? 'add' : 'pad')).join('')}</div></div>
  ${changed ? '' : '<p class="note">AGENTS.md already contains every adopted rule. Nothing to apply.</p>'}`;
}
function historyView() {
  const list = [...S.versions].reverse();
  return vh('Version history', 'Every apply is a version with its evidence. Roll back the latest at any time.') +
  `<div class="card">${list.length ? `<ul class="tl">${list.map((v, i) => `<li><span class="v">v${v.v}</span><div class="meta"><b>${v.rules.length} learned rule${v.rules.length === 1 ? '' : 's'} written</b><span>${esc(new Date(v.at).toLocaleString())} · ${v.rules.map((r) => esc(r.id)).join(', ')}</span></div>${i === 0 ? `<span class="badge acc">current</span><button class="btn sm" data-act="rollback">${ic('undo')}Roll back</button>` : ''}</li>`).join('')}
    <li><span class="v">v0</span><div class="meta"><b>Original AGENTS.md</b><span>Hand-written baseline</span></div>${list.length ? '' : '<span class="badge acc">current</span>'}</li></ul>`
    : `<div class="empty"><div class="ic">${ic('clock')}</div><h3>No versions yet</h3><p>Apply the proposed rules from the diff view to create v1. In the CLI, versions are stored in <code>.adaply/versions/</code>.</p><div class="row"><button class="btn primary" data-go="rules">${ic('diff')}Open rules diff</button></div></div>`}</div>
  <p class="note">In this demo, history lives in this tab. The CLI writes the same records to disk with <code>adaply-loop apply</code> / <code>rollback</code>.</p>`;
}

function renderAll() {
  const r = S.result;
  $('#samplebadge').hidden = !S.sample;
  $('#wsname').textContent = r ? S.label : 'No workspace loaded';
  $('#wsmeta').textContent = r ? (S.sample ? 'Synthetic sample sessions' : 'Local files, not uploaded') : 'Load logs to begin';
  $('#n-s').textContent = r ? r.sessions.length : 0; $('#n-c').textContent = r ? r.gated.length : 0;
  $('#n-r').textContent = r ? r.gated.filter((g) => g.adopt).length : 0; $('#n-h').textContent = S.versions.length;
  const V = { overview, sessions, corrections, rules, history: historyView };
  for (const k of Object.keys(V)) {
    const el = $('#v-' + k);
    el.innerHTML = S.loading ? skeleton() : r ? V[k](r) : vh(TITLES[k], 'Nothing loaded yet.') + empty();
  }
  bind();
}
function bind() {
  document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  document.querySelectorAll('[data-act=sample]').forEach((b) => (b.onclick = () => loadSample()));
  document.querySelectorAll('[data-row]').forEach((tr) => (tr.onclick = () => { const ev = document.querySelector(`[data-ev="${tr.dataset.row}"]`); ev.hidden = !ev.hidden; tr.classList.toggle('open', !ev.hidden); }));
  const ap = document.querySelector('[data-act=apply]'); if (ap) ap.onclick = () => {
    const next = proposed();
    S.versions.push({ v: S.versions.length + 1, at: new Date().toISOString(), prev: S.current, content: next, rules: S.result.gated.filter((g) => g.adopt) });
    S.current = next; renderAll(); go('history'); toast(`Applied v${S.versions.length}`);
  };
  const rb = document.querySelector('[data-act=rollback]'); if (rb) rb.onclick = () => { const v = S.versions.pop(); S.current = v.prev; renderAll(); toast(`Rolled back v${v.v}`); };
  const dl = document.querySelector('[data-act=download]'); if (dl) dl.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([proposed()], { type: 'text/markdown' })); a.download = 'AGENTS.md'; a.click(); };
  const dz = $('#v-' + S.view + ' #dropzone') || document.querySelector('.view.on .drop');
  document.querySelectorAll('.drop').forEach((d) => {
    ['dragenter', 'dragover'].forEach((t) => d.addEventListener(t, (e) => { e.preventDefault(); d.classList.add('on'); }));
    ['dragleave', 'drop'].forEach((t) => d.addEventListener(t, (e) => { e.preventDefault(); d.classList.remove('on'); }));
    d.addEventListener('drop', (e) => loadFiles(e.dataTransfer.files));
  });
}
$('#loadSample').onclick = () => loadSample();
$('#file').onchange = (e) => loadFiles(e.target.files);
renderAll();
const h = location.hash.slice(1); if (TITLES[h]) go(h);
if (new URLSearchParams(location.search).has('sample')) loadSample(true);
