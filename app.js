import { FAMILIES, FINISHES } from './colors.js';
import {
  linearToHex, linearToLab, robustMeanLinear, gainsFromWhite, applyGains,
} from './color.js';
import { CATALOG, byCode, rank, confidence, closeCall, learn } from './matcher.js';
import { STRINGS } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('kcd.' + k); return v ? JSON.parse(v) : d; } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('kcd.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- state ----------
let lang = store.get('lang', 'he');
let cal = store.get('cal', null);          // { gains, at, lock }
let learned = store.get('learned', {});    // code -> { lab, n }
let history = store.get('history', []);    // [{ t, code, dE, hex, conf }]
let view = 'scan';
let mode = 'live';                         // 'live' | 'still'
let hold = false;
let stream = null;
let torchOn = false;
let smooth = null;                         // smoothed raw linear RGB
let reading = null;
let calibrating = null;                    // array of raw samples while calibrating
const still = { x: 0, y: 0, ready: false };

const CAL_STALE_MS = 2 * 60 * 60 * 1000;
const SAMPLE = 48;
const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = sampleCanvas.height = SAMPLE;
const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });

const video = $('#video');
const stillCanvas = $('#still');
const viewport = $('#viewport');
const reticle = $('#reticle');

// ---------- i18n ----------
function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
const colorName = (c) => (lang === 'he' ? c.he : c.en);
const colorAlt = (c) => (lang === 'he' ? c.en : c.he);
const finishText = (c) => `${FINISHES[c.finish].label} · ${FINISHES[c.finish][lang]}`;
const timeText = (ms) => new Date(ms).toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
const dateTimeText = (ms) => new Date(ms).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.title = t('appTitle');
  $$('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  $$('[data-t-ph]').forEach((el) => { el.placeholder = t(el.dataset.tPh); });
  $('#lang').textContent = lang === 'he' ? 'EN' : 'עב';
  $('#hold').textContent = t(hold ? 'resume' : 'hold');
  renderCal();
  renderReading();
  renderCatalog();
  renderHistory();
  renderSettings();
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...children.filter((c) => c != null));
  return n;
}

function colorRow(c, right) {
  return [
    el('div', { class: 'swatch', style: `background:${c.hex}` }),
    el('div', { class: 'row-text' },
      el('b', {}, c.code),
      el('span', {}, `${colorName(c)} · ${FINISHES[c.finish].label}`)),
    learned[c.code] ? el('span', { class: 'badge' }, t('learned')) : null,
    right ?? null,
  ];
}

// ---------- camera ----------
async function startCamera() {
  const overlay = $('#cam-overlay');
  if (!navigator.mediaDevices?.getUserMedia) {
    $('#cam-msg').textContent = t(window.isSecureContext ? 'camError' : 'camInsecure');
    overlay.hidden = false;
    return;
  }
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    const key = err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'camDenied'
      : err.name === 'NotFoundError' || err.name === 'OverconstrainedError' ? 'camMissing' : 'camError';
    $('#cam-msg').textContent = t(key);
    overlay.hidden = false;
    return;
  }
  overlay.hidden = true;
  video.srcObject = stream;
  try { await video.play(); } catch { /* autoplay will retry on interaction */ }
  const caps = track()?.getCapabilities?.() ?? {};
  $('#torch').hidden = !caps.torch;
  torchOn = false;
  $('#torch').classList.remove('on');
  if (cal?.lock) await applyAdvanced(cal.lock);
  smooth = null;
  layoutReticle();
}

function stopCamera() {
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
}

const track = () => stream?.getVideoTracks()[0];

async function applyAdvanced(settings) {
  const clean = Object.fromEntries(Object.entries(settings).filter(([, v]) => v != null));
  try { await track().applyConstraints({ advanced: [clean] }); return true; } catch { return false; }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Let auto exposure / white balance settle on the white card, then freeze
// them where the device allows it (Chrome on Android; not iOS Safari).
async function lockCamera() {
  const tr = track();
  const caps = tr?.getCapabilities?.();
  if (!caps) return null;
  const auto = {}, manual = {};
  if (caps.whiteBalanceMode?.includes('manual')) {
    manual.whiteBalanceMode = 'manual';
    if (caps.whiteBalanceMode.includes('continuous')) auto.whiteBalanceMode = 'continuous';
  }
  if (caps.exposureMode?.includes('manual')) {
    manual.exposureMode = 'manual';
    if (caps.exposureMode.includes('continuous')) auto.exposureMode = 'continuous';
  }
  if (!Object.keys(manual).length) return null;
  if (Object.keys(auto).length) { await applyAdvanced(auto); await wait(1200); }
  if (!(await applyAdvanced(manual))) return null;
  await wait(400);
  const s = tr.getSettings();
  return { ...manual, exposureTime: s.exposureTime, colorTemperature: s.colorTemperature, iso: s.iso };
}

async function toggleTorch() {
  torchOn = !torchOn;
  if (!(await applyAdvanced({ torch: torchOn }))) torchOn = !torchOn;
  $('#torch').classList.toggle('on', torchOn);
  if (cal) toast(t('torchChanged'));
}

// ---------- still photo ----------
async function loadPhoto(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  } catch {
    toast(t('camError'));
    return;
  } finally {
    URL.revokeObjectURL(url);
  }
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  stillCanvas.width = Math.round(img.naturalWidth * k);
  stillCanvas.height = Math.round(img.naturalHeight * k);
  stillCanvas.getContext('2d').drawImage(img, 0, 0, stillCanvas.width, stillCanvas.height);
  still.x = stillCanvas.width / 2;
  still.y = stillCanvas.height / 2;
  still.ready = true;
  setMode('still');
}

function setMode(m) {
  mode = m;
  const isStill = m === 'still';
  stillCanvas.hidden = !isStill;
  video.hidden = isStill;
  $('#still-hint').hidden = !isStill;
  $('#live').hidden = !isStill;
  $('#photo').hidden = isStill;
  if (isStill) {
    stopCamera();
    $('#torch').hidden = true;
    $('#cam-overlay').hidden = true;
  } else {
    startCamera();
  }
  setHold(false);
  smooth = null;
  layoutReticle();
}

function stillGeom() {
  const r = viewport.getBoundingClientRect();
  const scale = Math.min(r.width / stillCanvas.width, r.height / stillCanvas.height);
  return {
    scale,
    ox: (r.width - stillCanvas.width * scale) / 2,
    oy: (r.height - stillCanvas.height * scale) / 2,
    left: r.left,
    top: r.top,
  };
}

// ---------- sampling ----------
const liveSize = () => Math.max(8, Math.round(Math.min(video.videoWidth, video.videoHeight) * 0.09));
const stillSize = () => Math.max(8, Math.round(Math.min(stillCanvas.width, stillCanvas.height) * 0.04));

function layoutReticle() {
  const r = viewport.getBoundingClientRect();
  let size = 36, x = r.width / 2, y = r.height / 2;
  if (mode === 'live') {
    if (video.videoWidth) size = liveSize() * Math.max(r.width / video.videoWidth, r.height / video.videoHeight);
  } else if (still.ready) {
    const g = stillGeom();
    size = stillSize() * g.scale;
    x = g.ox + still.x * g.scale;
    y = g.oy + still.y * g.scale;
  }
  size = Math.max(16, size);
  reticle.style.width = reticle.style.height = `${size}px`;
  reticle.style.left = `${x}px`;
  reticle.style.top = `${y}px`;
}

function grab() {
  let src, cx, cy, s, w, h;
  if (mode === 'live') {
    w = video.videoWidth; h = video.videoHeight;
    if (!w || video.readyState < 2) return null;
    src = video; s = liveSize(); cx = w / 2; cy = h / 2;
  } else {
    if (!still.ready) return null;
    w = stillCanvas.width; h = stillCanvas.height;
    src = stillCanvas; s = stillSize(); cx = still.x; cy = still.y;
  }
  const x = Math.min(Math.max(0, cx - s / 2), w - s);
  const y = Math.min(Math.max(0, cy - s / 2), h - s);
  sctx.drawImage(src, x, y, s, s, 0, 0, SAMPLE, SAMPLE);
  return sctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
}

function tick() {
  if (view !== 'scan' || document.hidden) return;
  if (hold && !calibrating) return;
  const data = grab();
  if (!data) return;
  const m = robustMeanLinear(data);
  if (calibrating) calibrating.push(m);

  // Exponential smoothing; snap immediately when the target changes.
  const jump = !smooth || mode === 'still' || m.lin.some((v, i) => Math.abs(v - smooth[i]) > 0.06);
  smooth = jump ? m.lin : smooth.map((v, i) => v * 0.7 + m.lin[i] * 0.3);

  const lin = applyGains(smooth, cal?.gains);
  const lab = linearToLab(lin);
  reading = { lin, lab, hex: linearToHex(lin), matches: rank(lab, learned), luma: m.luma, clipped: m.clipped };
  renderReading();
}

// ---------- rendering ----------
function renderCal() {
  const chip = $('#cal-chip');
  chip.classList.remove('need', 'ok');
  if (!cal) {
    chip.textContent = t('notCalibrated');
    chip.classList.add('need');
  } else if (Date.now() - cal.at > CAL_STALE_MS) {
    chip.textContent = t('calStale', { time: dateTimeText(cal.at) });
    chip.classList.add('need');
  } else {
    chip.textContent = t('calibratedAt', { time: timeText(cal.at) });
    chip.classList.add('ok');
  }
}

function renderReading() {
  const has = !!reading;
  $('#result').hidden = !has;
  $('#empty').hidden = has;
  $('#save').disabled = !has;
  if (!has) return;

  const { matches } = reading;
  const best = matches[0];
  const c = best.color;
  const conf = confidence(matches);

  const warn = $('#warn');
  const warnKey = reading.clipped > 0.2 ? 'warnGlare' : reading.luma < 0.004 ? 'warnDark' : null;
  warn.hidden = !warnKey;
  if (warnKey) warn.textContent = t(warnKey);

  $('#conf').className = `conf ${conf}`;
  $('#conf').textContent = t({ high: 'confHigh', mid: 'confMid', low: 'confLow' }[conf]);
  $('#best-swatch').style.background = c.hex;
  $('#measured-swatch').style.background = reading.hex;
  $('#measured-hex').textContent = reading.hex.toUpperCase();
  $('#best-code').textContent = c.code;
  $('#best-name').textContent = colorName(c);
  $('#best-sub').textContent = `${finishText(c)} · ${FAMILIES[c.family][lang]}`;
  $('#best-de').textContent = best.dE.toFixed(1);

  const note = $('#note');
  const close = closeCall(matches);
  const text = c.twins.length ? t('twinNote', { codes: c.twins.join(', ') })
    : close ? t('closeCall', { code: close }) : '';
  note.hidden = !text;
  note.textContent = text;

  $('#alts').replaceChildren(...matches.slice(1, 3).map((m) =>
    el('li', {}, ...colorRow(m.color, el('span', { class: 'row-de' }, `ΔE ${m.dE.toFixed(1)}`)))));
}

function renderCatalog() {
  const q = $('#search').value.trim().toLowerCase();
  const root = $('#catalog');
  root.replaceChildren();
  for (const [key, fam] of Object.entries(FAMILIES)) {
    const items = CATALOG.filter((c) => c.family === key
      && (!q || c.code.toLowerCase().includes(q) || c.he.includes(q) || c.en.toLowerCase().includes(q)));
    if (!items.length) continue;
    root.append(
      el('h2', { class: 'fam' }, `${fam[lang]} · ${items.length}`),
      el('ul', { class: 'rows' }, ...items.map((c) =>
        el('li', {}, el('button', { class: 'row', type: 'button', onclick: () => openColor(c) }, ...colorRow(c))))),
    );
  }
}

let detailCode = null;
function openColor(c) {
  detailCode = c.code;
  const l = learned[c.code];
  $('#detail').replaceChildren(el('div', { class: 'detail' },
    el('div', { class: 'detail-swatch', style: `background:${c.hex}` }),
    el('div', { class: 'detail-code' }, c.code),
    el('div', { class: 'name' }, colorName(c)),
    el('div', { class: 'sub' }, colorAlt(c)),
    el('dl', {},
      el('dt', {}, t('finish')), el('dd', {}, finishText(c)),
      el('dt', {}, t('family')), el('dd', {}, FAMILIES[c.family][lang]),
      el('dt', {}, t('webHex')), el('dd', {}, el('code', {}, c.hex.toUpperCase())),
      l ? el('dt', {}, t('learned')) : null,
      l ? el('dd', {}, t('samples', { n: l.n })) : null),
    c.twins.length ? el('p', { class: 'note' }, t('twinNote', { codes: c.twins.join(', ') })) : null,
  ));
  $('#forget').hidden = !l;
  $('#dlg-color').showModal();
}

function renderHistory() {
  $('#history-empty').hidden = history.length > 0;
  $('#export').disabled = $('#clear-history').disabled = history.length === 0;
  $('#history').replaceChildren(...history.map((h) => {
    const c = byCode[h.code];
    if (!c) return null;
    return el('li', {},
      el('div', { class: 'swatch', style: `background:linear-gradient(90deg, ${c.hex} 50%, ${h.hex} 50%)` }),
      el('div', { class: 'row-text' },
        el('b', {}, c.code),
        el('span', {}, `${colorName(c)} · ${dateTimeText(h.t)}`)),
      el('span', { class: 'row-de' }, `ΔE ${h.dE.toFixed(1)}`),
      el('button', {
        class: 'x', type: 'button', 'aria-label': t('clearHistory'),
        onclick: () => { history = history.filter((x) => x !== h); store.set('history', history); renderHistory(); },
      }, '×'));
  }).filter(Boolean));
}

function renderSettings() {
  $('#set-cal').textContent = cal ? t('calibratedAt', { time: dateTimeText(cal.at) }) : t('notCalibrated');
  $('#set-lock').textContent = cal ? t(cal.lock ? 'lockOn' : 'lockOff') : '';
  $('#reset-cal').disabled = !cal;
  const n = Object.keys(learned).length;
  $('#set-learned').textContent = t('learnedCount', { n });
  $('#clear-learned').disabled = n === 0;
}

// ---------- actions ----------
function setHold(v) {
  hold = v;
  $('#hold').textContent = t(hold ? 'resume' : 'hold');
  $('#hold').classList.toggle('on', hold);
}

async function calibrate() {
  $('#dlg-cal').close();
  if (mode === 'live' && !stream) { toast(t('camError')); return; }
  setHold(false);
  toast(t('calWorking'));
  const lock = mode === 'live' ? await lockCamera() : null;
  calibrating = [];
  const deadline = Date.now() + 3000;
  while (calibrating.length < 8 && Date.now() < deadline) await wait(120);
  const samples = calibrating;
  calibrating = null;
  if (!samples.length) { toast(t('camError')); return; }

  const mean = [0, 1, 2].map((i) => samples.reduce((s, m) => s + m.lin[i], 0) / samples.length);
  const clipped = samples.reduce((s, m) => s + m.clipped, 0) / samples.length;
  const max = Math.max(...mean), min = Math.min(...mean);
  const error = clipped > 0.1 ? 'calTooBright' : max < 0.12 ? 'calTooDark' : min / max < 0.55 ? 'calNotWhite' : null;
  if (error) { toast(t(error)); return; }

  cal = { gains: gainsFromWhite(mean), at: Date.now(), lock };
  store.set('cal', cal);
  smooth = null;
  renderCal();
  renderSettings();
  toast(t(lock ? 'calDoneLocked' : 'calDone'));
}

function saveReading() {
  if (!reading) return;
  const best = reading.matches[0];
  history = [{ t: Date.now(), code: best.color.code, dE: +best.dE.toFixed(2), hex: reading.hex, conf: confidence(reading.matches) },
    ...history].slice(0, 500);
  store.set('history', history);
  renderHistory();
  toast(t('saved', { code: best.color.code }));
}

function openTeach() {
  if (!reading) return;
  const snapshot = reading;
  $('#teach-list').replaceChildren(...snapshot.matches.map((m) =>
    el('li', {}, el('button', {
      class: 'row', type: 'button',
      onclick: () => {
        learned = learn(learned, m.color.code, snapshot.lab);
        store.set('learned', learned);
        $('#dlg-teach').close();
        toast(t('learnedToast', { code: m.color.code }));
        reading = { ...snapshot, matches: rank(snapshot.lab, learned) };
        renderReading();
        renderCatalog();
        renderSettings();
      },
    }, ...colorRow(m.color, el('span', { class: 'row-de' }, `ΔE ${m.dE.toFixed(1)}`))))));
  $('#dlg-teach').showModal();
}

function exportCsv() {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['time', 'code', 'name_he', 'name_en', 'finish', 'delta_e', 'confidence', 'measured_hex'].join(',')];
  for (const h of history) {
    const c = byCode[h.code];
    if (!c) continue;
    lines.push([new Date(h.t).toISOString(), c.code, c.he, c.en, FINISHES[c.finish].label, h.dE, h.conf, h.hex].map(q).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `color-scans-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function showView(v) {
  view = v;
  $$('.view').forEach((s) => { s.hidden = s.id !== `view-${v}`; });
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'scan') layoutReticle();
  if (v === 'settings') renderSettings();
}

// ---------- wiring ----------
$('#lang').addEventListener('click', () => { lang = lang === 'he' ? 'en' : 'he'; store.set('lang', lang); applyLang(); });
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('#cam-start').addEventListener('click', startCamera);
$('#torch').addEventListener('click', toggleTorch);
$('#photo').addEventListener('click', () => $('#file').click());
$('#live').addEventListener('click', () => setMode('live'));
$('#file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) loadPhoto(file);
});
stillCanvas.addEventListener('pointerdown', (e) => {
  const g = stillGeom();
  still.x = Math.min(stillCanvas.width, Math.max(0, (e.clientX - g.left - g.ox) / g.scale));
  still.y = Math.min(stillCanvas.height, Math.max(0, (e.clientY - g.top - g.oy) / g.scale));
  setHold(false);
  layoutReticle();
});
$('#cal-chip').addEventListener('click', () => $('#dlg-cal').showModal());
$('#calibrate').addEventListener('click', () => $('#dlg-cal').showModal());
$('#cal-go').addEventListener('click', calibrate);
$('#hold').addEventListener('click', () => setHold(!hold));
$('#save').addEventListener('click', saveReading);
$('#teach').addEventListener('click', openTeach);
$('#search').addEventListener('input', renderCatalog);
$('#export').addEventListener('click', exportCsv);
$('#clear-history').addEventListener('click', () => {
  if (!confirm(t('confirmClearHistory'))) return;
  history = [];
  store.set('history', history);
  renderHistory();
});
$('#reset-cal').addEventListener('click', () => {
  cal = null;
  store.set('cal', null);
  smooth = null;
  renderCal();
  renderSettings();
  if (mode === 'live') startCamera(); // releases any exposure / white-balance lock
});
$('#clear-learned').addEventListener('click', () => {
  if (!confirm(t('confirmClearLearned'))) return;
  learned = {};
  store.set('learned', learned);
  renderCatalog();
  renderSettings();
});
$('#forget').addEventListener('click', () => {
  const { [detailCode]: _, ...rest } = learned;
  learned = rest;
  store.set('learned', learned);
  $('#dlg-color').close();
  renderCatalog();
  renderSettings();
});
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

video.addEventListener('loadedmetadata', layoutReticle);
window.addEventListener('resize', layoutReticle);
document.addEventListener('visibilitychange', () => {
  if (mode !== 'live') return;
  if (document.hidden) stopCamera();
  else startCamera();
});

applyLang();
startCamera();
setInterval(tick, 120);
setInterval(renderCal, 60 * 1000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
