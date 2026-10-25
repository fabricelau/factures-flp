/* =====================================================================
   Factures FLP — outils communs (liste + appli photo).
   · API avec jeton anti-falsification
   · Fenêtres intégrées (remplacent alert/confirm/prompt)
   · Thème clair / sombre
   · Bibliothèques chargées à la demande : lecture (Tesseract), PDF (pdf.js),
     photos iPhone (heic2any), PDF multi-pages (jsPDF), Excel (SheetJS)
   ===================================================================== */
(function (G) {
  'use strict';
  const BASE = G.FLP.base, API = BASE + 'api.php';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let TOKEN = G.FLP.t || '';

  /* ---------- API ---------- */
  async function api(action, data, opts = {}) {
    const init = { credentials: 'same-origin', headers: { 'X-FLP': TOKEN } };
    if (data) { init.method = 'POST'; init.body = data instanceof FormData ? data : toForm(data); }
    let r;
    try { r = await fetch(API + '?a=' + action + (opts.qs || ''), init); }
    catch (err) { const e = new Error(navigator.onLine ? 'Le site ne répond pas, réessayez dans un instant.' : 'Hors-ligne : impossible sans réseau.'); e.status = 0; e.offline = true; throw e; }
    if (r.status === 401) { location.href = BASE; throw new Error('auth'); }
    const j = await r.json().catch(() => ({ ok: false, msg: r.status === 413 ? 'Fichier trop volumineux pour le serveur.' : 'Réponse illisible du serveur (' + r.status + ').' }));
    if (j.t) TOKEN = j.t;
    if (!j.ok && !opts.quiet) { const e = new Error(j.msg || 'Erreur.'); e.status = r.status; throw e; }
    j.status = r.status;
    return j;
  }
  function toForm(o) { const f = new FormData(); for (const k in o) if (o[k] !== undefined && o[k] !== null) f.set(k, o[k]); return f; }
  const setToken = t => { if (t) TOKEN = t; };

  /* ---------- Fenêtres intégrées ---------- */
  function dialog({ title = '', html = '', buttons = [{ label: 'OK', value: true, primary: true }], onOpen, wide } = {}) {
    return new Promise(resolve => {
      const w = document.createElement('div');
      w.className = 'dlg';
      w.innerHTML = `<div class="dlg-bg"></div><div class="dlg-box${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
        ${title ? `<h3>${esc(title)}</h3>` : ''}<div class="dlg-body">${html}</div>
        <div class="dlg-foot">${buttons.map((b, i) => `<button type="button" class="btn ${b.primary ? 'btn-acc' : ''} ${b.danger ? 'btn-del' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
      document.body.appendChild(w);
      const close = v => { w.remove(); document.removeEventListener('keydown', key); resolve(v); };
      const val = b => typeof b.value === 'function' ? b.value(w) : b.value;
      w.querySelector('.dlg-bg').onclick = () => close(null);
      w.querySelectorAll('[data-i]').forEach(el => el.onclick = () => { const b = buttons[+el.dataset.i]; const v = val(b); if (v !== undefined) close(v); });
      const key = e => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { const p = buttons.findIndex(b => b.primary); if (p >= 0) { e.preventDefault(); const v = val(buttons[p]); if (v !== undefined) close(v); } }
      };
      document.addEventListener('keydown', key);
      if (onOpen) onOpen(w, close);
      const f = w.querySelector('input,select,textarea'); (f || w.querySelector('.btn-acc'))?.focus();
    });
  }
  const alertBox = (msg, title) => dialog({ title, html: `<p>${esc(msg)}</p>` });
  const confirmBox = (msg, { title, ok = 'Confirmer', danger } = {}) =>
    dialog({ title, html: `<p>${esc(msg)}</p>`, buttons: [{ label: 'Annuler', value: false }, { label: ok, value: true, primary: !danger, danger }] }).then(v => !!v);
  function formBox({ title, fields, ok = 'Enregistrer', intro = '' }) {
    const html = (intro ? `<p class="muted">${intro}</p>` : '') + fields.map(f => `<label class="fld">${esc(f.label)}
      ${f.type === 'select' ? `<select name="${f.name}">${f.options.map(o => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : f.type === 'textarea' ? `<textarea name="${f.name}" rows="3">${esc(f.value || '')}</textarea>`
        : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.auto ? `autocomplete="${f.auto}"` : ''} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}>`}
      ${f.hint ? `<small>${f.hint}</small>` : ''}</label>`).join('');
    return dialog({ title, html, buttons: [{ label: 'Annuler', value: null }, { label: ok, primary: true, value: w => {
      const o = {}; w.querySelectorAll('[name]').forEach(el => o[el.name] = el.value); return o; } }] });
  }

  /* ---------- Toasts ---------- */
  function toast(msg, kind, undo) {
    let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = esc(msg) + (undo ? ` <button class="u">${esc(undo.label)}</button>` : '');
    if (undo) t.querySelector('.u').onclick = () => { undo.fn(); t.remove(); };
    box.appendChild(t);
    setTimeout(() => t.remove(), undo ? 7000 : 3500);
  }

  /* ---------- Thème ---------- */
  function theme(set) {
    let t = set;
    try { if (!t) t = localStorage.getItem('flp-theme') || 'dark'; else localStorage.setItem('flp-theme', t); } catch (e) { t = t || 'dark'; }
    document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f4f1ec' : '#0d1114';
    return t;
  }

  /* ---------- Chargement des bibliothèques ---------- */
  const LIBS = {
    tesseract: ['https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js', () => G.Tesseract],
    pdf: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', () => G.pdfjsLib],
    heic: ['https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js', () => G.heic2any],
    jspdf: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => G.jspdf],
    autotable: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', () => G.jspdf && G.jspdf.jsPDF.API.autoTable],
    xlsx: ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', () => G.XLSX],
  };
  const loading = {};
  function lib(name) {
    if (loading[name]) return loading[name];
    const [src, get] = LIBS[name];
    if (get()) return (loading[name] = Promise.resolve(get()));
    return (loading[name] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => { const v = get(); v ? res(v) : rej(new Error(name)); };
      s.onerror = () => { delete loading[name]; rej(new Error('Bibliothèque indisponible : ' + name)); };
      document.head.appendChild(s);
    }));
  }
  async function pdfLib() {
    const p = await lib('pdf');
    p.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return p;
  }

  /* ---------- Images ---------- */
  const isHeic = f => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '');
  async function heicToJpeg(file) {
    const h = await lib('heic');
    const out = await h({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    const b = Array.isArray(out) ? out[0] : out;
    return new File([b], (file.name || 'photo').replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' });
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = typeof src === 'string' ? src : URL.createObjectURL(src); });
  }
  function canvasToBlob(c, type = 'image/jpeg', q = 0.88) { return new Promise(r => c.toBlob(r, type, q)); }
  /* Réduit une photo (2400 px max) avant envoi : plus rapide en 4G, moins d'espace */
  async function compress(file, max = 2400) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const img = await loadImage(file);
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      if (k >= 1 && file.size < 2.5e6) return file;
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const b = await canvasToBlob(c, 'image/jpeg', 0.86);
      return b && b.size < file.size ? new File([b], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch (e) { return file; }
  }
  /* Toutes les pages d'un PDF en images (pour l'assembler avec d'autres pages) */
  async function pdfPages(file, { max = 30, side = 1800 } = {}) {
    const pdfjs = await pdfLib();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, max); i++) {
      const page = await doc.getPage(i);
      try { const tc = await page.getTextContent(); text += tc.items.map(it => it.str).join(' ') + '\n'; } catch (e) {}
      const vp = page.getViewport({ scale: 1 });
      const v2 = page.getViewport({ scale: Math.min(3, side / Math.max(vp.width, vp.height)) });
      const c = document.createElement('canvas'); c.width = Math.round(v2.width); c.height = Math.round(v2.height);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: v2 }).promise;
      out.push(c);
    }
    return { canvases: out, text: text.replace(/[ \t]+/g, ' ').trim(), total: doc.numPages };
  }
  /* Une photo (y compris HEIC) en image réduite */
  async function imageCanvas(file, side = 2400) {
    let f = file;
    if (isHeic(f)) f = await heicToJpeg(f);
    const im = await loadImage(f);
    const k = Math.min(1, side / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c;
  }
  /* Photos → un PDF (une page par image, à la taille de l'image : rien n'est déformé ni rogné) */
  async function toPdf(sources, name = 'facture.pdf', quality = 0.84) {
    const { jsPDF } = await lib('jspdf');
    let pdf = null;
    for (const src of sources) {
      let c = src;
      if (!(src instanceof HTMLCanvasElement)) { const im = await loadImage(src); c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); }
      let wmm = 210, hmm = 210 * c.height / c.width;
      if (hmm > 5000) { wmm = wmm * 5000 / hmm; hmm = 5000; }     // ticket très long : limite d'une page PDF
      const o = hmm >= wmm ? 'p' : 'l';
      if (!pdf) pdf = new jsPDF({ unit: 'mm', format: [wmm, hmm], orientation: o, compress: true });
      else pdf.addPage([wmm, hmm], o);
      // JPEG en binaire (plus rapide et plus léger en mémoire qu'en texte base64)
      const jb = await canvasToBlob(c, 'image/jpeg', quality);
      pdf.addImage(new Uint8Array(await jb.arrayBuffer()), 'JPEG', 0, 0, wmm, hmm, undefined, 'NONE');
    }
    return new File([pdf.output('blob')], name, { type: 'application/pdf' });
  }
  /* Petite image pour la miniature */
  async function thumbOf(source, max = 600) {
    const img = source instanceof HTMLCanvasElement ? source : await loadImage(source);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return canvasToBlob(c, 'image/jpeg', 0.8);
  }

  /* ---------- PDF : texte, nombre de pages, 1re page en image ---------- */
  async function readPdf(file) {
    const pdfjs = await pdfLib();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      let lastY = null;
      for (const it of tc.items) {
        const y = Math.round(it.transform[5]);
        text += (lastY !== null && Math.abs(y - lastY) > 4 ? '\n' : ' ') + it.str;
        lastY = y;
      }
      text += '\n';
    }
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 1600 / Math.max(vp.width, vp.height));
    const v2 = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(v2.width); c.height = Math.round(v2.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: v2 }).promise;
    return { text: text.replace(/[ \t]+/g, ' ').trim(), pages: doc.numPages, canvas: c };
  }

  /* ---------- Lecture du texte d'une image (OCR) ---------- */
  let worker = null;
  let workerP = null, progressCb = null;
  /* Le moteur de lecture se charge une seule fois (et peut être préchauffé à l'avance) */
  function ocrWarm() {
    if (!workerP) workerP = lib('tesseract').then(T => T.createWorker('fra', 1, { logger: m => { if (progressCb && m.status === 'recognizing text') progressCb(m.progress); } }))
      .catch(e => { workerP = null; throw e; });
    return workerP;
  }
  let ocrChain = Promise.resolve();
  function ocr(img, onProgress) {     // une lecture à la fois
    const run = ocrChain.then(async () => {
      const w = await ocrWarm();
      progressCb = onProgress || null;
      try { const { data } = await w.recognize(img); return data.text || ''; } finally { progressCb = null; }
    });
    ocrChain = run.catch(() => {});
    return run;
  }

  /* ---------- Préparation complète d'un fichier avant envoi ----------
     Renvoie { file, thumb, text, pages } : photos HEIC converties, photos
     réduites, PDF lus (texte + miniature de la 1re page), images lues. */
  async function prepare(file, { learn, onStep } = {}) {
    const step = s => onStep && onStep(s);
    let f = file, thumb = null, text = '', pages = 1, vh = '';
    if (isHeic(f)) { step('Conversion de la photo iPhone…'); try { f = await heicToJpeg(f); } catch (e) { /* le serveur gardera le HEIC */ } }
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) {
      step('Lecture du PDF…');
      try {
        const r = await readPdf(f);
        pages = r.pages; thumb = await thumbOf(r.canvas); text = r.text; vh = await vhash(r.canvas);
        if (text.replace(/\s/g, '').length < 30) { step('PDF scanné : lecture de l’image…'); text = await ocr(r.canvas); }
      } catch (e) { console.warn(e); }
    } else if (/^image\//.test(f.type)) {
      f = await compress(f);
      vh = await vhash(f);
      step('Lecture de la facture…');
      try { text = await ocr(f); } catch (e) { console.warn(e); }
      // enregistrée en PDF (comme les scans)
      try { thumb = await thumbOf(f); step('Conversion en PDF…'); f = await toPdf([f], (file.name || 'facture').replace(/\.\w+$/, '') + '.pdf'); } catch (e) { console.warn(e); }
    }
    const guess = (text || vh) && G.FLPExtract ? G.FLPExtract.extract(text, learn || [], { vh }) : null;
    return { file: f, thumb, text, pages, guess, vh };
  }

  /* Formulaire d'envoi à partir d'une préparation */
  function uploadForm(prep, extra = {}) {
    const fd = new FormData();
    fd.set('file', prep.file, prep.file.name || 'facture');
    if (prep.thumb) fd.set('thumb', prep.thumb, 'thumb.jpg');
    fd.set('pages', prep.pages || 1);
    if (prep.vh) fd.set('vh', prep.vh);
    const g = prep.guess || {};
    for (const k of ['societe', 'date', 'montant', 'categorie', 'numero', 'devise', 'ht', 'tva', 'taux_tva', 'sens'])
      if (g[k] !== undefined && g[k] !== null && g[k] !== '') fd.set(k, g[k]);
    if (prep.text) fd.set('texte', prep.text.slice(0, 20000));
    fd.set('doutes', (g.doutes || (prep.text ? [] : ['lecture'])).join(','));
    for (const k in extra) if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') fd.set(k, extra[k]);
    return fd;
  }

  /* ---------- Formats ---------- */
  const eur = (v, cur) => v == null || v === '' ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur || 'EUR' }).format(v);
  const frDate = d => { if (!d) return 'Sans date'; const [y, m, j] = d.split('-'); return `${j}/${m}/${y}`; };
  const MOIS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  /* ---------- Empreinte visuelle de l'en-tête (logo, disposition) ----------
     La bande du haut de la facture est réduite à une mini-image 32×12 en niveaux de gris.
     Deux factures du même fournisseur ont des mini-images très ressemblantes (même logo,
     même disposition), même photographiées différemment ; on les compare par corrélation,
     en tolérant un léger décalage. Gratuit, tout se fait sur le téléphone. */
  const VW = 32, VH = 12;
  async function vhash(src) {
    try {
      let img = src;
      if (src instanceof Blob) img = await loadImage(src);
      const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
      if (!w0 || !h0) return '';
      const k = Math.min(1, 480 / w0), W = Math.round(w0 * k), H = Math.round(h0 * k);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data, g = new Uint8Array(W * H);
      for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      const hist = new Uint32Array(256); for (const v of g) hist[v]++;
      let acc = 0, paper = 255; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > g.length * 0.3) { paper = v; break; } }
      const ink = Math.max(0, paper - 40), minR = Math.max(2, W * 0.01);
      // haut de l'en-tête = première ligne avec de l'encre (la marge blanche du haut ne compte pas)
      let top = 0;
      for (; top < H - 1; top++) { let n = 0; for (let xx = 0; xx < W; xx++) if (g[top * W + xx] < ink) n++; if (n >= minR) break; }
      const bandH = Math.min(H - top, Math.round(W * 0.3));
      if (bandH < 12) return '';
      // réduction en deux temps (moyenne propre)
      const m = document.createElement('canvas'); m.width = VW * 4; m.height = VH * 4;
      const mx = m.getContext('2d'); mx.imageSmoothingQuality = 'high'; mx.drawImage(c, 0, top, W, bandH, 0, 0, m.width, m.height);
      const t = document.createElement('canvas'); t.width = VW; t.height = VH;
      const tx = t.getContext('2d', { willReadFrequently: true }); tx.imageSmoothingQuality = 'high'; tx.drawImage(m, 0, 0, VW, VH);
      const td = tx.getImageData(0, 0, VW, VH).data;
      let hex = '';
      for (let i = 0; i < VW * VH; i++) { const v = (td[i * 4] * 77 + td[i * 4 + 1] * 150 + td[i * 4 + 2] * 29) >> 8; hex += (v >> 4).toString(16) + (v & 15).toString(16); }
      return hex;
    } catch (e) { return ''; }
  }
  /* écart entre deux empreintes : 0 = identiques, 1 = sans rapport (1 − meilleure corrélation, décalage ±2) */
  function hamming(a, b) {
    if (!a || !b || a.length !== VW * VH * 2 || b.length !== a.length) return 1;
    const A = new Float32Array(VW * VH), B = new Float32Array(VW * VH);
    for (let i = 0; i < VW * VH; i++) { A[i] = parseInt(a.substr(i * 2, 2), 16); B[i] = parseInt(b.substr(i * 2, 2), 16); }
    let best = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = Math.max(0, dy); y < Math.min(VH, VH + dy); y++) for (let x = Math.max(0, dx); x < Math.min(VW, VW + dx); x++) {
        const p = A[y * VW + x], q = B[(y - dy) * VW + (x - dx)];
        n++; sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q;
      }
      const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
      if (va < n * 9 || vb < n * 9) continue;               // bande presque unie : pas assez d'indices
      const r = (sab - sa * sb / n) / Math.sqrt(va * vb);
      if (r > best) best = r;
    }
    return best < 0 ? 1 : 1 - best;
  }

  G.FLPC = { api, vhash, hamming, setToken, token: () => TOKEN, dialog, alertBox, confirmBox, formBox, toast, theme, lib, pdfLib, ocr, ocrWarm, readPdf,
    isHeic, heicToJpeg, compress, toPdf, pdfPages, imageCanvas, thumbOf, loadImage, canvasToBlob, prepare, uploadForm, eur, frDate, MOIS, esc, $ };
  theme();
})(window);
