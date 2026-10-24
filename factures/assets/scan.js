/* =====================================================================
   Factures FLP — appli photo (v2).
   Photo → réglage des coins (détectés automatiquement) → filtre document
   → aperçu → envoi (1 page en JPEG, plusieurs pages en un PDF, ticket long
   recollé) → validation rapide des champs lus.
   Hors-ligne : les envois attendent dans la boîte d'envoi du téléphone.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.FLPC, S = window.FLPScan, $ = s => document.querySelector(s);
  const BASE = window.FLP.base;
  const views = ['camView', 'editView', 'reviewView', 'quickView'];
  let stream = null, track = null, facing = 'environment', mode = '1', torchOn = false;
  let pages = [];          // pages validées : { canvas }
  let edit = null;         // page en cours de réglage : { src, pts, deg }
  let meta = { learn: [], cfg: { categories: [] } };
  let useFilter = true;
  try { useFilter = localStorage.getItem('flp-filter') !== '0'; } catch (e) {}

  /* ---------- Vues ---------- */
  function show(v) {
    views.forEach(id => $('#' + id).hidden = id !== v);
    const cam = v === 'camView';
    $('#modes').hidden = !cam; $('#controls').hidden = !cam;
    if (cam) startCam(); else stopCam();
  }
  function busy(txt) { $('#busy').hidden = !txt; if (txt) $('#busyTxt').textContent = txt; }

  /* ---------- Appareil photo ---------- */
  async function startCam() {
    if (stream) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
      $('#cam').srcObject = stream; $('#cam').hidden = false; $('#camErr').hidden = true;
      track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      $('#torch').hidden = !caps.torch;
      if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      if (caps.torch && torchOn) track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
      liveLoop();
    } catch (e) { $('#camErr').hidden = false; $('#cam').hidden = true; }
  }
  /* Contour de la feuille en direct (≈ 4 fois par seconde, sur une petite image) */
  let liveT = null, livePts = null, liveHits = 0;
  function liveLoop() {
    clearTimeout(liveT);
    if (!stream || $('#camView').hidden || document.hidden) return;
    const v = $('#cam');
    if (v.videoWidth) {
      const t0 = performance.now();
      let d = null; try { d = S.detect(v, { fast: true }); } catch (e) {}
      const svg = $('#live'), r = v.getBoundingClientRect();
      const k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight), ox = (r.width - v.videoWidth * k) / 2, oy = (r.height - v.videoHeight * k) / 2;
      svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      if (d && d.found) {
        // lissage : le contour ne tremble pas d'une image à l'autre
        livePts = livePts ? d.pts.map((p, i) => ({ x: livePts[i].x * 0.4 + p.x * 0.6, y: livePts[i].y * 0.4 + p.y * 0.6 })) : d.pts;
        liveHits = Math.min(liveHits + 1, 3);
        svg.innerHTML = `<polygon points="${livePts.map(p => (p.x * k + ox).toFixed(1) + ',' + (p.y * k + oy).toFixed(1)).join(' ')}"/>`;
        $('#camView').classList.add('has-doc');
        if (liveHits >= 2) $('#hint').textContent = 'Feuille repérée : prenez la photo';
      } else {
        liveHits = Math.max(0, liveHits - 1);
        if (!liveHits) { livePts = null; svg.innerHTML = ''; $('#camView').classList.remove('has-doc'); setHint(); }
      }
      const ms = performance.now() - t0;
      liveT = setTimeout(liveLoop, Math.max(180, ms * 4));   // jamais plus de 20 % du temps du téléphone
      return;
    }
    liveT = setTimeout(liveLoop, 300);
  }
  function stopCam() { clearTimeout(liveT); livePts = null; liveHits = 0; $('#live').innerHTML = ''; $('#camView').classList.remove('has-doc'); if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; track = null; } }
  $('#flip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; stopCam(); startCam(); };
  $('#torch').onclick = async () => {
    if (!track) return;
    torchOn = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { torchOn = false; }
    $('#torch').classList.toggle('on', torchOn);
  };

  /* ---------- Modes ---------- */
  $('#modes').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    mode = b.dataset.m;
    [...$('#modes').children].forEach(x => x.setAttribute('aria-pressed', x === b));
    setHint();
    pageCount();
  });
  function setHint() {
    $('#hint').textContent = mode === 'long' ? 'Ticket long : photographiez-le en plusieurs morceaux, de haut en bas'
      : mode === 'multi' ? 'Plusieurs pages : une photo par page, puis « Envoyer »'
      : 'Cadrez la facture, posée à plat';
  }
  function pageCount() { const n = pages.length; $('#pageCount').hidden = !n; $('#pageCount').textContent = n + (mode === 'long' ? ' morceau' : ' page') + (n > 1 ? 's' : ''); }

  /* ---------- Prise de vue ---------- */
  /* Stabilisation : au déclic, on observe ~0,7 s de vidéo et on garde l'image la plus nette.
     Le tremblement de la main (et du doigt sur le bouton) ne dure qu'une fraction de seconde :
     parmi 6 à 12 images, il y en a presque toujours une bien nette. */
  let shooting = false;
  $('#shot').onclick = async () => {
    const v = $('#cam'); if (!stream || !v.videoWidth || shooting) return;
    shooting = true; clearTimeout(liveT);
    $('#shot').classList.add('busy'); $('#hint').textContent = 'Ne bougez plus…';
    try {
      const W = v.videoWidth, H = v.videoHeight;
      // zone mesurée : la feuille repérée, sinon le centre de l'image
      let x0 = W * 0.2, y0 = H * 0.2, x1 = W * 0.8, y1 = H * 0.8;
      if (livePts) { x0 = Math.max(0, Math.min(...livePts.map(p => p.x))); x1 = Math.min(W, Math.max(...livePts.map(p => p.x))); y0 = Math.max(0, Math.min(...livePts.map(p => p.y))); y1 = Math.min(H, Math.max(...livePts.map(p => p.y))); }
      const cw = x1 - x0, ch = y1 - y0, k = Math.min(1, 480 / Math.max(cw, ch));
      const probe = document.createElement('canvas'); probe.width = Math.max(16, Math.round(cw * k)); probe.height = Math.max(16, Math.round(ch * k));
      const pc = probe.getContext('2d', { willReadFrequently: true });
      const best = document.createElement('canvas'); best.width = W; best.height = H;
      const bc = best.getContext('2d');
      let bestS = -1, n = 0, last = -1, since = 0;
      const t0 = performance.now(), scores = [];
      const nextFrame = () => new Promise(r => v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => r()) : requestAnimationFrame(() => r()));
      while (performance.now() - t0 < 650 && n < 12) {
        await nextFrame();
        if (v.currentTime === last && !v.requestVideoFrameCallback) continue;   // même image qu'avant
        last = v.currentTime;
        pc.drawImage(v, x0, y0, cw, ch, 0, 0, probe.width, probe.height);
        const sh = sharpness(pc.getImageData(0, 0, probe.width, probe.height));
        n++; scores.push(sh);
        if (sh > bestS) { bestS = sh; bc.drawImage(v, 0, 0); since = 0; } else since++;
        // arrêt anticipé : une image nette est déjà là et les suivantes ne font pas mieux
        if (n >= 3 && since >= 2) { const med = scores.slice().sort((a, b) => a - b)[scores.length >> 1]; if (bestS >= med * 1.1 || performance.now() - t0 > 350) break; }
      }
      if (bestS < 0) bc.drawImage(v, 0, 0);
      flash();
      openEditor(best, null, livePts && liveHits >= 2 ? livePts.map(p => ({ x: p.x, y: p.y })) : null);
    } finally { shooting = false; $('#shot').classList.remove('busy'); setHint(); }
  };
  /* netteté : énergie des contours fins (variance du laplacien) */
  function sharpness(img) {
    const d = img.data, W = img.width, H = img.height, g = new Float32Array(W * H);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    let s = 0, s2 = 0, n = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x, l = 4 * g[p] - g[p - 1] - g[p + 1] - g[p - W] - g[p + W];
      s += l; s2 += l * l; n++;
    }
    return n ? s2 / n - (s / n) ** 2 : 0;
  }
  function flash() {
    const f = document.createElement('div'); f.className = 'flash'; document.body.appendChild(f);
    requestAnimationFrame(() => f.style.opacity = '0'); setTimeout(() => f.remove(), 300);
  }

  /* ---------- Réglage des coins ---------- */
  function openEditor(src, keepPts, hint) {
    // l'écran s'ouvre tout de suite, la recherche des bords suit juste après
    edit = { src, pts: keepPts || hint || S.inset(src.width, src.height, 0.06), deg: 0 };
    $('#editHint').textContent = keepPts ? 'Ajustez les coins si besoin.' : 'Recherche des bords…';
    $('#eFilter').setAttribute('aria-pressed', useFilter);
    show('editView');
    requestAnimationFrame(drawEditor);
    if (keepPts) return;
    const mine = edit;
    setTimeout(() => {
      if (edit !== mine) return;
      const det = S.detect(src, hint ? { init: hint } : {});
      if (edit !== mine) return;
      edit.pts = det.pts; drawQuad();
      $('#editHint').textContent = det.found ? 'Bords trouvés. Ajustez les coins si besoin.' : 'Faites glisser les 4 coins sur les bords de la feuille.';
    }, 60);
  }
  let view = { k: 1, ox: 0, oy: 0 };
  function drawEditor() {
    if (!edit) return;
    const wrap = $('#editWrap'), cv = $('#editCanvas');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const k = Math.min(W / edit.src.width, H / edit.src.height);
    cv.width = Math.round(edit.src.width * k); cv.height = Math.round(edit.src.height * k);
    cv.style.left = ((W - cv.width) / 2) + 'px'; cv.style.top = ((H - cv.height) / 2) + 'px';
    cv.getContext('2d').drawImage(edit.src, 0, 0, cv.width, cv.height);
    view = { k, ox: (W - cv.width) / 2, oy: (H - cv.height) / 2 };
    drawQuad();
  }
  function drawQuad() {
    const svg = $('#editQuad'), P = edit.pts.map(p => [p.x * view.k + view.ox, p.y * view.k + view.oy]);
    svg.setAttribute('viewBox', `0 0 ${$('#editWrap').clientWidth} ${$('#editWrap').clientHeight}`);
    svg.innerHTML = `<polygon points="${P.map(p => p.join(',')).join(' ')}" class="q"/>` +
      P.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="17" class="h" data-i="${i}"/><circle cx="${p[0]}" cy="${p[1]}" r="5" class="hd"/>`).join('');
  }
  (function dragHandles() {
    const svg = $('#editQuad'); let cur = -1;
    const pos = e => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.ox) / view.k, y: (e.clientY - r.top - view.oy) / view.k }; };
    svg.addEventListener('pointerdown', e => {
      const p = pos(e);
      let best = -1, bd = 1e9;
      edit.pts.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y) * view.k; if (d < bd) { bd = d; best = i; } });
      if (bd < 48) { cur = best; svg.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    svg.addEventListener('pointermove', e => {
      if (cur < 0) return;
      const p = pos(e);
      edit.pts[cur] = { x: Math.max(0, Math.min(edit.src.width, p.x)), y: Math.max(0, Math.min(edit.src.height, p.y)) };
      drawQuad();
    });
    const up = () => { cur = -1; };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  })();
  window.addEventListener('resize', () => { if (!$('#editView').hidden) drawEditor(); });

  $('#eRot').onclick = () => { edit.deg = (edit.deg + 90) % 360; $('#eRot').querySelector('span').textContent = edit.deg ? `Tourné ${edit.deg}°` : 'Tourner'; };
  $('#eFilter').onclick = () => { useFilter = !useFilter; $('#eFilter').setAttribute('aria-pressed', useFilter); try { localStorage.setItem('flp-filter', useFilter ? '1' : '0'); } catch (e) {} };
  $('#eAuto').onclick = () => { const d = S.detect(edit.src); edit.pts = d.pts; drawQuad(); if (!d.found) C.toast('Bords non trouvés : placez les coins à la main.'); };
  $('#eFull').onclick = () => { const w = edit.src.width, h = edit.src.height; edit.pts = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]; drawQuad(); };
  $('#eRetake').onclick = () => { edit = null; $('#eRot').querySelector('span').textContent = 'Tourner'; show(pages.length ? 'reviewView' : 'camView'); if (!pages.length) show('camView'); };
  $('#eOk').onclick = async () => {
    busy('Redressement de la page…');
    await new Promise(r => setTimeout(r, 30));
    let out = S.warp(edit.src, edit.pts);
    if (edit.deg) out = S.rotate(out, edit.deg);
    // contrôle avant envoi : texte flou ou photo trop sombre ?
    const q = S.sharpText(out);
    if (q.score < 0.17 || q.light < 70) {
      busy('');
      const blurry = q.score < 0.17;
      const r = await C.dialog({ title: blurry ? 'Photo floue' : 'Photo trop sombre',
        html: `<p>${blurry ? 'Le texte n’est pas net : la lecture automatique risque d’échouer et la facture d’être illisible pour le comptable.' : 'La photo manque de lumière : le texte risque d’être illisible.'}</p>
               <p class="muted">${blurry ? 'Astuce : tenez le téléphone à deux mains, à 25–30 cm de la feuille.' : 'Astuce : allumez une lumière, approchez-vous d’une fenêtre' + (track && !$('#torch').hidden ? ' ou utilisez la lampe' : '') + '.'}</p>`,
        buttons: [{ label: 'Garder quand même', value: 'keep' }, { label: 'Reprendre la photo', value: 'retake', primary: true }] });
      if (r === 'retake') { edit = null; $('#eRot').querySelector('span').textContent = 'Tourner'; show('camView'); return; }
      if (r !== 'keep') return;                      // fermé : on reste sur le réglage des coins
      busy('Redressement de la page…');
    }
    if (useFilter) out = S.filter(out);
    busy('');
    pages.push({ canvas: out });
    edit = null; $('#eRot').querySelector('span').textContent = 'Tourner';
    if (mode === '1') return send();
    renderReview(); show('reviewView');
  };

  /* ---------- Aperçu avant envoi ---------- */
  function renderReview() {
    const box = $('#pages'); box.innerHTML = '';
    box.classList.toggle('long', mode === 'long');
    pages.forEach((p, i) => {
      const d = document.createElement('div'); d.className = 'pg';
      const img = document.createElement('img'); img.src = p.canvas.toDataURL('image/jpeg', 0.6);
      const del = document.createElement('button'); del.className = 'pg-del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Retirer');
      del.onclick = () => { pages.splice(i, 1); pages.length ? renderReview() : show('camView'); pageCount(); };
      const n = document.createElement('span'); n.className = 'pg-n'; n.textContent = i + 1;
      d.append(img, n, del); box.appendChild(d);
    });
    $('#rSend').textContent = `Envoyer (${pages.length} ${mode === 'long' ? 'morceau' : 'page'}${pages.length > 1 ? 's' : ''})`;
    pageCount();
  }
  $('#rMore').onclick = () => show('camView');
  $('#rSend').onclick = () => send();

  /* ---------- Fabrication du fichier + lecture + envoi ---------- */
  async function send() {
    if (!pages.length) return;
    try {
      busy('Préparation…');
      let file, first = pages[0].canvas, nb = pages.length;
      // toujours enregistrée en PDF : 1 page, plusieurs pages, ou ticket long recollé en une seule page
      busy('Création du PDF…');
      if (mode === 'long' && pages.length > 1) {
        first = S.stitch(pages.map(p => p.canvas)); nb = 1;
        file = await C.toPdf([first], 'ticket.pdf', 0.85);
      } else {
        file = await C.toPdf(pages.map(p => p.canvas), 'facture.pdf', 0.84);
      }
      const thumb = await C.thumbOf(first);
      // Envoi tout de suite, SANS attendre la lecture : la facture est en sécurité sur le site
      // en 1 à 2 secondes. La lecture se fait ensuite, en arrière-plan, et remplit les champs.
      const ocrSrc = ocrCanvas(first);
      const vh = await C.vhash(first);     // empreinte du logo / de l'en-tête
      const rec = { file: await pack(file), thumb: thumb ? await pack(thumb) : null, pages: nb, text: '', guess: null, vh, ts: Date.now() };
      pages = []; pageCount();
      busy('Envoi…');
      await Outbox.add(rec);
      const sent = await flush(true);
      busy('');
      if (sent && sent.item) { openQuick(sent.item, thumb, sent.doublon); readLater(sent.item.id, ocrSrc, true, vh); }
      else { C.toast(navigator.onLine ? 'Envoi en attente, nouvel essai bientôt.' : 'Hors-ligne : la facture partira au retour du réseau.', 'ok'); show('camView'); }
    } catch (e) { busy(''); C.toast(e.message || 'Échec.', 'err'); show('camView'); }
  }

  /* Image réduite pour la lecture : plus rapide, sans perte pour le texte d'une facture */
  function ocrCanvas(src) {
    const k = Math.min(1, 1700 / src.width);
    if (k >= 1) return src;
    const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  /* Lecture en arrière-plan, puis envoi de ce qui a été lu (seuls les champs vides sont remplis) */
  async function readLater(id, img, live, vh) {
    try {
      if (live) $('#qSub').textContent = 'Lecture de la facture…';
      const text = await C.ocr(img, p => { if (live && quickId === id) $('#qSub').textContent = 'Lecture de la facture… ' + Math.round(p * 100) + ' %'; });
      const g = text || vh ? window.FLPExtract.extract(text, meta.learn, { vh }) : null;
      const fd = new FormData(); fd.set('id', id); fd.set('texte', text.slice(0, 20000));
      if (g) for (const k of ['societe', 'date', 'montant', 'categorie', 'numero', 'devise', 'ht', 'tva', 'taux_tva'])
        if (g[k] !== undefined && g[k] !== null && g[k] !== '') fd.set(k, g[k]);
      fd.set('doutes', g ? (g.doutes || []).join(',') : 'lecture');
      const res = await C.api('lu', fd, { quiet: true });
      if (quickId === id && res && res.item) fillQuick(res.item);
    } catch (e) { if (quickId === id) $('#qSub').textContent = 'Lecture impossible : complétez à la main.'; }
  }

  /* ---------- Boîte d'envoi (IndexedDB) ---------- */
  const Outbox = (() => {
    let dbp;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('flp-factures', 2);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('outbox')) r.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (m, fn) => { const d = await db(); return new Promise((res, rej) => { const q = fn(d.transaction('outbox', m).objectStore('outbox')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
    return { add: r => tx('readwrite', s => s.add(r)), all: () => tx('readonly', s => s.getAll()), remove: id => tx('readwrite', s => s.delete(id)) };
  })();

  const pack = async b => ({ buf: await b.arrayBuffer(), type: b.type || 'application/octet-stream', name: b.name || 'facture' });
  const unpack = r => !r ? null : (r instanceof Blob ? r : r.buf ? new File([r.buf], r.name, { type: r.type }) : null);

  let sending = false;
  async function flush(wantLast) {
    if (sending || !navigator.onLine) { updateQueue(); return null; }
    sending = true; let last = null;
    try {
      const all = await Outbox.all();
      for (const rec of all) {
        try {
          const prep = { file: unpack(rec.file), thumb: rec.thumb ? unpack(rec.thumb) : null, text: rec.text, pages: rec.pages, guess: rec.guess, vh: rec.vh || '' };
          if (!prep.file || !prep.file.size) { await Outbox.remove(rec.id); C.toast('Une photo était illisible sur le téléphone, merci de la reprendre.', 'err'); continue; }
          const res = await C.api('upload', C.uploadForm(prep, { source: 'scan' }));
          await Outbox.remove(rec.id);
          last = res;
          if (!wantLast && !rec.text && res.item && prep.file.type === 'application/pdf')
            C.readPdf(prep.file).then(r => readLater(res.item.id, ocrCanvas(r.canvas), false, rec.vh)).catch(() => {});
          else if (!wantLast && !rec.text && res.item && prep.file.type.startsWith('image/'))
            C.loadImage(prep.file).then(im => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); readLater(res.item.id, ocrCanvas(c), false, rec.vh); }).catch(() => {});
          if (!wantLast) C.toast('Facture envoyée ✓', 'ok');
        } catch (e) {
          if (e.message === 'auth') return null;
          if (e.status === 419) { const j = await C.api('meta', null, { quiet: true }).catch(() => null); if (j && j.t) C.setToken(j.t); break; }
          if (e.status >= 400 && e.status < 500) {   // refus définitif (fichier trop gros, format…) : on le retire pour ne pas bloquer les suivants
            await Outbox.remove(rec.id);
            C.toast('Une facture n’a pas pu être envoyée : ' + e.message, 'err');
            continue;
          }
          break;   // réseau ou serveur indisponible : on réessaiera plus tard
        }
      }
    } finally { sending = false; updateQueue(); }
    return wantLast ? last : null;
  }
  async function updateQueue() {
    const n = (await Outbox.all().catch(() => [])).length;
    $('#queue').innerHTML = n ? (navigator.onLine ? `Envoi… <b>${n}</b>` : `<b>${n}</b> en attente`) : '';
  }
  window.addEventListener('online', () => flush());
  window.addEventListener('offline', updateQueue);
  // caméra coupée dès que l'appli passe en arrière-plan (plus de voyant allumé pour rien)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCam();
    else { flush(); if (!$('#camView').hidden) startCam(); }
  });
  window.addEventListener('pagehide', stopCam);

  /* ---------- Validation rapide (juste après l'envoi) ---------- */
  let quickId = null;
  function openQuick(item, thumb, doublon) {
    const f = $('#qForm');
    quickId = item.id;
    f.querySelectorAll('input,select').forEach(el => delete el.dataset.touched);
    f.id.value = item.id;
    f.societe.value = item.societe || '';
    const shown = item.montant_orig != null ? item.montant_orig : item.montant;   // montant dans la devise de la facture
    f.montant.value = shown != null ? String(shown).replace('.', ',') : '';
    f.dataset.devise = item.devise || 'EUR';
    $('#qCur').textContent = item.devise && item.devise !== 'EUR' ? item.devise : '';
    f.date.value = item.date || '';
    $('#qCat').innerHTML = '<option value="">— Catégorie —</option>' + meta.cfg.categories.map(c => `<option ${c === item.categorie ? 'selected' : ''}>${C.esc(c)}</option>`).join('');
    $('#qSocs').innerHTML = meta.learn.map(l => `<option value="${C.esc(l.n)}">`).join('');
    $('#qThumb').src = thumb ? URL.createObjectURL(thumb) : '';
    $('#qTitle').textContent = doublon ? 'Envoyée — doublon possible' : 'Facture envoyée ✓';
    $('#qSub').textContent = doublon ? 'Une facture identique existe déjà. Vérifiez dans la liste.' : 'Vérifiez ce qui a été lu, puis validez.';
    for (const k of ['societe', 'montant', 'date', 'categorie']) f[k].classList.toggle('doubt', (item.doutes || []).includes(k) || !f[k].value);
    show('quickView');
  }
  $('#qForm').addEventListener('input', e => { e.target.dataset.touched = '1'; e.target.classList.remove('doubt'); });
  /* La lecture vient de finir : on remplit ce que l'utilisateur n'a pas déjà tapé */
  function fillQuick(item) {
    const f = $('#qForm'), dt = item.doutes || [];
    const put = (k, v) => { const el = f[k]; if (!el || el.dataset.touched || el.value || v == null || v === '') return; el.value = v; el.classList.toggle('doubt', dt.includes(k)); };
    put('societe', item.societe);
    const shown = item.montant_orig != null ? item.montant_orig : item.montant;
    if (!f.montant.dataset.touched && !f.montant.value && shown != null) { f.montant.value = String(shown).replace('.', ','); f.dataset.devise = item.devise || 'EUR'; $('#qCur').textContent = item.devise && item.devise !== 'EUR' ? item.devise : ''; f.montant.classList.toggle('doubt', dt.includes('montant')); }
    put('date', item.date);
    put('categorie', item.categorie);
    if (!$('#qTitle').textContent.includes('doublon')) $('#qSub').textContent = item.societe || item.montant != null ? 'Lu automatiquement : vérifiez, puis validez.' : 'Rien de lisible : complétez à la main.';
  }
  $('#qForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await C.api('save', { id: f.id.value, societe: f.societe.value, montant: f.montant.value, devise: f.dataset.devise || 'EUR', date: f.date.value, categorie: f.categorie.value });
      if (f.societe.value && !meta.learn.some(l => l.n === f.societe.value)) meta.learn.push({ n: f.societe.value, cat: f.categorie.value, w: [] });
      C.toast('Facture validée ✓', 'ok');
    } catch (err) { C.toast(err.message, 'err'); }
    quickId = null; show('camView');
  });
  $('#qLater').onclick = () => { quickId = null; C.toast('Elle vous attend dans « À vérifier ».'); show('camView'); };

  /* ---------- Photos ou PDF existants ---------- */
  $('#pick').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f0 of files) {
      let f = f0;
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        try {
          busy('Lecture du PDF…');
          const prep = await C.prepare(f, { learn: meta.learn, onStep: busy });
          busy('Envoi…');
          const res = await C.api('upload', C.uploadForm(prep, { source: 'import' }));
          busy('');
          if (files.length === 1) { openQuick(res.item, prep.thumb, res.doublon); return; }
          C.toast('PDF ajouté ✓', 'ok');
        } catch (err) { busy(''); C.toast(err.message || 'Échec du PDF.', 'err'); }
        continue;
      }
      try {
        if (C.isHeic(f)) { busy('Conversion de la photo iPhone…'); f = await C.heicToJpeg(f); }
        const img = await C.loadImage(f);
        const c = document.createElement('canvas');
        const k = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        busy('');
        openEditor(c);
        if (files.length > 1) { C.toast('Une photo à la fois : réglez puis validez celle-ci.'); }
        return;
      } catch (err) { busy(''); C.toast('Photo illisible.', 'err'); }
    }
  });

  /* ---------- Installation (Android) ---------- */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferred = e;
    let hide = false; try { hide = !!localStorage.getItem('flp-install-hidden'); } catch (x) {}
    if (!hide) $('#install').hidden = false;
  });
  $('#installBtn').onclick = async () => { if (deferred) { deferred.prompt(); deferred = null; } $('#install').hidden = true; };
  $('#installX').onclick = () => { $('#install').hidden = true; try { localStorage.setItem('flp-install-hidden', '1'); } catch (e) {} };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register(BASE + 'sw.js').catch(() => {});
  C.api('meta', null, { quiet: true }).then(j => { if (j.ok) { meta = j; C.setToken(j.t); } }).catch(() => {});
  // préchauffe le moteur de lecture pendant que l'on cadre la photo
  setTimeout(() => { if (navigator.onLine) C.ocrWarm().catch(() => {}); }, 1200);
  show('camView');
  updateQueue(); flush();
})();
