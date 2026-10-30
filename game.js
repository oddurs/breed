'use strict';
/* Pedigree — a dog breeding game.
 * Genetics are a simplified model of the real thing:
 *  - Mendelian loci with dominant/recessive alleles drive the visible traits.
 *  - Additive (polygenic) loci drive size, snout length and the four working stats.
 *  - Two recessive disease loci hide in carriers until a pup inherits two copies.
 *  - Inbreeding (Wright's coefficient F) costs health and litter size.
 */

const SAVE_KEY = 'pedigree-save-v1';
const KENNEL_CAP = 8;
const UPKEEP = 10;
const DNA_COST = 20;
const MAX_AGE = 9;
const MUTATION = 0.004;

// locus: [dominant, recessive, founder frequency of dominant]
const MENDEL = {
  E: ['E', 'e', 0.72], // e/e = red / cream (masks black/liver)
  B: ['B', 'b', 0.62], // b/b = liver
  D: ['D', 'd', 0.7],  // d/d = dilute (blue, lilac, cream)
  S: ['S', 's', 0.6],  // S/s = white flash, s/s = piebald
  L: ['L', 'l', 0.6],  // l/l = long coat
  F: ['F', 'f', 0.5],  // F_ = floppy ears
  C: ['C', 'c', 0.35], // C_ = curly tail
  H: ['H', 'h', 0.84], // h/h = hip dysplasia
  Y: ['Y', 'y', 0.86], // y/y = progressive retinal atrophy (blindness)
};
// polygenic traits: number of loci (each locus = 2 alleles of 0/1)
const QUANT = { sz: 4, sn: 3, spd: 3, str: 3, brn: 3, tmp: 3 };

const COLORS = {
  black: '#2b2522', liver: '#6e3c24', blue: '#6f7d8b',
  lilac: '#a8948b', red: '#c47535', cream: '#e8d0a2',
};
const WHITE = '#f7f2e8';
const STAT_KEYS = ['speed', 'strength', 'brains', 'temper', 'health'];
const STAT_LABEL = { speed: 'Speed', strength: 'Strength', brains: 'Brains', temper: 'Temper', health: 'Health' };
const STAT_SHORT = { speed: 'SPD', strength: 'STR', brains: 'BRN', temper: 'TMP', health: 'HP' };
const STAT_COL = { speed: 'var(--spd)', strength: 'var(--str)', brains: 'var(--brn)', temper: 'var(--tmp)', health: 'var(--hl)' };

// ---------- utils ----------
const $ = s => document.querySelector(s);
const rnd = Math.random;
const pick = a => a[Math.floor(rnd() * a.length)];
const randi = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = a => a.reduce((x, y) => x + y, 0);
const cap = s => s[0].toUpperCase() + s.slice(1);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => clamp(Math.round(c * (1 + amt)), 0, 255);
  return '#' + [n >> 16, n >> 8 & 255, n & 255].map(f).map(c => c.toString(16).padStart(2, '0')).join('');
}

const SYL1 = ['Bis', 'Ru', 'Ko', 'Ma', 'Pip', 'Lu', 'Ta', 'Bo', 'Fen', 'Wi', 'Mo', 'Sa', 'Dex', 'Ju', 'Oz', 'Pe', 'Ri', 'Ca', 'No', 'Zig', 'Hu', 'Kip', 'Lo', 'Bram'];
const SYL2 = ['cuit', 'fus', 'la', 'ster', 'per', 'na', 'to', 'by', 'nel', 'nie', 'chi', 'ko', 'ter', 'bles', 'dle', 'ro', 'mo', 'zy', 'well', 'go', 'lie', 'ble', 'sy', ''];
const name = () => pick(SYL1) + pick(SYL2);

// ---------- state ----------
let state;

function newGame() {
  state = {
    gen: 1, coins: 250, rep: 0, nextId: 1, nextContract: 1,
    dogs: {}, kennel: [], contracts: [], market: [], litter: null,
    log: [], over: false, best: (state && state.best) || loadBest(),
  };
  const sexes = ['M', 'M', 'F', 'F'];
  for (const sex of sexes) {
    const d = founder(sex, state.gen - randi(1, 3));
    register(d);
    state.kennel.push(d.id);
  }
  while (state.contracts.length < 3) state.contracts.push(makeContract());
  refreshMarket(true);
  addLog('Your kennel opens with four unrelated founders.');
  save();
}
function loadBest() { try { return +localStorage.getItem(SAVE_KEY + '-best') || 0; } catch { return 0; } }
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    if (state.rep > state.best) { state.best = state.rep; localStorage.setItem(SAVE_KEY + '-best', state.best); }
  } catch { /* storage unavailable: play on without saving */ }
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.dogs) { state = s; return true; } } catch { }
  return false;
}
function addLog(msg) { state.log.unshift({ gen: state.gen, msg }); state.log.length = Math.min(state.log.length, 80); }

// ---------- genetics ----------
function founder(sex, born) {
  const g = {};
  for (const [k, [A, a, p]] of Object.entries(MENDEL)) g[k] = [rnd() < p ? A : a, rnd() < p ? A : a];
  for (const [k, n] of Object.entries(QUANT)) {
    const p = 0.25 + rnd() * 0.5; // each founder line leans one way
    g[k] = Array.from({ length: n * 2 }, () => rnd() < p ? 1 : 0);
  }
  return makeDog({ g, sex, born, sire: null, dam: null, F: 0 });
}
function makeDog({ g, sex, born, sire, dam, F }) {
  const n = () => Math.round((rnd() - 0.5) * 12);
  return {
    id: null, name: name(), sex, born, sire, dam, F, g,
    noise: { spd: n(), str: n(), brn: n(), tmp: n(), hl: Math.round((rnd() - 0.5) * 8) },
    seed: Math.floor(rnd() * 1e9), tested: false,
  };
}
function register(d) { d.id = state.nextId++; state.dogs[d.id] = d; return d; }

function gamete(pair) { return pair[rnd() < 0.5 ? 0 : 1]; }
function breed(sire, dam) {
  const g = {};
  for (const [k, [A, a]] of Object.entries(MENDEL)) {
    g[k] = [gamete(sire.g[k]), gamete(dam.g[k])].map(x => rnd() < MUTATION ? (x === A ? a : A) : x);
  }
  for (const [k, n] of Object.entries(QUANT)) {
    g[k] = [];
    for (let i = 0; i < n; i++) {
      for (const par of [sire, dam]) {
        let x = par.g[k][i * 2 + (rnd() < 0.5 ? 0 : 1)];
        if (rnd() < MUTATION * 3) x = 1 - x;
        g[k].push(x);
      }
    }
  }
  return makeDog({ g, sex: rnd() < 0.5 ? 'M' : 'F', born: state.gen, sire: sire.id, dam: dam.id, F: coi(sire.id, dam.id) });
}

// Wright's coefficient of relationship via recursive kinship. Ids grow over time,
// so the larger id is never an ancestor of the smaller one.
function kinship(a, b, memo) {
  if (a == null || b == null) return 0;
  const key = a < b ? a + '|' + b : b + '|' + a;
  if (memo.has(key)) return memo.get(key);
  let r;
  if (a === b) r = 0.5 * (1 + (state.dogs[a]?.F || 0));
  else {
    const [young, old] = a > b ? [a, b] : [b, a];
    const y = state.dogs[young];
    r = !y || y.sire == null ? 0 : 0.5 * (kinship(y.sire, old, memo) + kinship(y.dam, old, memo));
  }
  memo.set(key, r);
  return r;
}
const coi = (s, d) => kinship(s, d, new Map());

const homo = (g, k, x) => g[k][0] === x && g[k][1] === x;
const has = (g, k, x) => g[k].includes(x);

function pheno(d) {
  const g = d.g;
  const red = homo(g, 'E', 'e'), liver = homo(g, 'B', 'b'), dil = homo(g, 'D', 'd');
  const color = red ? (dil ? 'cream' : 'red') : liver ? (dil ? 'lilac' : 'liver') : (dil ? 'blue' : 'black');
  const pattern = homo(g, 'S', 's') ? 'piebald' : has(g, 'S', 's') ? 'flash' : 'solid';
  const coat = homo(g, 'L', 'l') ? 'long' : 'short';
  const ears = has(g, 'F', 'F') ? 'floppy' : 'erect';
  const tail = has(g, 'C', 'C') ? 'curly' : 'straight';
  const szN = sum(g.sz), snN = sum(g.sn);
  const size = szN <= 1 ? 'toy' : szN <= 3 ? 'small' : szN === 4 ? 'medium' : szN <= 6 ? 'large' : 'giant';
  const snout = snN <= 1 ? 'flat' : snN <= 4 ? 'normal' : 'long';
  const hips = homo(g, 'H', 'h'), blind = homo(g, 'Y', 'y');
  const base = k => sum(g[k]) / 6 * 80 + 10 + d.noise[k];
  const speed = base('spd') - (snout === 'flat' ? 20 : 0) + (snout === 'long' ? 5 : 0)
    - (size === 'giant' ? 12 : 0) - (size === 'toy' ? 6 : 0) - (hips ? 18 : 0);
  const strength = base('str') + (szN - 4) * 5 - (hips ? 10 : 0);
  const brains = base('brn');
  const temper = base('tmp') - (blind ? 8 : 0);
  const health = 100 - (hips ? 35 : 0) - (blind ? 30 : 0) - d.F * 130
    - (snout === 'flat' ? 18 : 0) - (size === 'giant' ? 8 : 0) - (size === 'toy' ? 5 : 0) + d.noise.hl;
  const st = { speed, strength, brains, temper, health };
  for (const k in st) st[k] = clamp(Math.round(st[k]), 1, 100);
  return { color, pattern, coat, ears, tail, size, snout, hips, blind, szN, snN, ...st };
}
function value(d) {
  const p = pheno(d);
  return Math.round(12 + (p.speed + p.strength + p.brains + p.temper) / 10 + p.health / 4);
}
const pupPrice = d => Math.round(value(d) * 0.35);
const adultPrice = d => Math.round(value(d) * 0.7);
const buyPrice = d => Math.round(value(d) * 2.6 + 30);
const age = d => state.gen - d.born;
const isCarrier = (d, k) => has(d.g, k, MENDEL[k][1]);

// ---------- contracts ----------
const CLIENTS = [
  ['🧑‍🌾', 'A sheep farmer'], ['👵', 'A retired teacher'], ['🚒', 'The fire station'], ['🏂', 'A ski lodge'],
  ['🎩', 'A show judge'], ['👮', 'The K9 unit'], ['🏡', 'A young family'], ['🦮', 'A guide-dog charity'],
  ['🏃', 'A trail runner'], ['🎨', 'A fussy artist'], ['🛥️', 'A yacht captain'], ['🧙', 'An eccentric wizard'],
];
const REQS = {
  color: { gen: () => pick(['black', 'black', 'liver', 'red', 'red', 'blue', 'cream', 'lilac']), label: v => `${cap(v)} coat`, test: (p, v) => p.color === v },
  coat: { gen: () => pick(['long', 'short']), label: v => `${cap(v)} hair`, test: (p, v) => p.coat === v },
  ears: { gen: () => pick(['floppy', 'erect']), label: v => `${cap(v)} ears`, test: (p, v) => p.ears === v },
  tail: { gen: () => pick(['curly', 'straight']), label: v => `${cap(v)} tail`, test: (p, v) => p.tail === v },
  pattern: { gen: () => pick(['solid', 'flash', 'piebald']), label: v => v === 'flash' ? 'White flash' : cap(v), test: (p, v) => p.pattern === v },
  size: { gen: () => pick(['toy', 'small', 'medium', 'large', 'giant']), label: v => `${cap(v)} size`, test: (p, v) => p.size === v },
  snout: { gen: () => pick(['long', 'flat']), label: v => v === 'flat' ? 'Flat face' : 'Long snout', test: (p, v) => p.snout === v },
  clear: { gen: () => true, label: () => '🧬 DNA-tested clear', test: (p, v, d) => d.tested && !isCarrier(d, 'H') && !isCarrier(d, 'Y') },
};
function makeContract() {
  const g = state.gen;
  const n = clamp(2 + Math.floor(g / 5) + (rnd() < 0.35 ? 1 : 0), 2, 5);
  const reqs = [];
  const cats = Object.keys(REQS).filter(c => c !== 'clear' || g >= 4);
  const usedStats = new Set();
  while (reqs.length < n) {
    if (rnd() < 0.4) {
      const k = pick(STAT_KEYS);
      if (usedStats.has(k)) continue;
      usedStats.add(k);
      const t = Math.min(50 + g * 2 + randi(0, 8), k === 'health' ? 92 : 85);
      reqs.push({ type: 'stat', k, v: Math.round(t / 5) * 5 });
    } else {
      const c = pick(cats);
      if (reqs.some(r => r.type === c)) continue;
      reqs.push({ type: c, v: REQS[c].gen() });
    }
  }
  const [emoji, who] = pick(CLIENTS);
  return {
    id: state.nextContract++, emoji, who, reqs,
    reward: 40 + n * 45 + randi(0, 40), rep: n * 4 + (reqs.some(r => r.type === 'stat') ? 2 : 0),
    expires: g + randi(4, 7),
  };
}
function reqLabel(r) { return r.type === 'stat' ? `${STAT_LABEL[r.k]} ≥ ${r.v}` : REQS[r.type].label(r.v); }
function reqOk(r, d, p = pheno(d)) { return r.type === 'stat' ? p[r.k] >= r.v : REQS[r.type].test(p, r.v, d); }
function fits(c, d) { const p = pheno(d); return c.reqs.every(r => reqOk(r, d, p)); }
function fitsAny(d) { return state.contracts.some(c => fits(c, d)); }

// ---------- market & seasons ----------
function refreshMarket(all) {
  const keep = all ? [] : state.market.filter(() => rnd() < 0.4);
  while (keep.length < 4) keep.push(founder(rnd() < 0.5 ? 'M' : 'F', state.gen - randi(1, 4)));
  state.market = keep;
}
function endSeason() {
  const cost = state.kennel.length * UPKEEP;
  state.coins -= cost;
  state.gen++;
  addLog(`Season ${state.gen} begins. Upkeep: −${cost}🪙.`);
  for (const id of [...state.kennel]) {
    const d = state.dogs[id];
    if (age(d) >= MAX_AGE) {
      state.kennel = state.kennel.filter(x => x !== id);
      addLog(`${d.name} retired to a comfy sofa after ${age(d)} seasons.`);
    }
  }
  const before = state.contracts.length;
  state.contracts = state.contracts.filter(c => c.expires >= state.gen);
  const lost = before - state.contracts.length;
  if (lost) { state.rep = Math.max(0, state.rep - 2 * lost); addLog(`${lost} contract${lost > 1 ? 's' : ''} expired (−${2 * lost}⭐).`); }
  while (state.contracts.length < 3) state.contracts.push(makeContract());
  refreshMarket(false);
  if (state.coins < -150 || (state.kennel.length < 2 && state.coins < Math.min(...state.market.map(buyPrice)))) {
    state.over = true;
    addLog('The bank has closed your kennel.');
  }
  save();
}

// ---------- dog drawing ----------
let uid = 0;
function dogSVG(d, opts = {}) {
  const p = pheno(d), g = d.g, r = mulberry(d.seed);
  const id = 'd' + (uid++);
  const k = 0.58 + p.szN * 0.055;
  const col = COLORS[p.color];
  const pie = p.pattern === 'piebald', flash = p.pattern === 'flash', long = p.coat === 'long';
  const body = pie ? WHITE : col, darkBody = shade(body, -0.18), darkCol = shade(col, -0.18);
  const nose = homo(g, 'B', 'b') ? '#5a2e1a' : homo(g, 'D', 'd') ? '#4e5660' : '#1d1816';
  const Ls = 3 + p.snN * 2.4;
  const pup = age(d) < 1 && !opts.adult;
  const legLen = pup ? 32 : 38;
  const ol = 'stroke="#00000026" stroke-width="1"';
  let s = '';

  // tail
  const tailCol = pie && r() < 0.5 ? WHITE : col;
  const tw = long ? 10 : 5.5;
  const tailPath = p.tail === 'curly'
    ? 'M32 50 C 16 44, 18 22, 34 26 C 44 29, 42 40, 34 40'
    : 'M32 52 Q 16 46 11 30';
  s += `<path d="${tailPath}" fill="none" stroke="#00000030" stroke-width="${tw + 2}" stroke-linecap="round"/>`;
  s += `<path d="${tailPath}" fill="none" stroke="${tailCol}" stroke-width="${tw}" stroke-linecap="round"/>`;
  if (long) s += `<path d="${tailPath}" fill="none" stroke="${shade(tailCol, 0.12)}" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 4"/>`;

  // far legs
  const legs = (xs, fill) => xs.map(x => `<rect x="${x}" y="${100 - legLen}" width="7.5" height="${legLen}" rx="3.7" fill="${fill}" ${ol}/>` +
    (flash || pie ? `<rect x="${x}" y="94" width="7.5" height="6" rx="3" fill="${WHITE}"/>` : '')).join('');
  s += legs([44, 82], pie ? shade(WHITE, -0.08) : darkCol);

  // body
  s += `<clipPath id="${id}b"><ellipse cx="62" cy="58" rx="32" ry="15"/></clipPath>`;
  s += `<ellipse cx="62" cy="58" rx="32" ry="15" fill="${body}" ${ol}/>`;
  if (pie) {
    let patches = '';
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) patches += `<circle cx="${34 + r() * 52}" cy="${44 + r() * 16}" r="${7 + r() * 10}" fill="${col}"/>`;
    s += `<g clip-path="url(#${id}b)">${patches}</g>`;
  }
  // long coat feathering under the belly
  if (long) {
    s += `<path d="M34 62 Q38 78 43 71 Q47 80 52 72 Q56 80 61 72 Q65 80 70 72 Q74 80 79 71 Q84 77 88 62 Z" fill="${body}"/>`;
  }
  // near legs
  s += legs([36, 74], pie ? WHITE : col);
  if (long) s += [36, 74].map(x => `<path d="M${x} 70 Q${x - 5} 82 ${x - 1} 92 L${x + 2} 76Z" fill="${pie ? WHITE : col}"/>`).join('');

  // neck + head
  s += `<polygon points="80,50 88,32 104,38 96,64" fill="${pie ? col : col}"/>`;
  if (flash || pie) s += `<ellipse cx="93" cy="58" rx="5.5" ry="9" fill="${WHITE}"/>`;
  if (long) s += `<path d="M86 50 Q100 56 95 74 Q90 66 82 68 Z" fill="${flash || pie ? WHITE : col}"/>`;

  // ears behind the head when erect
  const earCol = darkCol;
  if (p.ears === 'erect') s += `<path d="M87 33 L90 ${pup ? 18 : 13} L99 29 Z" fill="${earCol}" ${ol}/>`;
  s += `<circle cx="98" cy="40" r="12" fill="${col}" ${ol}/>`;
  // snout
  const muz = pie || flash ? WHITE : shade(col, 0.06);
  s += `<rect x="101" y="${p.snout === 'flat' ? 39 : 40}" width="${Ls + 5}" height="10.5" rx="5" fill="${muz}" ${ol}/>`;
  if (pie) s += `<path d="M98 28 L101 28 L103 40 L96 40 Z" fill="${WHITE}"/>`;
  s += `<circle cx="${103 + Ls}" cy="42" r="2.7" fill="${nose}"/>`;
  s += `<path d="M${103 + Ls - 3} 47.5 q-3 1.5 -6 0" fill="none" stroke="#0005" stroke-width="1"/>`;
  // eye
  const eye = p.blind ? '#b9d0da' : '#1d1816';
  s += `<circle cx="101" cy="36" r="2" fill="${eye}"/>`;
  if (!p.blind) s += `<circle cx="101.7" cy="35.3" r=".6" fill="#fff"/>`;
  // floppy ears in front
  if (p.ears === 'floppy') {
    const drop = long ? 58 : 51;
    s += `<path d="M88 31 Q83 33 84 ${drop - 4} Q87 ${drop + 2} 92 ${drop - 6} Q95 36 93 30 Z" fill="${earCol}" ${ol}/>`;
  }
  const shadow = `<ellipse cx="64" cy="101" rx="${40 * k}" ry="3.5" fill="#00000018"/>`;
  return `<svg viewBox="0 8 140 98" xmlns="http://www.w3.org/2000/svg">${shadow}<g transform="translate(64 101) scale(${k}) translate(-64 -101)">${s}</g></svg>`;
}

// ---------- UI ----------
let tab = 'kennel';
const modal = $('#modal'), sheet = $('#sheet');
function openSheet(html) { sheet.innerHTML = html; modal.classList.remove('hidden'); sheet.scrollTop = 0; }
function closeSheet() { modal.classList.add('hidden'); sheet.innerHTML = ''; }
modal.addEventListener('click', e => { if (e.target === modal && !state.litter) closeSheet(); });

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
}

function miniBars(p) {
  return `<div class="mini">${STAT_KEYS.map(k => `<div><i style="width:${p[k]}%;background:${STAT_COL[k]}"></i></div>`).join('')}</div>
  <div class="minilab">${STAT_KEYS.map(k => `<span>${p[k]}</span>`).join('')}</div>`;
}
function card(d, { cls = '', act = 'dog', badge = true } = {}) {
  const p = pheno(d);
  const star = badge && fitsAny(d) ? '<span class="badge">★ fits</span>' : '';
  const old = age(d) >= MAX_AGE - 1 ? '<span class="badge left">old</span>' : '';
  return `<button class="card ${cls}" data-act="${act}" data-id="${d.id}">${star}${old}${dogSVG(d)}
    <div class="nm"><span>${esc(d.name)}</span><span class="sex ${d.sex}">${d.sex === 'M' ? '♂' : '♀'}</span></div>
    <div class="meta">${age(d) < 1 ? 'pup' : 'age ' + age(d)} · ${p.size}${d.tested ? ' · 🧬' : ''}</div>
    ${miniBars(p)}</button>`;
}

function render() {
  $('#gen').textContent = state.gen;
  $('#coins').textContent = state.coins;
  $('#rep').textContent = state.rep;
  $('#coins').style.color = state.coins < 0 ? 'var(--bad)' : '';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#breedBtn').classList.toggle('hidden', tab !== 'kennel' || state.over);
  const v = $('#view');
  if (state.over) {
    v.innerHTML = `<div class="empty"><div style="font-size:60px">🏚️</div><h1>Kennel closed</h1>
      <p>You lasted ${state.gen} seasons and earned <b>${state.rep}⭐</b> reputation.<br>Best: ${state.best}⭐</p>
      <button class="btn primary" data-act="new">Start a new kennel</button></div>`;
    return;
  }
  if (tab === 'kennel') {
    const ds = state.kennel.map(id => state.dogs[id]);
    v.innerHTML = `<h2>Kennel ${ds.length}/${KENNEL_CAP} <span class="sub" style="text-transform:none;letter-spacing:0">· upkeep ${ds.length * UPKEEP}🪙/season</span></h2>
      <div class="legend">${STAT_KEYS.map(k => `<span><i style="background:${STAT_COL[k]}"></i>${STAT_LABEL[k]}</span>`).join('')}</div>
      ${ds.length ? `<div class="grid">${ds.map(d => card(d)).join('')}</div>` : '<div class="empty">Your kennel is empty. Buy dogs from the market.</div>'}
      <div class="row"><button class="btn" data-act="help">❓ How to play</button><button class="btn" data-act="newask">↺ New game</button></div>`;
  } else if (tab === 'contracts') {
    v.innerHTML = `<h2>Open contracts</h2>` + state.contracts.map(c => {
      const matches = state.kennel.map(id => state.dogs[id]).filter(d => fits(c, d));
      const left = c.expires - state.gen;
      return `<div class="contract"><div class="top"><span>${c.emoji} ${c.reward}🪙 · +${c.rep}⭐</span>
        <span class="sub">${left <= 0 ? 'last season!' : left + ' seasons left'}</span></div>
        <div class="who">${c.who} wants a dog with:</div>
        <div class="chips">${c.reqs.map(r => `<span class="chip req">${reqLabel(r)}</span>`).join('')}</div>
        ${matches.length ? `<div class="sub">Tap a dog to deliver it:</div><div class="matches">${matches.map(d => card(d, { act: 'deliver', badge: false }).replace('data-id', `data-c="${c.id}" data-id`)).join('')}</div>` : ''}
      </div>`;
    }).join('');
  } else if (tab === 'market') {
    v.innerHTML = `<h2>Outside bloodlines</h2><p class="sub">Unrelated dogs bring fresh genes and break up inbreeding. Stock changes every season.</p>
      <div class="grid">${state.market.map((d, i) => card(d, { act: 'mkt' }).replace('data-id', `data-i="${i}" data-id`)
        .replace('</button>', `<div class="row" style="margin-top:6px"><span class="btn primary" style="padding:6px;text-align:center">Buy ${buyPrice(d)}🪙</span></div></button>`)).join('')}</div>`;
  } else {
    v.innerHTML = `<h2>Kennel log</h2><div class="log">${state.log.map(l => `<p><b>S${l.gen}</b> ${l.msg}</p>`).join('')}</div>`;
  }
}

function genoView(d) {
  if (!d.tested) return `<div class="geno" style="display:block;text-align:center;color:var(--muted)">Genotype unknown — carriers look perfectly healthy.</div>`;
  const rows = Object.keys(MENDEL).map(k => {
    const gt = [...d.g[k]].sort().join(''); // capital letters sort first
    const bad = (k === 'H' || k === 'Y') && isCarrier(d, k);
    return `<span class="${bad ? 'c' : ''}">${k}: ${gt}</span>`;
  });
  const q = Object.entries(QUANT).map(([k, n]) => `<span>${k}: ${sum(d.g[k])}/${n * 2}</span>`);
  return `<div class="geno">${rows.join('')}${q.join('')}</div>`;
}

function dogSheet(d, ctx) {
  const p = pheno(d);
  const sire = state.dogs[d.sire], dam = state.dogs[d.dam];
  const inKennel = state.kennel.includes(d.id);
  const health = [];
  if (p.hips) health.push('<span class="chip bad">Hip dysplasia</span>');
  if (p.blind) health.push('<span class="chip bad">Blind (PRA)</span>');
  if (d.tested) {
    if (!p.hips && isCarrier(d, 'H')) health.push('<span class="chip bad">Hip carrier</span>');
    if (!p.blind && isCarrier(d, 'Y')) health.push('<span class="chip bad">PRA carrier</span>');
    if (!isCarrier(d, 'H') && !isCarrier(d, 'Y')) health.push('<span class="chip good">DNA clear</span>');
  }
  if (p.snout === 'flat') health.push('<span class="chip bad">Breathing issues</span>');
  let actions = '';
  if (ctx === 'kennel' && inKennel) {
    const fitC = state.contracts.filter(c => fits(c, d));
    actions = `<div class="row">
      ${d.tested ? '' : `<button class="btn" data-act="test" data-id="${d.id}" ${state.coins < DNA_COST ? 'disabled' : ''}>🧬 DNA test ${DNA_COST}🪙</button>`}
      <button class="btn" data-act="sell" data-id="${d.id}">Sell ${adultPrice(d)}🪙</button></div>
      ${fitC.map(c => `<div class="row"><button class="btn green" data-act="deliver" data-c="${c.id}" data-id="${d.id}">${c.emoji} Deliver to ${c.who.toLowerCase()} · ${c.reward}🪙</button></div>`).join('')}`;
  }
  return `<div class="sheethead"><div><h1>${esc(d.name)} <span class="sex ${d.sex}">${d.sex === 'M' ? '♂' : '♀'}</span></h1>
      <div class="sub">${age(d) < 1 ? 'Newborn pup' : `Age ${age(d)} (retires at ${MAX_AGE})`} · ${sire ? `${esc(sire.name)} × ${esc(dam.name)}` : 'Founder bloodline'}</div></div>
      <button class="x" data-act="close">✕</button></div>
    <div class="big">${dogSVG(d)}</div>
    <div class="chips">${['color', 'pattern', 'coat', 'ears', 'tail', 'size', 'snout'].map(k =>
      `<span class="chip">${k === 'pattern' && p[k] === 'flash' ? 'white flash' : p[k]} ${k === 'color' || k === 'pattern' ? '' : k}</span>`).join('')}</div>
    <div class="chips">${health.join('')}<span class="chip ${d.F > 0.1 ? 'bad' : ''}">Inbreeding ${(d.F * 100).toFixed(1)}%</span></div>
    <div class="bars">${STAT_KEYS.map(k => `<div class="bar"><span>${STAT_LABEL[k]}</span><div class="t"><i style="width:${p[k]}%;background:${STAT_COL[k]}"></i></div><b>${p[k]}</b></div>`).join('')}</div>
    ${state.contracts.length ? `<h2>Contracts</h2>${state.contracts.map(c => `<div class="chips"><span class="chip">${c.emoji}</span>${c.reqs.map(r =>
      `<span class="chip ${reqOk(r, d, p) ? 'good' : 'bad'}">${reqOk(r, d, p) ? '✓' : '✗'} ${reqLabel(r)}</span>`).join('')}</div>`).join('')}` : ''}
    <h2>Genotype</h2>${genoView(d)}${actions}`;
}

// ---------- breeding flow ----------
let pairSel = { M: null, F: null };
function pairSheet() {
  const adults = state.kennel.map(id => state.dogs[id]).filter(d => age(d) >= 1);
  const col = sex => adults.filter(d => d.sex === sex).map(d => card(d, { act: 'pair', badge: false, cls: pairSel[sex] === d.id ? 'sel' : '' })).join('')
    || `<div class="sub">No adult ${sex === 'M' ? 'males' : 'females'}.</div>`;
  let info = '<div class="coi">Pick a sire (♂) and a dam (♀). Pups must be one season old to breed.</div>';
  const s = state.dogs[pairSel.M], m = state.dogs[pairSel.F];
  if (s && m) {
    const F = coi(s.id, m.id);
    const warn = F >= 0.0625;
    info = `<div class="coi ${warn ? 'warn' : ''}">Pup inbreeding: <b>${(F * 100).toFixed(1)}%</b> ${F === 0 ? '— unrelated, nice.' : warn ? `— expect about −${Math.round(F * 130)} health and smaller litters.` : '— mild.'}</div>`;
  }
  return `<div class="sheethead"><div><h1>Plan a litter</h1><div class="sub">Season ${state.gen}</div></div><button class="x" data-act="close">✕</button></div>
    ${info}
    <div class="row"><button class="btn primary" data-act="mate" ${s && m ? '' : 'disabled'}>Breed them!</button>
    <button class="btn" data-act="skip">Rest this season</button></div>
    <div class="pair" style="margin-top:12px"><div class="col"><h2>Sires ♂</h2>${col('M')}</div><div class="col"><h2>Dams ♀</h2>${col('F')}</div></div>`;
}
function mate() {
  const s = state.dogs[pairSel.M], m = state.dogs[pairSel.F];
  const F = coi(s.id, m.id);
  const n = clamp(randi(3, 6) + (pheno(m).health > 75 ? 1 : 0) - Math.round(F * 10), 1, 8);
  const pups = Array.from({ length: n }, () => breed(s, m));
  pups.forEach((p, i) => { p.tmp = i; });
  state.litter = { pups, keep: [], sire: s.id, dam: m.id };
  addLog(`${s.name} × ${m.name}: a litter of ${n}.`);
  save();
  litterSheet(true);
}
function litterSheet(animate) {
  const L = state.litter, s = state.dogs[L.sire], m = state.dogs[L.dam];
  const space = KENNEL_CAP - state.kennel.length;
  const sold = L.pups.filter(p => !L.keep.includes(p.tmp)).reduce((a, p) => a + pupPrice(p), 0);
  const cards = L.pups.map((p, i) => card(p, { act: 'pup', cls: (L.keep.includes(p.tmp) ? 'keep ' : '') + (animate ? 'pop' : '') })
    .replace('data-id="null"', `data-t="${p.tmp}"`).replace('class="card', `style="animation-delay:${i * 90}ms" class="card`)
    .replace(/<\/button>$/, `<span class="info" data-act="pupinfo" data-t="${p.tmp}">ⓘ</span></button>`)).join('');
  openSheet(`<div class="sheethead"><div><h1>${L.pups.length} pups! 🎉</h1><div class="sub">${esc(s.name)} × ${esc(m.name)} · tap to keep, hold or ⓘ for details</div></div></div>
    <div class="grid" style="margin-top:10px">${cards}</div>
    <div class="coi">Keeping <b>${L.keep.length}</b> of ${space} free spots. The rest go to good homes for <b>${sold}🪙</b>.</div>
    <div class="row"><button class="btn primary" data-act="litterdone">Done — next season</button></div>`);
}
function finishLitter() {
  const L = state.litter;
  let earned = 0;
  for (const p of L.pups) {
    if (L.keep.includes(p.tmp)) { delete p.tmp; register(p); state.kennel.push(p.id); addLog(`Kept ${p.name} (${pheno(p).color} ${p.sex === 'M' ? 'male' : 'female'}).`); }
    else earned += pupPrice(p);
  }
  state.coins += earned;
  if (earned) addLog(`Rehomed ${L.pups.length - L.keep.length} pups for ${earned}🪙.`);
  state.litter = null;
  pairSel = { M: null, F: null };
  closeSheet();
  endSeason();
  render();
  toast(`Season ${state.gen}${state.over ? ' — game over' : ''}`);
}

function helpSheet() {
  openSheet(`<div class="sheethead"><h1>How to play</h1><button class="x" data-act="close">✕</button></div><div class="help">
  <p>Each season you breed <b>one litter</b>, keep the pups you like, and rehome the rest for coins. Fill <b>contracts</b> to earn coins and ⭐ reputation. Get the most reputation you can before the bank closes you down.</p>
  <ul>
    <li><b>Genes come in pairs.</b> Each parent passes on one copy at random. Recessive traits (red, liver, dilute, long hair, piebald, straight tail, erect ears) only show when a pup inherits <i>two</i> copies, so they can skip generations.</li>
    <li><b>Colours:</b> e/e makes red, b/b makes liver, and d/d dilutes black→blue, liver→lilac and red→cream.</li>
    <li><b>Size, snout and stats</b> come from many small genes, so pups land close to the parents' average, with some spread. Selecting the best of every litter moves the line over time.</li>
    <li><b>Hidden diseases:</b> hip dysplasia and PRA blindness are recessive. Healthy-looking dogs can be carriers. A 🧬 DNA test (${DNA_COST}🪙) shows the full genotype.</li>
    <li><b>Inbreeding</b> (mating relatives) fixes traits fast, but costs health and shrinks litters. Buy outside dogs from the market to bring in fresh blood.</li>
    <li><b>Trade-offs:</b> flat faces hurt breathing and speed. Giants are strong but slow. Toys are fragile.</li>
    <li>Upkeep is ${UPKEEP}🪙 per dog every season, and dogs retire at age ${MAX_AGE}. If your debt goes past −150🪙, the game ends.</li>
  </ul></div><div class="row"><button class="btn primary" data-act="close">Let's breed</button></div>`);
}

// ---------- events ----------
document.addEventListener('click', e => {
  const tb = e.target.closest('#tabs button');
  if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = +el.dataset.id, d = state.dogs[id];
  switch (el.dataset.act) {
    case 'close': if (state.litter) litterSheet(false); else closeSheet(); break;
    case 'help': helpSheet(); break;
    case 'new': newGame(); closeSheet(); render(); break;
    case 'newask':
      openSheet(`<div class="sheethead"><h1>Start over?</h1><button class="x" data-act="close">✕</button></div><p>Your current kennel will be lost.</p>
        <div class="row"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="new">New kennel</button></div>`);
      break;
    case 'dog': openSheet(dogSheet(d, 'kennel')); break;
    case 'test':
      if (state.coins < DNA_COST) break;
      state.coins -= DNA_COST; d.tested = true;
      addLog(`DNA tested ${d.name}${isCarrier(d, 'H') || isCarrier(d, 'Y') ? ': carries a disease gene.' : ': all clear.'}`);
      save(); render(); openSheet(dogSheet(d, 'kennel'));
      break;
    case 'sell':
      state.coins += adultPrice(d);
      state.kennel = state.kennel.filter(x => x !== id);
      addLog(`Sold ${d.name} for ${adultPrice(d)}🪙.`);
      save(); closeSheet(); render(); toast(`Sold ${d.name}`);
      break;
    case 'deliver': {
      const c = state.contracts.find(c => c.id === +el.dataset.c);
      if (!c || !fits(c, d)) break;
      state.coins += c.reward; state.rep += c.rep;
      state.kennel = state.kennel.filter(x => x !== id);
      state.contracts = state.contracts.filter(x => x !== c);
      state.contracts.push(makeContract());
      addLog(`${c.emoji} Delivered ${d.name} to ${c.who.toLowerCase()}: +${c.reward}🪙 +${c.rep}⭐`);
      save(); closeSheet(); render(); toast(`+${c.reward}🪙  +${c.rep}⭐`);
      break;
    }
    case 'mkt': {
      const m = state.market[+el.dataset.i];
      if (!e.target.closest('.btn')) { openSheet(dogSheet(m, 'market')); break; }
      if (state.kennel.length >= KENNEL_CAP) { toast('Kennel is full'); break; }
      const price = buyPrice(m);
      if (state.coins < price) { toast('Not enough coins'); break; }
      state.coins -= price;
      state.market.splice(+el.dataset.i, 1);
      register(m); state.kennel.push(m.id);
      addLog(`Bought ${m.name} for ${price}🪙.`);
      save(); render(); toast(`${m.name} joined the kennel`);
      break;
    }
    case 'pair': pairSel[d.sex] = pairSel[d.sex] === id ? null : id; openSheet(pairSheet()); break;
    case 'mate': mate(); break;
    case 'skip': pairSel = { M: null, F: null }; closeSheet(); endSeason(); render(); toast(`Season ${state.gen}`); break;
    case 'pup': {
      const L = state.litter, t = +el.dataset.t, i = L.keep.indexOf(t);
      if (i >= 0) L.keep.splice(i, 1);
      else if (state.kennel.length + L.keep.length < KENNEL_CAP) L.keep.push(t);
      else toast('No room. Sell or deliver a dog first.');
      litterSheet(false);
      break;
    }
    case 'pupinfo': {
      const p = state.litter.pups[+el.dataset.t];
      openSheet(dogSheet(p, 'litter') + `<div class="row"><button class="btn primary" data-act="back">← Back to litter</button></div>`);
      break;
    }
    case 'back': litterSheet(false); break;
    case 'litterdone': finishLitter(); break;
  }
});
$('#breedBtn').addEventListener('click', () => { pairSel = { M: null, F: null }; openSheet(pairSheet()); });

// long-press a pup to inspect it; the ⓘ button does the same for tap-only users
let pressT;
document.addEventListener('pointerdown', e => {
  const c = e.target.closest('[data-act="pup"]');
  if (!c) return;
  pressT = setTimeout(() => { pressT = 'fired'; openSheet(dogSheet(state.litter.pups[+c.dataset.t], 'litter') + `<div class="row"><button class="btn primary" data-act="back">← Back to litter</button></div>`); }, 450);
});
document.addEventListener('pointerup', () => { if (pressT !== 'fired') clearTimeout(pressT); });
document.addEventListener('click', e => { if (pressT === 'fired') { pressT = null; e.stopImmediatePropagation(); } }, true);

// ---------- boot ----------
if (!load()) { newGame(); render(); helpSheet(); }
else { render(); if (state.litter) litterSheet(false); }
