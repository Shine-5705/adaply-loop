// Adaply Loop engine — runs unchanged in Node and in the browser. Zero dependencies.
// Pipeline: parse sessions -> redact -> find corrections -> cluster -> propose rules -> gate -> render AGENTS.md block.

export const VERSION = '0.1.0';
export const START = '<!-- adaply-loop:start -->';
export const END = '<!-- adaply-loop:end -->';

// ---------- 1. Capture: parse Claude Code and Codex JSONL session logs ----------
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && (c.type === 'text' || c.type === 'input_text' || c.type === 'output_text'))
    .map((c) => c.text || '')
    .join('\n');
}
function isToolResult(content) {
  return Array.isArray(content) && content.length > 0 && content.every((c) => c && c.type === 'tool_result');
}

export function parseSession(raw, name = 'session.jsonl') {
  const turns = [];
  let harness = 'unknown', sessionId = name, cwd = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    // Claude Code: {type:'user'|'assistant', message:{role, content}, sessionId, cwd, timestamp}
    if ((o.type === 'user' || o.type === 'assistant') && o.message) {
      harness = 'claude-code';
      sessionId = o.sessionId || sessionId; cwd = o.cwd || cwd;
      if (o.isMeta || isToolResult(o.message.content)) continue;
      const text = textOf(o.message.content);
      if (text.trim()) turns.push({ role: o.message.role || o.type, text, ts: o.timestamp || null });
      continue;
    }
    // Codex rollout: {type:'session_meta'|'response_item', payload:{...}}
    if (o.type === 'session_meta' && o.payload) { harness = 'codex'; sessionId = o.payload.id || sessionId; cwd = o.payload.cwd || cwd; continue; }
    const p = o.type === 'response_item' ? o.payload : (o.type === 'message' ? o : null);
    if (p && p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      harness = harness === 'unknown' ? 'codex' : harness;
      const text = textOf(p.content);
      if (!text.trim() || /^<(environment_context|user_instructions)>/.test(text.trim())) continue;
      turns.push({ role: p.role, text, ts: o.timestamp || null });
    }
  }
  return { name, harness, sessionId, cwd, turns };
}

// ---------- Redaction (runs before anything is stored or sent anywhere) ----------
const SECRET_PATTERNS = [
  [/\b(sk-[A-Za-z0-9_-]{16,})/g, '[REDACTED_KEY]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]'],
  [/\b(xox[abpr]-[A-Za-z0-9-]{10,})/g, '[REDACTED_SLACK_TOKEN]'],
  [/(Bearer\s+)[A-Za-z0-9._~+\/-]{16,}=*/gi, '$1[REDACTED]'],
  [/\b([A-Za-z_]*(?:PASSWORD|SECRET|TOKEN|API_KEY)[A-Za-z_]*\s*[=:]\s*)\S+/gi, '$1[REDACTED]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
];
export function redact(text) {
  let out = text, hits = 0;
  for (const [re, rep] of SECRET_PATTERNS) { const m = out.match(re); if (m) { hits += m.length; out = out.replace(re, rep); } }
  return { text: out, hits };
}

// ---------- 2. Find: detect user corrections that follow an agent turn ----------
const CORRECTION_CUES = [
  /^(no|nope|wrong|not quite|that's not|thats not|that is not)\b/i,
  /^(actually|again|stop|wait|undo|revert)\b/i,
  /\b(i (already )?(said|told you|asked)|as i said|like i said)\b/i,
  /\b(don'?t|do not|never|stop|please don'?t)\s+\w+/i,
  /\b(instead of|rather than|not\s+\w+[,;]\s*(use|we use))\b/i,
  /\b(we (always|never|only) use|always use|must use|use \S+ (instead|not))\b/i,
];
const IMPERATIVE = /\b(use|don'?t|do not|never|always|run|put|keep|prefer|avoid|stop|add|write|call|import|name)\b/i;

export function correctionScore(text) {
  const t = text.trim();
  if (t.length < 6 || t.length > 600) return 0;
  let s = 0;
  for (const re of CORRECTION_CUES) if (re.test(t)) s++;
  if (IMPERATIVE.test(t)) s += 0.5;
  return s;
}

function cleanSentence(s) {
  return s
    .replace(/^(no+|nope|wrong|actually|again|wait|ugh|sorry|ok(ay)?|hmm|please)[,.!:;\s-]+/i, '')
    .replace(/^(no+|nope|actually)[,.!\s]+/i, '')
    .replace(/^(i (already )?(said|told you|asked)( you)?( to)?|as i said|like i said)[,:\s]*/i, '')
    .replace(/\bdon'?t\b/gi, 'do not')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '');
}

function toRule(sentence) {
  let r = cleanSentence(sentence)
    .replace(/^and\s+/i, '')
    .replace(/^we (always |only )?use\b/i, (m, a) => (a ? 'Always use' : 'Use'))
    .replace(/,?\s*i said this before$/i, '')
    .replace(/\s+in this repo$/i, '');
  if (r.length < 8) return null;
  r = r[0].toUpperCase() + r.slice(1);
  return r.length > 160 ? r.slice(0, 157) + '…' : r;
}
// A single correction message can carry several rules ("use vitest, not jest. And use pnpm").
export function extractRules(text) {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const picks = sentences.filter((s) => IMPERATIVE.test(s) && (correctionScore(s) > 0.5 || /\b(use|never|always|do not|don'?t)\b/i.test(s)));
  return [...new Set(picks.map(toRule).filter(Boolean))];
}
export function extractRule(text) { return extractRules(text)[0] || null; }

export function findCorrections(session) {
  const out = [];
  for (let i = 1; i < session.turns.length; i++) {
    const t = session.turns[i], prev = session.turns[i - 1];
    if (t.role !== 'user' || prev.role !== 'assistant') continue;
    const score = correctionScore(t.text);
    if (score < 1.5) continue;
    const { text } = redact(t.text);
    for (const rule of extractRules(text)) out.push({
      rule, quote: text.length > 240 ? text.slice(0, 237) + '…' : text,
      agentBefore: redact(prev.text).text.slice(0, 200),
      session: session.sessionId, file: session.name, harness: session.harness, ts: t.ts, score,
    });
  }
  return out;
}

// ---------- 3. Cluster recurring corrections ----------
const STOP = new Set('the a an to of in on for and or with this that it is be are was we you i our my your please just again do not use using instead rather than always never when file files code'.split(' '));
const SYN = { yarn: 'yarn', pnpm: 'pnpm', npm: 'npm', tabs: 'tab', tab: 'tab', spaces: 'space', space: 'space', tests: 'test', test: 'test', vitest: 'vitest', jest: 'jest' };
export function tokens(s) {
  return new Set(s.toLowerCase().replace(/[^a-z0-9_./@-]+/g, ' ').split(' ').map((w) => w.replace(/^[./@-]+|[./@-]+$/g, '')).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => SYN[w] || w.replace(/(ing|es|s)$/, '')));
}
function jaccard(a, b) { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); }

export function cluster(corrections, threshold = 0.3) {
  const clusters = [];
  for (const c of corrections) {
    const tk = tokens(c.rule);
    let best = null, bestS = 0;
    for (const k of clusters) { const s = jaccard(tk, k.tokens); if (s > bestS) { bestS = s; best = k; } }
    if (best && bestS >= threshold) { best.items.push(c); for (const x of tk) best.tokens.add(x); }
    else clusters.push({ tokens: tk, items: [c] });
  }
  return clusters.map((k, idx) => {
    const sessions = new Set(k.items.map((i) => i.session));
    const harnesses = new Set(k.items.map((i) => i.harness));
    const rule = [...k.items].sort((a, b) => b.score - a.score || a.rule.length - b.rule.length)[0].rule;
    return { id: 'R' + String(idx + 1).padStart(2, '0'), rule, occurrences: k.items.length, sessions: sessions.size, harnesses: [...harnesses], evidence: k.items };
  }).sort((a, b) => b.sessions - a.sessions || b.occurrences - a.occurrences);
}

// ---------- 4. Gate: only adopt rules that recur and do not contradict existing instructions ----------
export function gate(clusters, existingAgentsMd = '', { minSessions = 2 } = {}) {
  const existing = existingAgentsMd.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
  return clusters.map((c) => {
    const checks = [];
    checks.push({ name: 'recurs', pass: c.sessions >= minSessions, detail: `${c.sessions} session(s), need ${minSessions}` });
    const tk = tokens(c.rule);
    const dup = existing.find((l) => jaccard(tokens(l), tk) >= 0.6);
    checks.push({ name: 'not-duplicate', pass: !dup, detail: dup ? `already covered: "${dup}"` : 'new instruction' });
    const neg = /\b(do not|never|avoid)\b/i.test(c.rule);
    const conflict = existing.find((l) => jaccard(tokens(l), tk) >= 0.34 && neg !== /\b(do not|never|avoid)\b/i.test(l));
    checks.push({ name: 'no-conflict', pass: !conflict, detail: conflict ? `conflicts with: "${conflict}"` : 'no contradicting line' });
    return { ...c, checks, adopt: checks.every((x) => x.pass) };
  });
}

// ---------- 5. Ship: render a versioned AGENTS.md block ----------
export function renderBlock(gated, version = 1, date = new Date().toISOString().slice(0, 10)) {
  const adopted = gated.filter((g) => g.adopt);
  const lines = [START, `## Learned from corrections (Adaply Loop v${version}, ${date})`, '',
    '_Each rule below was corrected by a human in at least two separate agent sessions. Evidence lives in `.adaply/`._', ''];
  for (const g of adopted) lines.push(`- ${g.rule}. <!-- ${g.id}: ${g.occurrences}x across ${g.sessions} sessions (${g.harnesses.join(', ')}) -->`);
  if (!adopted.length) lines.push('- (no rule passed the gate yet)');
  lines.push(END);
  return lines.join('\n');
}
export function applyBlock(agentsMd, block) {
  const s = agentsMd.indexOf(START), e = agentsMd.indexOf(END);
  if (s !== -1 && e !== -1) return agentsMd.slice(0, s) + block + agentsMd.slice(e + END.length);
  return (agentsMd.trimEnd() ? agentsMd.trimEnd() + '\n\n' : '# AGENTS.md\n\n') + block + '\n';
}

export function analyze(files, existingAgentsMd = '', opts = {}) {
  const sessions = files.map((f) => parseSession(f.text, f.name));
  const corrections = sessions.flatMap(findCorrections);
  const clusters = cluster(corrections);
  const gated = gate(clusters, existingAgentsMd, opts);
  const redactions = files.reduce((n, f) => n + redact(f.text).hits, 0);
  return { sessions: sessions.map(({ turns, ...s }) => ({ ...s, turns: turns.length })), corrections, gated, redactions };
}
