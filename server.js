const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { TAGS, TYPES, TRAITS, ATTS, INKS, NAMES, PERMITS, QUOTES } = require('./content');

const PORT = Number(process.env.PORT) || 3000;
const DAYS = 5;
const DAY_SECS = Number(process.env.DAY_SECS) || 150;
const BRIEF_SECS = 20, NEWS_SECS = 50, ACCUSE_SECS = 45;
const PRICES = { hat: 30, glasses: 30, mustache: 30, bowtie: 30, peek: 20, shred: 15, prank: 15 };

function lanIP() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo|tun|tailscale)/.test(name)) continue;
    for (const a of addrs) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}
// Where phones reach this server: the public address when hosted, otherwise this machine on the LAN.
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://${lanIP()}:${PORT}`).replace(/\/$/, '');
const joinUrl = code => `${PUBLIC_URL}/play?room=${code}`;
const MAX_ROOMS = 300, MAX_CONNECTIONS = 3000, MAX_SCREENS = 6;
// One visitor (IP) can't use up the whole server: a family needs a TV or two and a few phones.
const MAX_ROOMS_PER_IP = 4, MAX_CONNECTIONS_PER_IP = 30;
const ROOM_IDLE_MS = 30 * 60 * 1000;

// ---------- HTTP ----------
const PUB = path.join(__dirname, 'public');
const server = http.createServer(async (req, res) => {
  const [url, query = ''] = req.url.split('?');
  if (url === '/qr.svg') {
    const code = String(new URLSearchParams(query).get('room') || '').toUpperCase();
    if (!rooms.has(code)) { res.writeHead(404); return res.end(); }
    const svg = await QRCode.toString(joinUrl(code), { type: 'svg', margin: 1, color: { dark: '#2b2118', light: '#f6ecd2' } });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(svg);
  }
  const file = url === '/' || url === '/host' || url === '/mirror' ? 'host.html' : url === '/play' ? 'play.html' : null;
  if (!file) { res.writeHead(302, { Location: '/play' }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(PUB, file)).pipe(res);
});

// ---------- helpers ----------
const AVATARS = ['🦊', '🐸', '🐼', '🦄', '🐙', '🐯', '🐵', '🐧', '🦖', '🐝', '🐨', '🦁', '🐷', '🐰', '🐻', '🐮'];
const COLORS = ['#e4572e', '#29a19c', '#f3a712', '#6a4c93', '#3d7dca', '#d1495b', '#66a182', '#b5838d'];
const BUILDINGS = ['🏠', '🏢', '🏪', '🏡', '🏬', '🏫', '🏤', '🏦'];
const tagKeys = Object.keys(TAGS), typeKeys = Object.keys(TYPES), traitKeys = Object.keys(TRAITS);
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// Names show up on every screen: keep them short and free of markup characters.
const cleanName = n => String(n || '').replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, 12);

// ---------- rooms ----------
// Every TV screen opens its own room; phones join it by code. Only the screen that
// created a room (it holds the room's secret key) can start, skip or kick.
function createRoom(code, ip) {
  const key = crypto.randomBytes(16).toString('hex');
  const JOIN_URL = joinUrl(code);
  let lastActive = Date.now();
  // A phone reconnects to its seat with a private id; everyone else only sees a random
  // public id, so knowing a player's id doesn't let you take over their seat.
  const seats = new Map();
  // ---------- state ----------
  const players = new Map();
  const hosts = new Set();
  const mirrors = new Set(); // read-only host screens (/mirror)
  let order = [];          // clerk ids in the current game
  let rules = [];
  const forms = new Map();
  let city = null;
  let news = [];
  let g = { phase: 'lobby' };
  let timer = null, ticker = null, memoTimer = null, uid = 0, eventTimers = [];

  const online = () => order.map(id => players.get(id)).filter(p => p && p.ws);
  const nm = id => { const p = players.get(id); return p ? `${p.avatar} ${p.name}` : '???'; };
  function setTimer(sec, fn) { clearTimeout(timer); g.deadline = Date.now() + sec * 1000; timer = setTimeout(fn, sec * 1000); }
  function clearTimers() { clearTimeout(timer); clearInterval(ticker); clearTimeout(memoTimer); eventTimers.forEach(clearTimeout); eventTimers = []; g.deadline = null; if (g.event) g.event = null; }

  // ---------- rules engine ----------
  function test(c, f) {
    switch (c.k) {
      case 'tag': return f.tags.includes(c.v);
      case 'ink': return f.ink === c.v;
      case 'unsigned': return !f.signed;
      case 'fee': return f.fee === c.v;
      case 'mood': return f.mood === c.v;
      case 'type': return f.type === c.v;
      case 'att': return f.atts.includes(c.v);
      case 'noatt': return !f.atts.includes(c.v);
    }
    return false;
  }
  const matches = (r, f) => r.when.every(c => test(c, f));

  const DENY_GEN = [
    () => { const t = pick(tagKeys), a = pick(ATTS); return { when: [{ k: 'tag', v: t }, { k: 'noatt', v: a }], text: `DENY all ${TAGS[t]} permits unless "${a}" is attached.` }; },
    () => { const i = pick(['crayon', 'glitter']); return { when: [{ k: 'ink', v: i }], text: `DENY anything written in ${INKS[i].toUpperCase()}.` }; },
    () => ({ when: [{ k: 'unsigned' }], text: 'DENY any form that is NOT SIGNED.' }),
    () => ({ when: [{ k: 'fee', v: 'unpaid' }], text: 'DENY any form where the fee is UNPAID.' }),
    () => ({ when: [{ k: 'fee', v: 'buttons' }], text: 'DENY fees paid in 🔘 BUTTONS. Buttons are not money.' }),
    () => { const ty = pick(typeKeys), t = pick(tagKeys); return { when: [{ k: 'type', v: ty }, { k: 'tag', v: t }], text: `DENY ${TYPES[ty]} ${ty.toUpperCase()}S asking for ${TAGS[t]} permits.` }; },
    () => { const t = pick(tagKeys); return { when: [{ k: 'mood', v: 'angry' }, { k: 'tag', v: t }], text: `DENY 😠 ANGRY citizens asking for ${TAGS[t]} permits.` }; },
    () => { const ty = pick(typeKeys); return { when: [{ k: 'type', v: ty }, { k: 'noatt', v: 'Proof of Existence' }], text: `DENY ${TYPES[ty]} ${ty.toUpperCase()}S without "Proof of Existence".` }; },
  ];
  const ALLOW_GEN = [
    () => ({ when: [{ k: 'mood', v: 'crying' }], text: 'ALWAYS APPROVE 😭 CRYING citizens. We are not monsters.' }),
    () => { const ty = pick(typeKeys); return { when: [{ k: 'type', v: ty }], text: `ALWAYS APPROVE ${TYPES[ty]} ${ty.toUpperCase()}S. They have friends in high places.` }; },
    () => { const a = pick(ATTS); return { when: [{ k: 'att', v: a }], text: `ALWAYS APPROVE anything with "${a}" attached.` }; },
    () => ({ when: [{ k: 'ink', v: 'glitter' }], text: 'ALWAYS APPROVE ✨ GLITTER PEN forms. Glitter is the law.' }),
  ];
  function genWho() {
    const clerks = order.map(id => players.get(id));
    const held = traitKeys.filter(t => clerks.some(p => p.traits.includes(t)));
    const negOk = held.filter(t => clerks.some(p => !p.traits.includes(t)));
    const t = pick(tagKeys);
    if (Math.random() < 0.65 || !negOk.length) {
      const tr = pick(held);
      return { when: [{ k: 'tag', v: t }], trait: tr, neg: false, text: `${TAGS[t]} permits may ONLY be stamped by a clerk wearing ${TRAITS[tr].e} ${TRAITS[tr].n}.` };
    }
    const tr = pick(negOk);
    return { when: [{ k: 'tag', v: t }], trait: tr, neg: true, text: `${TAGS[t]} permits may NOT be stamped by anyone wearing ${TRAITS[tr].e} ${TRAITS[tr].n}.` };
  }
  function genRule(kind) {
    for (let i = 0; i < 40; i++) {
      const r = kind === 'deny' ? pick(DENY_GEN)() : kind === 'allow' ? pick(ALLOW_GEN)() : genWho();
      if (rules.some(x => x.text === r.text)) continue;
      if (kind === 'who' && rules.some(x => x.kind === 'who' && x.when[0].v === r.when[0].v)) continue;
      return { ...r, kind };
    }
    return null;
  }
  function addRules(k) {
    const added = [];
    for (let i = 0; i < k; i++) {
      const roll = Math.random();
      const kind = g.day === 1 ? ['deny', 'who', 'allow', 'deny', 'deny', 'who'][i % 6] : roll < 0.5 ? 'deny' : roll < 0.75 ? 'who' : 'allow';
      const r = genRule(kind);
      if (!r) continue;
      const counts = order.map(id => [id, rules.filter(x => x.owner === id).length]);
      const min = Math.min(...counts.map(c => c[1]));
      r.owner = pick(counts.filter(c => c[1] === min))[0];
      r.id = ++uid; r.day = g.day; r.isNew = true;
      rules.push(r); added.push(r);
      send(players.get(r.owner)?.ws, { t: 'fx', kind: 'newrule' });
    }
    return added;
  }
  function judge(f) {
    const allow = rules.find(r => r.kind === 'allow' && matches(r, f));
    const deny = rules.find(r => r.kind === 'deny' && matches(r, f));
    const who = rules.filter(r => r.kind === 'who' && matches(r, f));
    return { verdict: allow ? 'approve' : deny ? 'deny' : 'approve', allow, deny, who };
  }
  function canAny(f, name, type) { const t = { ...f, name, type }; return order.some(id => canStamp(players.get(id), judge(t).who)); }
  const canStamp = (p, who) => who.every(r => (r.neg ? !p.traits.includes(r.trait) : p.traits.includes(r.trait)));

  // ---------- forms ----------
  const VIPS = [['The Mayor', 'grandma'], ['Duchess Fluffington', 'raccoon'], ['A Famous Pop Star', 'alien'], ['The King of Sweden', 'vampire'], ['A Very Important Goose', 'pirate'], ['The Ghost of Elvis', 'ghost'], ['Robo-President 3000', 'robot']];
  function genForm(wantBribe, vip) {
    for (let i = 0; i < 30; i++) {
      const p = pick(PERMITS), r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
      const f = {
        id: ++uid, no: 1000 + uid, name: pick(NAMES), type: pick(typeKeys),
        permit: p.text, pemoji: p.emoji, tags: p.tags, bad: p.bad,
        ink: r1 < 0.6 ? 'pen' : r1 < 0.8 ? 'crayon' : 'glitter',
        signed: Math.random() < 0.82,
        fee: r2 < 0.7 ? 'paid' : r2 < 0.85 ? 'unpaid' : 'buttons',
        mood: r3 < 0.6 ? 'calm' : r3 < 0.8 ? 'angry' : 'crying',
        atts: ATTS.filter(() => Math.random() < 0.3),
      };
      const j = judge(f);
      if (!order.some(id => canStamp(players.get(id), j.who))) continue;
      if (wantBribe && j.verdict !== 'deny') continue;
      if (wantBribe) f.bribe = pick([30, 40, 50, 60]);
      f.quote = pick(Math.random() < 0.35 ? QUOTES[f.mood] : QUOTES.any);
      if (vip) { const [n, t] = pick(VIPS); if (canAny(f, n, t)) { f.name = n; f.type = t; } f.vip = true; }
      return f;
    }
    return wantBribe ? genForm(false, vip) : null;
  }
  function spawnForm(forceVip) {
    const clerks = online();
    if (!clerks.length) return;
    const vip = forceVip || (g.day >= 2 && Math.random() < 0.07);
    const f = genForm(!vip && g.day >= 2 && Math.random() < 0.13, vip);
    if (!f) return;
    // favor emptier desks a bit
    const load = id => [...forms.values()].filter(x => x.holder === id).length;
    const sorted = shuffle(clerks).sort((a, b) => load(a.id) - load(b.id));
    f.holder = (Math.random() < 0.6 ? sorted[0] : pick(clerks)).id;
    f.born = Date.now();
    f.patience = (f.vip ? 40 : 58 - g.day * 3) * 1000;
    forms.set(f.id, f);
    send(players.get(f.holder).ws, { t: 'fx', kind: 'newform' });
    broadcastHosts({ t: 'fx', kind: 'arrive' });
  }
  const spawnInterval = () => Math.max(2.2, 6.6 - g.day * 0.9) * 4 / Math.max(2, online().length) * 1000;

  function addNews(kind, text) {
    news.push({ kind, text, day: g.day, id: ++uid });
    news = news.slice(-80);
    broadcastHosts({ t: 'news', kind, text });
  }
  function moodChange(n) {
    city.mood = clamp(city.mood + n, 0, 100);
    if (city.mood <= 0 && g.phase === 'day') { g.shutdown = true; addNews('disaster', '🚨 THE MINISTRY HAS BEEN SHUT DOWN BY ANGRY CITIZENS'); endDay(); }
  }
  function randomLot(preferHealthy) {
    const idx = city.lots.map((l, i) => i).filter(i => !preferHealthy || !city.lots[i].fire);
    return pick(idx.length ? idx : city.lots.map((l, i) => i));
  }

  function stamp(pid, fid, verdict) {
    const f = forms.get(fid), p = players.get(pid);
    if (g.phase !== 'day' || !f || f.holder !== pid || !['approve', 'deny'].includes(verdict)) return;
    forms.delete(fid);
    const j = judge(f), whoOk = canStamp(p, j.who), verdictOk = verdict === j.verdict, ok = verdictOk && whoOk;
    const st = g.stats;
    const cname = `${TYPES[f.type]} ${f.name}`;
    let why = null;
    const base = f.vip ? 20 : 10;
    let pay;
    if (ok) {
      p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak);
      const bonus = p.streak >= 3 ? Math.min(10, (p.streak - 2) * 2) : 0;
      pay = base + bonus;
      p.money += pay; p.correct++; st.correct++; if (f.vip) p.vips++;
      if (verdict === 'approve') {
        city.lots[randomLot(true)] = { e: f.pemoji, fire: false, fresh: Date.now() };
        addNews('good', `${cname} can now ${f.permit}! ${f.pemoji}`);
        moodChange(2);
      } else {
        addNews('ok', `Ministry wisely blocks ${cname}'s plan to ${f.permit}.`);
        moodChange(1);
      }
    } else {
      p.streak = 0;
      pay = f.vip ? -10 : -5;
      p.money += pay; p.wrong++; st.wrong++;
      if (!whoOk) {
        const r = j.who.find(r => !canStamp(p, [r]));
        why = { text: r.text, owner: r.owner };
      } else if (verdict === 'approve') why = { text: j.deny.text, owner: j.deny.owner };
      else why = j.allow ? { text: j.allow.text, owner: j.allow.owner } : { text: 'No rule said to deny this one. When in doubt, APPROVE!', owner: null };

      if (!verdictOk && verdict === 'approve') {
        const lot = randomLot(true);
        city.lots[lot] = { e: f.pemoji, fire: true, fresh: Date.now() };
        addNews('disaster', f.vip ? `⭐ VIP SCANDAL: ${f.bad}` : `${f.bad}`);
        p.worst = p.worst || f.bad; p.disasters++;
        broadcastHosts({ t: 'fx', kind: 'disaster', lot, text: f.bad, emoji: f.pemoji });
        moodChange(f.vip ? -16 : -9);
      } else if (!verdictOk) {
        city.protest++;
        addNews('protest', `${cname} protests outside the Ministry: "I just wanted to ${f.permit}!"`);
        broadcastHosts({ t: 'fx', kind: 'protest' });
        moodChange(-5);
      } else {
        const r = j.who.find(r => !canStamp(p, [r]));
        addNews('scandal', `PAPERWORK SCANDAL: ${p.name} stamped a ${TAGS[r.when[0].v]} permit ${r.neg ? 'WHILE wearing' : 'WITHOUT'} ${TRAITS[r.trait].n}!`);
        broadcastHosts({ t: 'fx', kind: 'scandal' });
        moodChange(-4);
      }
    }
    let bribe = 0;
    if (verdict === 'approve' && f.bribe) { bribe = f.bribe; p.money += bribe; p.bribes += bribe; p.bribeCount++; }
    send(p.ws, { t: 'result', ok, verdict, pay, bribe, vip: !!f.vip, streak: p.streak, why: why && { text: why.text, owner: why.owner && nm(why.owner) } });
    broadcastHosts({ t: 'fx', kind: 'stamp', pid, ok, verdict, emoji: TYPES[f.type], vip: !!f.vip, streak: p.streak });
    sync();
  }
  function pass(pid, fid, to) {
    const f = forms.get(fid), t = players.get(to);
    if (g.phase !== 'day' || !f || f.holder !== pid || !t?.ws || to === pid || !order.includes(to)) return;
    f.holder = to;
    players.get(pid).passes++;
    send(t.ws, { t: 'fx', kind: 'newform', from: nm(pid) });
    broadcastHosts({ t: 'fx', kind: 'pass', from: pid, to });
    sync();
  }
  function shred(pid, fid) {
    const f = forms.get(fid), p = players.get(pid);
    if (g.phase !== 'day' || !f || f.holder !== pid || p.shreds < 1) return;
    p.shreds--; forms.delete(fid);
    broadcastHosts({ t: 'fx', kind: 'shred' });
    sync();
  }

  function tick() {
    if (g.phase !== 'day') return;
    const now = Date.now();
    let changed = false;
    if (now >= g.nextSpawn) { spawnForm(); g.nextSpawn = now + spawnInterval(); changed = true; }
    for (const f of [...forms.values()]) {
      if (now - f.born > f.patience) {
        forms.delete(f.id);
        const p = players.get(f.holder);
        if (p) { p.money -= 3; p.walkouts++; p.streak = 0; }
        g.stats.lost++;
        addNews('left', `${TYPES[f.type]} ${f.name} waited forever and stormed out in a huff.`);
        broadcastHosts({ t: 'fx', kind: 'left' });
        moodChange(-4);
        changed = true;
        if (g.phase !== 'day') return;
      } else if (!players.get(f.holder)?.ws) {
        const c = online();
        if (c.length) { f.holder = pick(c).id; changed = true; }
      }
    }
    if (changed) sync();
  }

  // ---------- chaos events ----------
  const EVENTS = {
    quiet: { title: '🤫 QUIET HOURS', text: 'NO TALKING for 25 seconds! Point, wave, do charades…', secs: 25 },
    opposite: { title: '🙃 OPPOSITE DAY', text: 'APPROVE and DENY buttons have swapped places. Read carefully!', secs: 25 },
    swap: { title: '🔀 DESK SWAP', text: "Everyone's inbox just moved to the next clerk!", secs: 0 },
    wind: { title: '🌪️ WINDSTORM', text: 'A gust blew every form onto a random desk!', secs: 0 },
    rush: { title: '🏃 RUSH HOUR', text: 'A crowd of citizens just burst through the door!', secs: 0 },
    vip: { title: '⭐ VIP VISIT', text: 'A VIP is here! Double pay… and double disaster if you mess up.', secs: 0 },
    decree: { title: '📜 EMERGENCY DECREE', text: '', secs: 30 },
  };
  function startEvent(kind) {
    if (g.phase !== 'day') return;
    const ev = EVENTS[kind], clerks = online();
    if (!clerks.length) return;
    if (kind === 'swap') {
      const ids = clerks.map(p => p.id);
      forms.forEach(f => { const i = ids.indexOf(f.holder); if (i >= 0) f.holder = ids[(i + 1) % ids.length]; });
    } else if (kind === 'wind') forms.forEach(f => { f.holder = pick(clerks).id; });
    else if (kind === 'rush') for (let i = 0; i < Math.min(5, clerks.length + 2); i++) spawnForm();
    else if (kind === 'vip') spawnForm(true);
    let text = ev.text;
    if (kind === 'decree') {
      const t = pick(tagKeys);
      text = `The Mayor orders: ALWAYS APPROVE ${TAGS[t]} permits for 30 seconds! (Beats any DENY.)`;
      rules.push({ id: ++uid, kind: 'allow', when: [{ k: 'tag', v: t }], text: `📜 MAYOR'S DECREE: ALWAYS APPROVE ${TAGS[t]} permits.`, owner: null, temp: true, day: g.day });
    }
    g.event = { kind, title: ev.title, text, until: ev.secs ? Date.now() + ev.secs * 1000 : null };
    addNews('memo', `${ev.title}: ${text}`);
    const msg = { t: 'fx', kind: 'event', ev: kind, title: ev.title, text };
    broadcastHosts(msg); online().forEach(p => send(p.ws, msg));
    if (ev.secs) eventTimers.push(setTimeout(() => { if (kind === 'decree') rules = rules.filter(r => !r.temp); if (g.event?.kind === kind) { g.event = null; sync(); } }, ev.secs * 1000));
    else eventTimers.push(setTimeout(() => { if (g.event?.kind === kind) { g.event = null; sync(); } }, 4000));
    sync();
  }
  function awards(clerks) {
    const out = {};
    const best = (key, min, title, desc, low) => {
      const c = clerks.filter(p => (p[key] ?? 0) >= min);
      if (!c.length) return;
      const v = low ? Math.min(...c.map(p => p[key])) : Math.max(...c.map(p => p[key]));
      c.filter(p => p[key] === v).forEach(p => (out[p.id] = out[p.id] || []).push({ title, desc: desc(v) }));
    };
    best('disasters', 1, '🔥 Certified Arsonist', v => `${v} city disaster${v > 1 ? 's' : ''}`);
    best('passes', 3, '📬 Professional Mail Carrier', v => `passed ${v} forms`);
    best('bestStreak', 4, '🎯 Rubber Stamp Sniper', v => `${v} correct in a row`);
    best('walkouts', 2, '🐌 Slowpoke of the Week', v => `${v} citizens gave up waiting`);
    best('bribes', 1, '🤑 Most Crooked', v => `$${v} in bribes`);
    best('vips', 1, '⭐ VIP Whisperer', v => `served ${v} VIP${v > 1 ? 's' : ''}`);
    best('pranked', 2, '🪳 Office Punching Bag', v => `got pranked ${v} times`);
    clerks.forEach(p => { const tot = p.correct + p.wrong; if (tot >= 6 && p.wrong === 0) (out[p.id] = out[p.id] || []).push({ title: '😇 Flawless Bureaucrat', desc: 'never made a mistake' }); });
    return out;
  }

  // ---------- phases ----------
  function startGame() {
    order = shuffle([...players.values()].filter(p => p.ws).map(p => p.id));
    const tr = shuffle(traitKeys);
    order.forEach((id, i) => {
      Object.assign(players.get(id), { money: 0, traits: [tr[i % tr.length]], shreds: 0, bribes: 0, bribeCount: 0, correct: 0, wrong: 0, worst: null, ready: false, vote: null, peeks: [], streak: 0, bestStreak: 0, passes: 0, disasters: 0, walkouts: 0, vips: 0, megaphones: 0, pranks: 0, tossDay: 0, pranked: 0 });
    });
    rules = []; forms.clear(); news = [];
    city = { mood: 70, protest: 0, lots: Array.from({ length: 18 }, () => ({ e: pick(BUILDINGS), fire: false })) };
    g = { phase: 'brief', day: 0, history: [] };
    startBrief(1);
  }
  function startBrief(d) {
    clearTimers();
    g.day = d; g.phase = 'brief'; g.memo = null;
    rules.forEach(r => { r.isNew = false; });
    order.forEach(id => { players.get(id).ready = false; });
    g.newRules = addRules(d === 1 ? Math.max(4, order.length) : 2).length;
    setTimer(d === 1 ? BRIEF_SECS + 10 : BRIEF_SECS, startDay);
    sync();
  }
  function startDay() {
    clearTimers();
    g.phase = 'day';
    g.stats = { correct: 0, wrong: 0, lost: 0 };
    rules = rules.filter(r => !r.temp);
    order.forEach(id => { players.get(id).megaphones = 1; });
    city.lots.forEach(l => { if (l.fire) { l.fire = false; l.e = '🏗️'; } });
    city.protest = Math.floor(city.protest / 2);
    g.nextSpawn = Date.now() + 1500;
    ticker = setInterval(tick, 400);
    setTimer(DAY_SECS, endDay);
    if (g.day >= 2) {
      const n = g.day === 2 ? 1 : 2, kinds = shuffle(Object.keys(EVENTS));
      const slots = g.day === 2 ? [0.3 + Math.random() * 0.15] : [0.2 + Math.random() * 0.15, 0.65 + Math.random() * 0.15];
      for (let i = 0; i < n; i++) eventTimers.push(setTimeout(() => startEvent(kinds[i]), DAY_SECS * 1000 * slots[i]));
    }
    if (g.day >= 3) memoTimer = setTimeout(() => {
      if (g.phase !== 'day') return;
      const [r] = addRules(1);
      if (r) { g.memo = { owner: r.owner }; addNews('memo', `📢 MEMO: a new rule was just delivered to ${nm(r.owner)}!`); broadcastHosts({ t: 'fx', kind: 'memo', owner: r.owner }); sync(); }
    }, DAY_SECS * 500);
    sync();
  }
  function endDay() {
    if (g.phase !== 'day') return;
    clearTimers();
    rules = rules.filter(r => !r.temp);
    forms.clear();
    const today = news.filter(n => n.day === g.day);
    const rank = { disaster: 0, scandal: 1, protest: 2, left: 3, good: 4, ok: 5, memo: 6 };
    const headlines = [...today].sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 5);
    g.paper = { day: g.day, headlines, stats: g.stats, mood: city.mood, shutdown: !!g.shutdown };
    g.history.push({ day: g.day, ...g.stats });
    g.phase = 'news';
    order.forEach(id => { players.get(id).ready = false; });
    setTimer(NEWS_SECS, afterNews);
    sync();
  }
  function afterNews() {
    if (g.day >= DAYS || g.shutdown) startAccuse();
    else startBrief(g.day + 1);
  }
  function startAccuse() {
    clearTimers();
    g.phase = 'accuse';
    order.forEach(id => { players.get(id).vote = null; });
    setTimer(ACCUSE_SECS, finish);
    sync();
  }
  function finish() {
    if (g.phase !== 'accuse') return;
    clearTimers();
    const clerks = order.map(id => players.get(id));
    if (g.shutdown) clerks.forEach(p => { p.money = Math.floor(p.money / 2); });
    const votes = {};
    clerks.forEach(p => { if (p.vote && p.vote !== 'none') votes[p.vote] = (votes[p.vote] || 0) + 1; });
    clerks.forEach(p => {
      p.accuseGain = 0;
      const t = p.vote && p.vote !== 'none' && players.get(p.vote);
      if (t) { p.accuseGain = t.bribeCount > 0 ? 40 : -20; p.money += p.accuseGain; }
    });
    const need = Math.max(1, Math.ceil((clerks.length - 1) / 2));
    clerks.forEach(p => {
      p.votesAgainst = votes[p.id] || 0;
      p.caught = p.votesAgainst >= need && p.bribeCount > 0;
      if (p.caught) p.money -= p.bribes;
    });
    const aw = awards(clerks);
    g.results = clerks.map(p => ({ id: p.id, awards: aw[p.id] || [], money: p.money, bribes: p.bribes, bribeCount: p.bribeCount, caught: p.caught, votesAgainst: p.votesAgainst, accuseGain: p.accuseGain, correct: p.correct, wrong: p.wrong, worst: p.worst })).sort((a, b) => b.money - a.money);
    g.phase = 'final';
    sync();
  }
  function toLobby() {
    clearTimers();
    forms.clear(); order = []; rules = [];
    for (const [id, p] of players) if (!p.ws) players.delete(id);
    g = { phase: 'lobby' };
    sync();
  }
  function allReady() { const c = online(); return c.length && c.every(p => p.ready); }

  // ---------- views ----------
  const formSummary = f => ({ id: f.id, holder: f.holder, emoji: TYPES[f.type], pemoji: f.pemoji, age: Date.now() - f.born, patience: f.patience, vip: !!f.vip });
  function pubPlayer(p) {
    return {
      id: p.id, name: p.name, avatar: p.avatar, color: p.color, online: !!p.ws, traits: p.traits || [],
      ready: !!p.ready, voted: !!p.vote, nRules: rules.filter(r => r.owner === p.id).length, streak: p.streak || 0,
    };
  }
  function view(pid) {
    const inGame = g.phase !== 'lobby';
    const v = {
      phase: g.phase, day: g.day, days: DAYS, timeLeft: g.deadline ? Math.max(0, g.deadline - Date.now()) : null,
      players: (inGame ? order.map(id => players.get(id)) : [...players.values()]).filter(Boolean).map(pubPlayer),
      mood: city?.mood, memo: g.memo, newRules: g.newRules, shutdown: !!g.shutdown,
      dayLen: DAY_SECS * 1000,
      event: g.event && { ...g.event, left: g.event.until ? Math.max(0, g.event.until - Date.now()) : null },
    };
    v.room = code;
    if (g.phase === 'lobby') { v.joinUrl = JOIN_URL; v.mirrorUrl = `${PUBLIC_URL}/mirror?room=${code}`; }
    if (g.phase === 'news') v.paper = g.paper;
    if (g.phase === 'final') v.results = g.results;
    if (!pid) {
      if (inGame) { v.city = city; v.forms = [...forms.values()].map(formSummary); v.news = news.slice(-6); v.history = g.history; }
      return v;
    }
    const p = players.get(pid);
    v.me = pid; v.inGame = order.includes(pid);
    if (v.inGame) {
      Object.assign(v, { money: p.money, shreds: p.shreds, traits: p.traits, ready: p.ready, vote: p.vote, peeks: p.peeks, prices: PRICES, megaphones: p.megaphones, pranks: p.pranks, tossed: p.tossDay === g.day });
      v.decree = rules.filter(r => r.temp).map(r => r.text);
      v.rules = rules.filter(r => r.owner === pid).map(r => ({ id: r.id, kind: r.kind, text: r.text, isNew: r.isNew }));
      v.desk = [...forms.values()].filter(f => f.holder === pid).sort((a, b) => a.born - b.born).map(f => ({
        ...formSummary(f), no: f.no, name: f.name, type: f.type, permit: f.permit, tags: f.tags.map(t => TAGS[t]),
        ink: f.ink, signed: f.signed, fee: f.fee, mood: f.mood, atts: f.atts, bribe: f.bribe || 0, quote: f.quote,
      }));
    }
    return v;
  }

  function broadcastHosts(m) { hosts.forEach(ws => send(ws, m)); }
  function sync() {
    hosts.forEach(ws => send(ws, { t: 'state', s: view() }));
    players.forEach(p => send(p.ws, { t: 'state', s: view(p.id) }));
  }

  function hostCmd(m) {
    if (m.t === 'start' && g.phase === 'lobby' && [...players.values()].some(p => p.ws)) startGame();
    else if (m.t === 'lobby') toLobby();
    else if (m.t === 'event' && EVENTS[m.kind] && g.phase === 'day') startEvent(m.kind);
    else if (m.t === 'skip') ({ brief: startDay, day: endDay, news: afterNews, accuse: finish }[g.phase] || (() => {}))();
    else if (m.t === 'kick' && players.has(m.id) && g.phase === 'lobby') {
      send(players.get(m.id).ws, { t: 'kicked' });
      players.delete(m.id); sync();
    }
  }

  function playerCmd(pid, m) {
    const p = players.get(pid);
    if (!order.includes(pid)) return;
    switch (m.t) {
      case 'stamp': return stamp(pid, +m.fid, m.v);
      case 'pass': return pass(pid, +m.fid, String(m.to));
      case 'shred': return shred(pid, +m.fid);
      case 'ready':
        if (!['brief', 'news'].includes(g.phase)) return;
        p.ready = true;
        if (allReady()) return g.phase === 'brief' ? startDay() : afterNews();
        return sync();
      case 'buy': {
        const price = PRICES[m.item];
        if (g.phase !== 'news' || !price || p.money < price) return;
        if (TRAITS[m.item]) { if (p.traits.includes(m.item)) return; p.traits.push(m.item); }
        else if (m.item === 'peek') {
          const pool = rules.filter(r => r.owner !== pid && !p.peeks.some(x => x.id === r.id));
          if (!pool.length) return send(p.ws, { t: 'toast', text: 'Nothing left to peek at!' });
          const r = pick(pool);
          p.peeks.push({ id: r.id, kind: r.kind, text: r.text, owner: nm(r.owner) });
          send(p.ws, { t: 'toast', text: `🔍 Peeked at ${nm(r.owner)}'s rulebook!` });
        } else if (m.item === 'shred') p.shreds++;
        else if (m.item === 'prank') p.pranks++;
        p.money -= price;
        return sync();
      }
      case 'megaphone': {
        const r = rules.find(x => x.id === +m.id && x.owner === pid);
        if (g.phase !== 'day' || !r || p.megaphones < 1) return;
        p.megaphones--;
        broadcastHosts({ t: 'fx', kind: 'megaphone', pid, text: r.text, rkind: r.kind });
        addNews('memo', `📢 ${nm(pid)} shouts: "${r.text}"`);
        return sync();
      }
      case 'prank': {
        const t = players.get(String(m.to));
        if (g.phase !== 'day' || p.pranks < 1 || !t?.ws || m.to === pid || !order.includes(m.to)) return;
        p.pranks--; t.pranked++;
        const kind = pick(['bugs', 'bees', 'balloons']);
        send(t.ws, { t: 'prank', kind, from: nm(pid) });
        broadcastHosts({ t: 'fx', kind: 'prank', pid, to: t.id, prank: kind });
        return sync();
      }
      case 'toss': {
        if (g.phase !== 'news' || p.tossDay === g.day) return;
        p.tossDay = g.day;
        const hits = clamp(Math.floor(+m.hits || 0), 0, 3);
        p.money += hits * 5;
        if (hits === 3) broadcastHosts({ t: 'fx', kind: 'toss', pid });
        return sync();
      }
      case 'vote':
        if (g.phase !== 'accuse' || m.id === pid || (m.id !== 'none' && !order.includes(m.id))) return;
        p.vote = m.id;
        if (online().every(x => x.vote)) return finish();
        return sync();
    }
  }

  // ---------- connections ----------
  function attach(ws, role) {
    lastActive = Date.now();
    if (role === 'play') return send(ws, { t: 'hello', taken: [...players.values()].map(p => p.avatar), traits: TRAITS });
    if (hosts.size >= MAX_SCREENS) { send(ws, { t: 'busy' }); return ws.close(); }
    hosts.add(ws);
    if (role === 'mirror') mirrors.add(ws);
    send(ws, { t: 'hello', traits: TRAITS });
    send(ws, { t: 'state', s: view() });
  }
  function message(ws, m, conn) {
    lastActive = Date.now();
    if (hosts.has(ws)) return mirrors.has(ws) ? undefined : hostCmd(m);
    if (m.t === 'join') {
      const secret = String(m.id || '').slice(0, 40);
      if (secret.length < 8) return;
      const name = cleanName(m.name);
      let id = seats.get(secret);
      let p = id && players.get(id);
      if (!p) {
        id = crypto.randomBytes(6).toString('hex');
        if (!name) return send(ws, { t: 'needName' });
        if (players.size >= 8) return send(ws, { t: 'full' });
        const used = new Set([...players.values()].map(x => x.avatar));
        const usedC = new Set([...players.values()].map(x => x.color));
        p = {
          id, name, ws: null, traits: [], money: 0,
          avatar: AVATARS.includes(m.avatar) && !used.has(m.avatar) ? m.avatar : AVATARS.find(a => !used.has(a)),
          color: COLORS.find(c => !usedC.has(c)) || COLORS[0],
        };
        players.set(id, p);
        seats.set(secret, id);
        broadcastHosts({ t: 'fx', kind: 'join' });
      } else if (name && g.phase === 'lobby') p.name = name;
      if (p.ws && p.ws !== ws) p.ws.close();
      p.ws = ws; conn.pid = id;
      return sync();
    }
    if (conn.pid && players.has(conn.pid)) playerCmd(conn.pid, m);
  }
  function close(ws, conn) {
    lastActive = Date.now();
    hosts.delete(ws); mirrors.delete(ws);
    const p = conn.pid && players.get(conn.pid);
    if (p && p.ws === ws) {
      p.ws = null;
      if (g.phase === 'lobby') players.delete(conn.pid);
      else if (g.phase === 'accuse' && online().length && online().every(x => x.vote)) return finish();
      else if (['brief', 'news'].includes(g.phase) && allReady()) return g.phase === 'brief' ? startDay() : afterNews();
      sync();
    }
  }
  const idle = () => !hosts.size && ![...players.values()].some(p => p.ws) && Date.now() - lastActive > ROOM_IDLE_MS;
  return { code, key, ip, attach, message, close, idle, dispose: clearTimers };
}

const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do c = Array.from({ length: 4 }, () => pick([...CODE_CHARS])).join(''); while (rooms.has(c));
  return c;
}
setInterval(() => { for (const [c, r] of rooms) if (r.idle()) { r.dispose(); rooms.delete(c); } }, 60 * 1000).unref();

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const ipConnections = new Map();
const roomsOf = ip => [...rooms.values()].filter(r => r.ip === ip).length;
wss.on('connection', (ws, req) => {
  // Fly's proxy sets Fly-Client-IP; locally it's the socket's own address.
  const ip = String(req.headers['fly-client-ip'] || req.socket.remoteAddress);
  if (wss.clients.size > MAX_CONNECTIONS || (ipConnections.get(ip) || 0) >= MAX_CONNECTIONS_PER_IP) { send(ws, { t: 'busy' }); return ws.close(1013, 'busy'); }
  ipConnections.set(ip, (ipConnections.get(ip) || 0) + 1);
  ws.on('close', () => { const n = ipConnections.get(ip) - 1; n > 0 ? ipConnections.set(ip, n) : ipConnections.delete(ip); });
  const q = new URL(req.url, 'http://x').searchParams;
  const role = ['host', 'mirror', 'play'].includes(q.get('role')) ? q.get('role') : 'play';
  const code = String(q.get('room') || '').toUpperCase().slice(0, 4);
  let room = rooms.get(code);
  if (role === 'host' && !(room && room.key === q.get('key'))) {
    if (rooms.size >= MAX_ROOMS || roomsOf(ip) >= MAX_ROOMS_PER_IP) { send(ws, { t: 'busy' }); return ws.close(); }
    room = createRoom(newCode(), ip);
    rooms.set(room.code, room);
  }
  if (!room) { send(ws, { t: 'noRoom' }); return ws.close(); }
  if (role === 'host') send(ws, { t: 'room', code: room.code, key: room.key });
  room.attach(ws, role);

  // Bad frames (too large, malformed) raise 'error'; without a handler they crash the server.
  ws.on('error', () => ws.terminate());
  const conn = { pid: null };
  let tokens = 20, refilled = Date.now();
  ws.on('message', raw => {
    // A phone sends a handful of messages a second at most; drop floods.
    const now = Date.now();
    tokens = Math.min(20, tokens + (now - refilled) / 100); refilled = now;
    if (tokens < 1) return;
    tokens--;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    room.message(ws, m, conn);
  });
  ws.on('close', () => room.close(ws, conn));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🏛️  THE MINISTRY is open for business\n');
  console.log(`  TV / big screen: http://localhost:${PORT}/`);
  console.log(`  Phones join:     ${PUBLIC_URL}/play  (scan the QR code on the TV)\n`);
});
