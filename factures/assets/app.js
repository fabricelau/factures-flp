/* =====================================================================
   Factures FLP — interface principale (v2).
   Reçues / Émises / Tableau de bord, filtres, doublons, sélection
   multiple, fiche, visionneuse, revue rapide, frais km, exports,
   corbeille, réglages (accès comptable, GitHub, Dropbox, sauvegardes).
   ===================================================================== */
(function () {
  'use strict';
  const C = window.FLPC, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const { esc, eur, frDate, MOIS } = C;
  const BASE = window.FLP.base, API = BASE + 'api.php', ADMIN = !!window.FLP.admin;
  const ICON_PDF = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  const ICON_KM = '<svg viewBox="0 0 24 24"><path d="M5 17h14M7 17V9l2-4h6l2 4v8M7 13h10"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg>';

  let S = {
    items: [], cfg: { categories: [], categories_ventes: [], bareme: {} }, learn: [], societes: [], dup: new Set(), trash: 0,
    tab: 'achat', q: '', filter: 'all', adv: { cat: '', soc: '', min: '', max: '', from: '', to: '' },
    sort: 'date-desc', view: 'grid', closed: {}, selecting: false, sel: new Set(), bordYear: String(new Date().getFullYear()),
  };
  try { const v = JSON.parse(localStorage.getItem('flp-ui') || '{}'); if (v.view) S.view = v.view; if (v.sort) S.sort = v.sort; } catch (e) {}
  const saveUi = () => { try { localStorage.setItem('flp-ui', JSON.stringify({ view: S.view, sort: S.sort })); } catch (e) {} };
  const byId = id => S.items.find(x => +x.id === +id);
  const cats = sens => sens === 'vente' ? S.cfg.categories_ventes : S.cfg.categories;
  const thumbUrl = x => `${API}?a=thumb&id=${x.id}&r=${x.rot || 0}`;
  const fileUrl = (x, dl) => `${API}?a=file&id=${x.id}&r=${x.rot || 0}${dl ? '&dl=1' : ''}`;
  const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
  const ymd = d => d.toISOString().slice(0, 10);
  const dOf = x => x.date || (x.added || '').slice(0, 10);

  /* ===================== Chargement ===================== */
  async function load() {
    try {
      const d = await C.api('list');
      Object.assign(S, { items: d.items, cfg: d.cfg, learn: d.learn || [], societes: d.societes || [], dup: new Set(d.doublons || []), trash: d.trash || 0 });
      fillAdv(); render();
      setOffline(d.offline);
      if (!d.offline) prefetchThumbs();
      // nouvelle version installée automatiquement depuis la dernière visite
      try { const v = d.cfg.version || '', was = localStorage.getItem('flp-version'); if (v) { if (was && was !== v) C.toast('Appli mise à jour automatiquement ✓', 'ok'); localStorage.setItem('flp-version', v); } } catch (x) {}
    } catch (e) { if (e.message !== 'auth') $('#app').innerHTML = `<p class="empty">Impossible de charger les factures. ${esc(e.message)}</p>`; }
  }

  /* ===================== Hors-ligne ===================== */
  function setOffline(off) {
    document.body.classList.toggle('offline', !!off);
    let bar = $('#offBar');
    if (!off) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'offBar'; bar.className = 'offbar'; document.body.prepend(bar); }
    const when = typeof off === 'string' ? new Date(off) : null;
    bar.textContent = 'Hors-ligne : consultation seulement' + (when && !isNaN(when) ? ' — données du ' + when.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') + '. Les modifications reviendront avec le réseau.';
  }
  window.addEventListener('online', () => { if (document.body.classList.contains('offline')) load(); });
  window.addEventListener('offline', () => setOffline(true));
  /* Garde les miniatures des factures récentes sur le téléphone (pour les voir sans réseau) */
  let prefetched = false;
  function prefetchThumbs() {
    if (prefetched || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    prefetched = true;
    const list = S.items.filter(x => x.thumb).sort((a, b) => (dOf(b) > dOf(a) ? 1 : -1)).slice(0, 150);
    let i = 0;
    const next = () => { if (i >= list.length || !navigator.onLine) return; fetch(thumbUrl(list[i++]), { credentials: 'same-origin' }).catch(() => {}).finally(() => setTimeout(next, 120)); };
    setTimeout(next, 3000);
  }

  /* ===================== Filtres ===================== */
  function inTab(x) { return S.tab === 'vente' ? x.sens === 'vente' : x.sens !== 'vente'; }
  function visible() {
    const a = S.adv, min = num(a.min), max = num(a.max);
    let r = S.items.filter(inTab);
    if (S.filter === 'check') r = r.filter(x => x.check);
    else if (S.filter === 'dup') r = r.filter(x => S.dup.has(+x.id));
    else if (S.filter === 'sent') r = r.filter(x => x.transmis);
    else if (S.filter === 'unsent') r = r.filter(x => !x.transmis);
    else if (/^\d{4}$/.test(S.filter)) r = r.filter(x => x.year === S.filter);
    if (a.cat) r = r.filter(x => x.categorie === a.cat);
    if (a.soc) r = r.filter(x => x.societe === a.soc);
    if (min !== null) r = r.filter(x => (x.montant ?? -1) >= min);
    if (max !== null) r = r.filter(x => x.montant !== null && x.montant <= max);
    if (a.from) r = r.filter(x => dOf(x) >= a.from);
    if (a.to) r = r.filter(x => dOf(x) <= a.to);
    const q = S.q.trim().toLowerCase();
    if (q) {
      const qn = num(q);
      r = r.filter(x => {
        const hay = [x.societe, x.date, frDate(x.date), x.numero, x.categorie, x.note, x.texte, x.km && x.km.trajet].join(' ').toLowerCase();
        return hay.includes(q) || (qn !== null && x.montant !== null && Math.abs(x.montant - qn) < 0.005);
      });
    }
    const s = S.sort;
    r.sort((p, q2) => s === 'date-asc' ? dOf(p).localeCompare(dOf(q2))
      : s === 'mt-desc' ? (q2.montant ?? -1) - (p.montant ?? -1)
      : s === 'mt-asc' ? (p.montant ?? 1e12) - (q2.montant ?? 1e12)
      : s === 'soc' ? (p.societe || '').localeCompare(q2.societe || '', 'fr')
      : dOf(q2).localeCompare(dOf(p)) || q2.id - p.id);
    return r;
  }
  function advCount() { return Object.values(S.adv).filter(Boolean).length; }
  function fillAdv() {
    const cs = cats(S.tab === 'vente' ? 'vente' : 'achat');
    $('#fCat').innerHTML = '<option value="">Toutes</option>' + cs.map(c => `<option ${c === S.adv.cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const socs = [...new Set(S.items.filter(inTab).map(x => x.societe).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    $('#fSoc').innerHTML = '<option value="">Tous</option>' + socs.map(c => `<option ${c === S.adv.soc ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#fSocLabel').textContent = S.tab === 'vente' ? 'Client' : 'Fournisseur';
  }

  /* ===================== Rendu de la liste ===================== */
  function render() {
    if (S.tab === 'bord') { $('#listView').hidden = true; $('#bordView').hidden = false; renderBord(); return; }
    $('#listView').hidden = false; $('#bordView').hidden = true;
    renderStats(); renderFilters();
    const n = advCount(); $('#advN').textContent = n || ''; $('#advBtn').classList.toggle('on', !!n);
    const rb = $('#reviewBtn'); if (rb) { const k = S.items.filter(x => inTab(x) && x.check).length; rb.hidden = !k; rb.textContent = `Revue rapide (${k})`; }
    document.body.classList.toggle('selecting', S.selecting);
    const list = visible(), app = $('#app');
    if (!list.length) {
      const none = !S.items.some(inTab);
      app.innerHTML = `<p class="empty">${none ? (S.tab === 'vente' ? 'Aucune facture émise pour l’instant. Importez vos factures de vente avec « Importer », puis basculez-les en « Émise » dans leur fiche.' : 'Aucune facture pour l’instant. Scannez-en une depuis votre téléphone ou importez un fichier.') : 'Aucune facture ne correspond.'}</p>`;
      return;
    }
    const cls = S.view === 'list' ? 'cards list' : 'cards';
    if (S.sort.startsWith('date')) {
      const groups = new Map();
      for (const x of list) { const k = dOf(x).slice(0, 7) || '0000-00'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
      let html = '';
      for (const [k, g] of groups) {
        const tot = g.reduce((s, x) => s + (x.montant || 0), 0);
        const [y, m] = k.split('-');
        html += `<section class="month${S.closed[k] ? ' closed' : ''}" data-k="${k}">
          <div class="month-h"><h2>${k === '0000-00' ? 'Sans date' : MOIS[+m] + ' ' + y}</h2><span class="n">${g.length} facture${g.length > 1 ? 's' : ''}</span>
          <span class="tot">${eur(tot)}</span><svg class="car" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div>
          <div class="${cls}">${g.map(card).join('')}</div></section>`;
      }
      app.innerHTML = html;
    } else app.innerHTML = `<div class="${cls}" style="margin-top:14px">${list.map(card).join('')}</div>`;
  }
  function badges(x) {
    let b = '';
    if (x.check) b += '<span class="bdg">À vérifier</span>';
    if (S.dup.has(+x.id)) b += '<span class="bdg dup">Doublon ?</span>';
    if (x.transmis) b += '<span class="bdg sent">Transmise</span>';
    if (x.pages > 1) b += `<span class="bdg pg">${x.pages} p.</span>`;
    return b;
  }
  function card(x) {
    const pic = x.type === 'km' ? `<div class="pic">${ICON_KM}</div>`
      : x.thumb ? `<div class="pic" style="background-image:url('${thumbUrl(x)}')"></div>`
      : `<div class="pic">${ICON_PDF}</div>`;
    const conv = x.montant_orig != null ? `<small>${eur(x.montant_orig, x.devise)}</small>` : '';
    const sel = S.sel.has(+x.id) ? ' sel' : '';
    const title = esc(x.type === 'km' ? (x.km?.trajet || 'Frais kilométriques') : (x.societe || 'Sans nom'));
    if (S.view === 'list') return `<button class="card${sel}" data-id="${x.id}"><span class="tick"></span>${pic}
      <div class="info"><h3>${title}</h3><div class="meta">${frDate(x.date)}${x.categorie ? ' · ' + esc(x.categorie) : ''}</div></div>
      <div class="right"><div class="mt">${eur(x.montant)}${conv}</div><div class="lbdg">${badges(x)}</div></div></button>`;
    return `<button class="card${sel}" data-id="${x.id}"><span class="tick"></span>${pic.replace('</div>', `<div class="badges">${badges(x)}</div></div>`)}
      <div class="info"><h3>${title}</h3><div class="mt">${eur(x.montant)}${conv}</div><div class="meta">${frDate(x.date)}</div>
      ${x.categorie ? `<span class="cat">${esc(x.categorie)}</span>` : ''}</div></button>`;
  }
  function renderStats() {
    const yr = String(new Date().getFullYear()), prev = String(+yr - 1), today = ymd(new Date()).slice(5);
    const mine = S.items.filter(inTab);
    const tot = (arr) => arr.reduce((s, x) => s + (x.montant || 0), 0);
    const cur = tot(mine.filter(x => x.year === yr));
    const before = tot(mine.filter(x => x.year === prev && dOf(x).slice(5) <= today));
    let cmp = '';
    if (before > 0) { const p = Math.round((cur - before) / before * 100); cmp = `<em class="${p > 0 ? (S.tab === 'vente' ? 'down' : 'up') : (S.tab === 'vente' ? 'up' : 'down')}">${p > 0 ? '+' : ''}${p} % vs ${prev} à date</em>`; }
    const nCheck = mine.filter(x => x.check).length;
    $('#stats').innerHTML = `
      <div class="stat"><b>${mine.length}</b><span>facture${mine.length > 1 ? 's' : ''} ${S.tab === 'vente' ? 'émise' + (mine.length > 1 ? 's' : '') : 'reçue' + (mine.length > 1 ? 's' : '')}</span></div>
      <div class="stat acc"><b>${eur(cur)}</b><span>${S.tab === 'vente' ? 'facturé' : 'dépensé'} en ${yr}</span>${cmp}</div>
      <div class="stat"><b>${nCheck}</b><span>à vérifier</span></div>`;
  }
  function renderFilters() {
    const mine = S.items.filter(inTab);
    const years = [...new Set(mine.map(x => x.year).filter(Boolean))].sort().reverse();
    const nc = mine.filter(x => x.check).length, nd = mine.filter(x => S.dup.has(+x.id)).length, ns = mine.filter(x => !x.transmis).length;
    const chip = (f, label, n, cls = '') => `<button class="chip ${cls}" data-f="${f}" aria-pressed="${S.filter === f}">${label} <small>${n}</small></button>`;
    let h = '';
    if (nc) h += chip('check', 'À vérifier', nc, 'warn');
    if (nd) h += chip('dup', 'Doublons', nd, 'warn');
    h += chip('all', 'Toutes', mine.length);
    for (const y of years) h += chip(y, y, mine.filter(x => x.year === y).length);
    if (mine.length) h += chip('unsent', 'Non transmises', ns);
    $('#filters').innerHTML = h;
  }

  /* ===================== Fiche ===================== */
  let cur = null;
  function fieldHTML(x, ro) {
    const dis = ro ? 'disabled' : '';
    const d = k => (x.doutes || []).includes(k) ? 'doubt' : '';
    if (x.type === 'km') {
      const k = x.km || {};
      const cvs = Object.keys(S.cfg.bareme || { 5: 1 });
      return `<input type="hidden" name="id" value="${x.id}">
        <label class="fld">Date<input name="date" type="date" value="${esc(x.date)}" ${dis}></label>
        <label class="fld">Trajet<input name="trajet" value="${esc(k.trajet || '')}" placeholder="Saint-Denis → Saint-Pierre, tournage Iloha" ${dis}></label>
        <div class="row2"><label class="fld">Distance (km)<input name="distance" inputmode="decimal" value="${k.distance ?? ''}" ${dis}></label>
        <label class="fld">Puissance<select name="cv" ${dis}>${cvs.map(c => `<option value="${c}" ${String(k.cv) === c ? 'selected' : ''}>${c === '7' ? '7 CV et +' : c + ' CV'}</option>`).join('')}</select></label></div>
        <label class="check"><input type="checkbox" name="ar" value="1" ${k.ar ? 'checked' : ''} ${dis}> Aller-retour</label>
        <label class="fld">Note<textarea name="note" rows="2" ${dis}>${esc(x.note)}</textarea></label>
        <p class="conv" id="kmCalc">Montant : <b>${eur(x.montant)}</b> (barème kilométrique)</p>
        ${ro ? '' : `<div class="sheet-foot"><button type="button" class="btn btn-del" data-act="trash">Corbeille</button><button type="submit" class="btn btn-acc">Enregistrer</button></div>`}`;
    }
    const cs = cats(x.sens);
    const vente = x.sens === 'vente';
    return `<input type="hidden" name="id" value="${x.id}">
      <label class="fld">Type<div class="seg" data-seg="sens"><button type="button" data-v="achat" aria-pressed="${!vente}" ${dis}>Reçue (achat)</button><button type="button" data-v="vente" aria-pressed="${vente}" ${dis}>Émise (vente)</button></div></label>
      <input type="hidden" name="sens" value="${vente ? 'vente' : 'achat'}">
      <label class="fld">${vente ? 'Client' : 'Fournisseur'}<input name="societe" list="socList" value="${esc(x.societe)}" class="${d('societe')}" ${dis}></label>
      <div class="row2"><label class="fld">Date<input name="date" type="date" value="${esc(x.date)}" class="${d('date')}" ${dis}></label>
      <label class="fld">Montant TTC<div class="amt"><input name="montant" inputmode="decimal" value="${x.montant_orig != null ? String(x.montant_orig).replace('.', ',') : (x.montant != null ? String(x.montant).replace('.', ',') : '')}" class="${d('montant')}" ${dis}>
        <select name="devise" class="${d('devise')}" ${dis}>${['EUR', 'USD', 'GBP', 'MUR', 'CHF', 'JPY', 'CAD', 'ZAR'].map(c => `<option ${c === x.devise ? 'selected' : ''}>${c}</option>`).join('')}</select></div></label></div>
      ${x.montant_orig != null ? `<p class="conv">= ${eur(x.montant)} au taux du ${frDate(x.date)} (1 € = ${x.taux_change} ${esc(x.devise)})</p>` : ''}
      <div class="row3"><label class="fld">HT<input name="ht" inputmode="decimal" value="${x.ht != null ? String(x.ht).replace('.', ',') : ''}" ${dis}></label>
      <label class="fld">TVA<input name="tva" inputmode="decimal" value="${x.tva != null ? String(x.tva).replace('.', ',') : ''}" ${dis}></label>
      <label class="fld">Taux %<input name="taux_tva" inputmode="decimal" list="tauxList" value="${x.taux_tva != null ? String(x.taux_tva).replace('.', ',') : ''}" ${dis}></label></div>
      <datalist id="tauxList"><option value="8,5"><option value="2,1"><option value="0"><option value="20"><option value="10"><option value="5,5"></datalist>
      <label class="fld">Catégorie<select name="categorie" class="${d('categorie')}" ${dis}><option value="">— Catégorie —</option>${cs.map(c => `<option ${c === x.categorie ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="fld">N° de facture<input name="numero" value="${esc(x.numero)}" ${dis}></label>
      <label class="fld">Note<textarea name="note" rows="2" ${dis}>${esc(x.note)}</textarea></label>
      <label class="check"><input type="checkbox" name="transmis" value="1" ${x.transmis ? 'checked' : ''} ${dis}> Transmise au comptable${x.transmis ? ` <span class="muted">(${frDate(x.transmis.slice(0, 10))})</span>` : ''}</label>
      <label class="check"><input type="checkbox" name="check" value="1" ${x.check ? 'checked' : ''} ${dis}> À vérifier</label>
      ${ro ? '' : `<div class="sheet-foot"><button type="button" class="btn btn-del" data-act="trash">Corbeille</button><button type="submit" class="btn btn-acc">Enregistrer</button></div>`}
      <datalist id="socList">${[...new Set(S.items.filter(y => y.sens === x.sens).map(y => y.societe).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>`;
  }
  function bindForm(form, x) {
    form.querySelectorAll('[data-seg] button').forEach(b => b.onclick = () => {
      const v = b.dataset.v; form.sens.value = v;
      b.parentNode.querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', o === b));
      const sel = form.categorie; const keep = sel.value;
      sel.innerHTML = '<option value="">— Catégorie —</option>' + cats(v).map(c => `<option ${c === keep ? 'selected' : ''}>${esc(c)}</option>`).join('');
      form.querySelector('[name=societe]').closest('label').firstChild.textContent = v === 'vente' ? 'Client' : 'Fournisseur';
    });
    // Catégorie apprise pour ce fournisseur
    const soc = form.querySelector('[name=societe]');
    if (soc) soc.addEventListener('change', () => {
      const l = S.learn.find(e => e.n.toLowerCase() === soc.value.trim().toLowerCase());
      if (l && l.cat && !form.categorie.value) form.categorie.value = l.cat;
    });
    // HT/TVA calculés à partir du TTC et du taux
    const calc = () => {
      const ttc = num(form.montant?.value), tx = num(form.taux_tva?.value);
      if (ttc !== null && tx !== null && form.devise?.value === 'EUR' && !form.ht.value && !form.tva.value) {
        const ht = Math.round(ttc / (1 + tx / 100) * 100) / 100;
        form.ht.value = String(ht).replace('.', ','); form.tva.value = String(Math.round((ttc - ht) * 100) / 100).replace('.', ',');
      }
    };
    if (form.taux_tva) form.taux_tva.addEventListener('change', calc);
    if (x.type === 'km') {
      const upd = () => { const dist = num(form.distance.value) || 0, total = form.ar.checked ? dist * 2 : dist; const el = form.querySelector('#kmCalc'); if (el) el.innerHTML = `Montant : <b>${eur(kmAmount(total, form.cv.value))}</b> (barème kilométrique${form.ar.checked ? ', aller-retour' : ''})`; };
      ['input', 'change'].forEach(ev => form.addEventListener(ev, upd));
    }
  }
  function kmAmount(km, cv) {
    const b = (S.cfg.bareme || {})[cv] || (S.cfg.bareme || {})['5'] || [0.636, 0.357, 1395, 0.427];
    return Math.round((km <= 5000 ? km * b[0] : km <= 20000 ? km * b[1] + b[2] : km * b[3]) * 100) / 100;
  }
  function formData(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') o[el.name] = el.checked ? '1' : '0';
      else o[el.name] = el.value;
    }
    return o;
  }
  async function saveForm(form, x) {
    const o = formData(form);
    const res = x.type === 'km' ? await C.api('km', o) : await C.api('save', o);
    replaceItem(res.item);
    if (x.type !== 'km' && o.societe) { const l = S.learn.find(e => e.n === o.societe); if (l) l.cat = o.categorie || l.cat; else S.learn.push({ n: o.societe, cat: o.categorie, w: [] }); }
    return res.item;
  }
  function replaceItem(it) { const i = S.items.findIndex(y => +y.id === +it.id); if (i >= 0) S.items[i] = it; else S.items.push(it); }
  function sheetView(x) {
    if (x.type === 'km') return `<div class="ph">${ICON_KM}<span>Frais kilométriques — sans pièce</span></div>`;
    if (x.thumb) return `<img src="${x.ext === 'pdf' ? thumbUrl(x) : fileUrl(x)}" alt="">`;
    return `<div class="ph">${ICON_PDF}<span>${x.ext === 'pdf' ? 'Document PDF' : 'Aperçu indisponible'} — touchez pour ouvrir</span></div>`;
  }
  function openSheet(id) {
    const x = byId(id); if (!x) return; cur = x;
    $('#sheetView').innerHTML = sheetView(x);
    $('#sheetTools').hidden = !ADMIN || x.type === 'km';
    $('#sheetTools').querySelectorAll('[data-act^=rot]').forEach(b => b.hidden = !['jpg', 'png', 'webp'].includes(x.ext));
    const f = $('#sheetForm'); f.innerHTML = fieldHTML(x, !ADMIN) + `<p class="sheet-meta">${x.source === 'scan' ? 'Scannée' : x.source === 'partage' ? 'Partagée' : x.source === 'saisie' ? 'Saisie' : 'Importée'} le ${frDate((x.added || '').slice(0, 10))}${x.ext ? ` · <a href="${fileUrl(x, true)}">Télécharger l’original</a>` : ''}${x.dbx ? ' · copiée dans Dropbox' : ''}</p>`;
    bindForm(f, x);
    $('#sheet').hidden = false;
    $('#sheetView').onclick = () => { if (x.type !== 'km') openViewer(visible(), visible().findIndex(y => +y.id === +x.id)); };
  }
  function closeSheet() { $('#sheet').hidden = true; cur = null; }
  $('#sheetForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('[type=submit]'); if (btn) btn.disabled = true;
    try { await saveForm(e.target, cur); render(); closeSheet(); C.toast('Enregistré.', 'ok'); refreshDup(); }
    catch (err) { C.toast(err.message, 'err'); } finally { if (btn) btn.disabled = false; }
  });
  $('#sheetForm').addEventListener('click', e => { if (e.target.closest('[data-act=trash]')) trashOne(cur.id); });
  $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  $('#sheetTools').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || !cur) return;
    const act = b.dataset.act;
    if (act === 'rotl' || act === 'rotr') {
      try { const r = await C.api('rotate', { id: cur.id, deg: act === 'rotl' ? -90 : 90 }); replaceItem(r.item); cur = r.item; $('#sheetView').innerHTML = sheetView(cur); render(); }
      catch (err) { C.toast(err.message, 'err'); }
    }
    if (act === 'replace') $('#replaceInput').click();
    if (act === 'relire') relireForm(cur, $('#sheetForm'));
  });
  $('#replaceInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !cur) return;
    try {
      progress('Préparation du fichier…');
      const prep = await C.prepare(f, { learn: S.learn, onStep: progress });
      const fd = new FormData(); fd.set('id', cur.id); fd.set('file', prep.file, prep.file.name || 'facture');
      if (prep.thumb) fd.set('thumb', prep.thumb, 'thumb.jpg'); fd.set('pages', prep.pages); if (prep.text) fd.set('texte', prep.text);
      const r = await C.api('replace', fd); replaceItem(r.item); cur = r.item; $('#sheetView').innerHTML = sheetView(cur); render();
      C.toast('Fichier remplacé.', 'ok');
    } catch (err) { C.toast(err.message, 'err'); } finally { progress(''); }
  });
  /* Relire une facture (nouvelle lecture automatique) et préremplir le formulaire */
  async function guessFor(x, onStep) {
    const blob = await fetch(fileUrl(x), { credentials: 'same-origin' }).then(r => r.blob());
    const file = new File([blob], 'f.' + x.ext, { type: blob.type || (x.ext === 'pdf' ? 'application/pdf' : 'image/jpeg') });
    return C.prepare(file, { learn: S.learn, onStep });
  }
  async function relireForm(x, form) {
    try {
      progress('Lecture…');
      const p = await guessFor(x, progress);
      const g = p.guess; if (!g) { C.toast('Aucun texte lisible.', 'err'); return; }
      const set = (k, v) => { const el = form.querySelector(`[name=${k}]`); if (el && v != null && v !== '') { el.value = typeof v === 'number' ? String(v).replace('.', ',') : v; el.classList.toggle('doubt', g.doutes.includes(k)); } };
      ['societe', 'date', 'montant', 'devise', 'ht', 'tva', 'taux_tva', 'categorie', 'numero'].forEach(k => set(k, g[k]));
      C.toast('Relue : vérifiez puis enregistrez.', 'ok');
    } catch (err) { C.toast(err.message, 'err'); } finally { progress(''); }
  }

  /* ===================== Visionneuse plein écran (+ revue rapide) ===================== */
  const V = { list: [], i: 0, review: false, z: 1, x: 0, y: 0 };
  function openViewer(list, i, review) {
    V.list = list.filter(x => x.type !== 'km'); if (!V.list.length) return;
    V.i = Math.max(0, Math.min(V.list.length - 1, i < 0 ? 0 : i)); V.review = !!review;
    $('#viewer').hidden = false; $('#viewer').classList.toggle('review', V.review); $('#vForm').hidden = !V.review;
    showV();
  }
  function showV() {
    const x = V.list[V.i]; if (!x) return closeViewer();
    $('#vInfo').textContent = `${V.i + 1} / ${V.list.length} · ${x.societe || 'Sans nom'} · ${frDate(x.date)} · ${eur(x.montant)}`;
    $('#vOpen').href = fileUrl(x);
    const img = $('#vImg'), pdf = $('#vPdf');
    if (x.ext === 'pdf') { img.hidden = true; pdf.hidden = false; pdf.src = fileUrl(x); }
    else { pdf.hidden = true; pdf.src = 'about:blank'; img.hidden = false; img.onload = fitV; img.src = fileUrl(x); }
    $('#vPrev').hidden = V.i === 0; $('#vNext').hidden = V.i >= V.list.length - 1;
    if (V.review) {
      const f = $('#vForm');
      f.innerHTML = `<h3 style="margin:10px 0 0">Revue rapide</h3><p class="muted" style="margin:4px 0 0;font-size:13px">Corrigez si besoin, puis « Valider et suivante ».</p>` +
        fieldHTML(x, false).replace(/<div class="sheet-foot">[\s\S]*?<\/div>/, '') +
        `<div class="sheet-foot"><button type="button" class="btn" id="vLater">Passer</button><button type="submit" class="btn btn-acc">Valider et suivante</button></div>
         <p style="margin-top:10px"><button type="button" class="btn btn-sm" id="vRelire">Relire automatiquement</button></p>`;
      f.querySelector('[name=check]').checked = false;
      bindForm(f, x);
      f.querySelector('#vLater').onclick = () => nextV();
      f.querySelector('#vRelire').onclick = () => relireForm(x, f);
    }
  }
  function fitV() {
    const st = $('#vStage'), img = $('#vImg');
    const k = Math.min(st.clientWidth / img.naturalWidth, st.clientHeight / img.naturalHeight, 1);
    V.z = k; V.x = (st.clientWidth - img.naturalWidth * k) / 2; V.y = (st.clientHeight - img.naturalHeight * k) / 2;
    img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; img.style.width = img.naturalWidth + 'px'; applyV();
  }
  function applyV() { $('#vImg').style.transform = `translate(${V.x}px,${V.y}px) scale(${V.z})`; }
  function zoomV(f, cx, cy) {
    const st = $('#vStage').getBoundingClientRect(); cx = cx ?? st.width / 2; cy = cy ?? st.height / 2;
    const nz = Math.max(0.1, Math.min(8, V.z * f));
    V.x = cx - (cx - V.x) * nz / V.z; V.y = cy - (cy - V.y) * nz / V.z; V.z = nz; applyV();
  }
  function nextV() { if (V.i < V.list.length - 1) { V.i++; showV(); } else { closeViewer(); C.toast(V.review ? 'Revue terminée ✓' : 'Dernière facture.', 'ok'); } }
  function closeViewer() { $('#viewer').hidden = true; $('#vPdf').src = 'about:blank'; render(); }
  $('#vClose').onclick = closeViewer;
  $('#vPrev').onclick = () => { if (V.i > 0) { V.i--; showV(); } };
  $('#vNext').onclick = () => nextV();
  $('#vZoomIn').onclick = () => zoomV(1.4); $('#vZoomOut').onclick = () => zoomV(1 / 1.4);
  (function gestures() {
    const st = $('#vStage'); const pts = new Map(); let last = null, pinch = null, swipe = null;
    st.addEventListener('wheel', e => { e.preventDefault(); const r = st.getBoundingClientRect(); zoomV(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    st.addEventListener('dblclick', e => { const r = st.getBoundingClientRect(); zoomV(2, e.clientX - r.left, e.clientY - r.top); });
    st.addEventListener('pointerdown', e => { pts.set(e.pointerId, e); st.setPointerCapture(e.pointerId); last = { x: e.clientX, y: e.clientY }; swipe = { x: e.clientX, t: Date.now(), z: V.z }; });
    st.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const r = st.getBoundingClientRect(), cx = (a.clientX + b.clientX) / 2 - r.left, cy = (a.clientY + b.clientY) / 2 - r.top;
        if (pinch) zoomV(d / pinch, cx, cy); pinch = d; swipe = null; return;
      }
      if (last) { V.x += e.clientX - last.x; V.y += e.clientY - last.y; applyV(); last = { x: e.clientX, y: e.clientY }; }
    });
    const up = e => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (swipe && pts.size === 0 && Date.now() - swipe.t < 400 && Math.abs(V.z - swipe.z) < 0.01) {
        const dx = e.clientX - swipe.x;
        const st2 = $('#vStage'), img = $('#vImg'), fits = img.naturalWidth * V.z <= st2.clientWidth + 2;
        if (fits && Math.abs(dx) > 60) { dx < 0 ? $('#vNext').click() : $('#vPrev').click(); }
      }
      if (!pts.size) last = null;
    };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
  })();
  $('#vForm').addEventListener('submit', async e => {
    e.preventDefault(); const x = V.list[V.i];
    try { const it = await saveForm(e.target, x); V.list[V.i] = it; nextV(); } catch (err) { C.toast(err.message, 'err'); }
  });

  /* ===================== Sélection multiple ===================== */
  function setSelecting(on) { S.selecting = on; S.sel.clear(); $('#selbar').hidden = !on; updSel(); render(); }
  function updSel() { const n = S.sel.size; $('#selN').textContent = `${n} sélectionnée${n > 1 ? 's' : ''}`; }
  async function bulk(op, val, msg) {
    if (!S.sel.size) return C.toast('Sélectionnez des factures.');
    try { const r = await C.api('bulk', { ids: [...S.sel].join(','), op, val }); C.toast(msg.replace('{n}', r.n), 'ok'); await load(); S.sel.clear(); updSel(); render(); }
    catch (e) { C.toast(e.message, 'err'); }
  }
  if (ADMIN) {
    $('#selBtn').onclick = () => setSelecting(!S.selecting);
    $('#selCancel').onclick = () => setSelecting(false);
    $('#selAll').onclick = () => { const all = visible(); if (S.sel.size === all.length) S.sel.clear(); else all.forEach(x => S.sel.add(+x.id)); updSel(); render(); };
    $('#selCat').onclick = async () => {
      const r = await C.formBox({ title: 'Changer la catégorie', ok: 'Appliquer', fields: [{ name: 'c', label: 'Nouvelle catégorie', type: 'select', options: cats(S.tab === 'vente' ? 'vente' : 'achat') }] });
      if (r) bulk('categorie', r.c, '{n} facture(s) mises à jour.');
    };
    $('#selSent').onclick = () => bulk('transmis', '1', '{n} facture(s) marquées « transmises ».');
    $('#selOk').onclick = () => bulk('check', '0', '{n} facture(s) marquées vérifiées.');
    $('#selTrash').onclick = async () => { if (await C.confirmBox(`Mettre ${S.sel.size} facture(s) à la corbeille ?`, { ok: 'Corbeille', danger: true })) bulk('trash', '1', '{n} facture(s) à la corbeille.'); };
    $('#reviewBtn').onclick = () => openViewer(S.items.filter(x => inTab(x) && x.check).sort((a, b) => dOf(b).localeCompare(dOf(a))), 0, true);
  }

  /* ===================== Corbeille ===================== */
  async function trashOne(id) {
    try {
      await C.api('trash', { id }); S.items = S.items.filter(x => +x.id !== +id); S.trash++;
      closeSheet(); render(); refreshDup();
      C.toast('Mise à la corbeille.', 'ok', { label: 'Annuler', fn: async () => { await C.api('restore', { id }); load(); } });
    } catch (e) { C.toast(e.message, 'err'); }
  }
  async function openTrash() {
    const d = await C.api('trashlist');
    if (!d.items.length) return C.alertBox(`La corbeille est vide. Elle se vide toute seule : chaque facture y reste ${S.cfg.trashDays || 30} jours.`, 'Corbeille');
    const days = x => Math.max(0, (S.cfg.trashDays || 30) - Math.floor((Date.now() - new Date(x.trashed_at || Date.now())) / 864e5));
    await C.dialog({ title: 'Corbeille', wide: true,
      html: `<p class="muted">Chaque facture est supprimée définitivement ${S.cfg.trashDays || 30} jours après sa mise à la corbeille.</p>
        <ul class="tlist">${d.items.map(x => `<li data-id="${x.id}"><span>${esc(x.societe || 'Sans nom')} — ${frDate(x.date)} — ${eur(x.montant)}</span><small class="muted">${days(x)} j</small>
        <button class="btn btn-sm" data-r="1">Restaurer</button><button class="btn btn-sm btn-del" data-del="1">Supprimer</button></li>`).join('')}</ul>`,
      buttons: [{ label: 'Fermer', value: true, primary: true }],
      onOpen: (w) => w.querySelector('.tlist').addEventListener('click', async e => {
        const li = e.target.closest('li'); if (!li) return; const id = li.dataset.id;
        if (e.target.dataset.r) { await C.api('restore', { id }); li.remove(); C.toast('Restaurée.', 'ok'); load(); }
        if (e.target.dataset.del && await C.confirmBox('Supprimer définitivement cette facture ? C’est irréversible.', { ok: 'Supprimer', danger: true })) { await C.api('delete', { id }); li.remove(); }
      }),
    });
    load();
  }

  /* ===================== Import ===================== */
  let progEl, progTxt;
  function progress(txt, pct) {
    if (!txt) { progEl?.remove(); progTxt?.remove(); progEl = progTxt = null; return; }
    if (!progEl) { progEl = document.createElement('div'); progEl.className = 'prog'; progTxt = document.createElement('div'); progTxt.className = 'progtxt'; document.body.append(progEl, progTxt); }
    progTxt.textContent = txt; progEl.style.width = (pct ?? 30) + '%';
  }
  async function handleFiles(files, extra = {}) {
    files = files.filter(f => /^image\/|application\/pdf/.test(f.type) || /\.(heic|heif|pdf)$/i.test(f.name));
    if (!files.length) return;
    let ok = 0, dup = 0;
    for (let i = 0; i < files.length; i++) {
      const pre = files.length > 1 ? `${i + 1}/${files.length} · ` : '';
      try {
        const prep = await C.prepare(files[i], { learn: S.learn, onStep: s => progress(pre + s, (i + 0.5) / files.length * 100) });
        progress(pre + 'Envoi…', (i + 0.9) / files.length * 100);
        const r = await C.api('upload', C.uploadForm(prep, { source: 'import', sens: S.tab === 'vente' ? 'vente' : 'achat', ...extra }));
        ok++; if (r.doublon) dup++;
      } catch (e) { C.toast(`Échec : ${files[i].name} — ${e.message}`, 'err'); }
    }
    progress('');
    C.toast(`${ok} facture${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}${dup ? ` · ${dup} doublon(s) possible(s)` : ''}.`, 'ok');
    await load();
  }
  if (ADMIN) {
    $('#imp').addEventListener('change', e => { handleFiles([...e.target.files]); e.target.value = ''; });
    ['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
    document.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) handleFiles([...e.dataTransfer.files]); });
  }
  async function refreshDup() { try { const d = await C.api('list'); S.dup = new Set(d.doublons || []); S.items = d.items; render(); } catch (e) {} }
  /* Factures reçues par « Partager » : lues automatiquement à l'ouverture */
  async function relireShared(ids) {
    for (let i = 0; i < ids.length; i++) {
      const x = byId(ids[i]); if (!x || x.source !== 'partage' || x.societe) continue;
      try {
        const p = await guessFor(x, s => progress(`${i + 1}/${ids.length} · ${s}`, (i + 0.5) / ids.length * 100));
        const g = p.guess; if (!g) continue;
        const o = { id: x.id, check: '1' };
        for (const k of ['societe', 'date', 'montant', 'devise', 'ht', 'tva', 'taux_tva', 'categorie', 'numero']) if (g[k] !== null && g[k] !== undefined && g[k] !== '') o[k] = g[k];
        const r = await C.api('save', o); replaceItem(r.item);
      } catch (e) { console.warn(e); }
    }
    progress(''); render(); C.toast(`${ids.length} facture(s) reçue(s) par partage, à vérifier.`, 'ok');
  }

  /* ===================== Frais kilométriques ===================== */
  async function addKm() {
    const cvs = Object.keys(S.cfg.bareme || {});
    const r = await C.formBox({ title: 'Frais kilométriques', ok: 'Ajouter',
      intro: 'Trajet fait avec votre véhicule personnel pour l’activité. Montant calculé avec le barème kilométrique.',
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: ymd(new Date()) },
        { name: 'trajet', label: 'Trajet', placeholder: 'Saint-Denis → Saint-Pierre, tournage Iloha' },
        { name: 'distance', label: 'Distance aller (km)', inputmode: 'decimal' },
        { name: 'ar', label: 'Aller-retour ?', type: 'select', options: ['Oui', 'Non'], value: 'Oui' },
        { name: 'cv', label: 'Puissance fiscale', type: 'select', options: cvs.map(c => c + ' CV'), value: (localStorage.getItem('flp-cv') || '5') + ' CV' },
        { name: 'note', label: 'Note', type: 'textarea' },
      ] });
    if (!r) return;
    const cv = r.cv.replace(/\D/g, ''); try { localStorage.setItem('flp-cv', cv); } catch (e) {}
    try { const res = await C.api('km', { date: r.date, trajet: r.trajet, distance: r.distance, ar: r.ar === 'Oui' ? '1' : '0', cv, note: r.note }); S.items.push(res.item); render(); C.toast(`Ajouté : ${eur(res.item.montant)}.`, 'ok'); }
    catch (e) { C.toast(e.message, 'err'); }
  }

  /* ===================== Exports pour le comptable ===================== */
  function periodOf(key) {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth();
    const f = (a, b) => ({ from: ymd(a), to: ymd(b) });
    const D = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd));
    if (key === 'month') return f(D(y, m, 1), D(y, m + 1, 0));
    if (key === 'lastmonth') return f(D(y, m - 1, 1), D(y, m, 0));
    if (key === 'quarter') { const q = Math.floor(m / 3) * 3; return f(D(y, q, 1), D(y, q + 3, 0)); }
    if (key === 'lastquarter') { const q = Math.floor(m / 3) * 3 - 3; return f(D(y, q, 1), D(y, q + 3, 0)); }
    if (key === 'year') return f(D(y, 0, 1), D(y, 11, 31));
    if (key === 'lastyear') return f(D(y - 1, 0, 1), D(y - 1, 11, 31));
    return { from: '', to: '' };
  }
  async function openExport() {
    const p0 = periodOf('lastmonth');
    const r = await C.dialog({ title: 'Exporter pour le comptable', wide: true,
      html: `<label class="fld">Période<select name="per">
          <option value="lastmonth">Mois dernier</option><option value="month">Ce mois</option><option value="lastquarter">Trimestre dernier</option>
          <option value="quarter">Ce trimestre</option><option value="lastyear">Année dernière</option><option value="year">Cette année</option><option value="custom">Dates au choix</option><option value="all">Tout</option></select></label>
        <div class="row2"><label class="fld">Du<input type="date" name="from" value="${p0.from}"></label><label class="fld">Au<input type="date" name="to" value="${p0.to}"></label></div>
        <label class="fld">Factures<select name="sens"><option value="">Reçues et émises</option><option value="achat">Reçues seulement</option><option value="vente">Émises seulement</option></select></label>
        <label class="fld">Format<select name="fmt">
          <option value="zip">ZIP : toutes les pièces renommées + tableau</option><option value="xlsx">Excel (.xlsx)</option>
          <option value="pdf">PDF récapitulatif (totaux par catégorie)</option><option value="csv">CSV</option></select></label>
        ${ADMIN ? '<label class="check"><input type="checkbox" name="mark" value="1" checked> Marquer ces factures « transmises au comptable »</label>' : ''}
        <p class="muted" id="exN" style="margin-top:12px"></p>`,
      buttons: [{ label: 'Annuler', value: null }, { label: 'Exporter', primary: true, value: w => { const o = {}; w.querySelectorAll('[name]').forEach(el => o[el.name] = el.type === 'checkbox' ? el.checked : el.value); return o; } }],
      onOpen: w => {
        const per = w.querySelector('[name=per]'), from = w.querySelector('[name=from]'), to = w.querySelector('[name=to]');
        const count = () => { const L = exportItems(from.value, to.value, w.querySelector('[name=sens]').value); w.querySelector('#exN').textContent = `${L.length} facture(s) · ${eur(L.reduce((s, x) => s + (x.montant || 0), 0))}`; };
        per.onchange = () => { if (per.value !== 'custom') { const p = periodOf(per.value); from.value = p.from; to.value = p.to; } count(); };
        [from, to, w.querySelector('[name=sens]')].forEach(el => el.addEventListener('change', () => { if (el !== w.querySelector('[name=sens]')) per.value = 'custom'; count(); }));
        count();
      } });
    if (!r) return;
    const list = exportItems(r.from, r.to, r.sens);
    if (!list.length) return C.toast('Aucune facture sur cette période.', 'err');
    const label = `${r.from || 'debut'}_${r.to || 'fin'}`;
    try {
      if (r.fmt === 'zip') {
        const qs = new URLSearchParams({ a: 'zip', from: r.from, to: r.to, sens: r.sens });
        location.href = `${API}?${qs}`;
        if (r.mark && ADMIN) { const ids = list.filter(x => !x.transmis).map(x => x.id); if (ids.length) { await C.api('bulk', { ids: ids.join(','), op: 'transmis', val: '1' }); load(); } }
        return C.toast('Préparation du ZIP… le téléchargement va démarrer.', 'ok');
      }
      progress('Préparation de l’export…');
      if (r.fmt === 'xlsx') await exportXlsx(list, label);
      else if (r.fmt === 'pdf') await exportPdf(list, label, r);
      else exportCsv(list, label);
      if (r.mark && ADMIN) { const ids = list.filter(x => !x.transmis).map(x => x.id); if (ids.length) { await C.api('bulk', { ids: ids.join(','), op: 'transmis', val: '1' }); load(); } }
      C.toast('Export téléchargé.', 'ok');
    } catch (e) { C.toast(e.message, 'err'); } finally { progress(''); }
  }
  function exportItems(from, to, sens) {
    return S.items.filter(x => (!sens || (sens === 'vente' ? x.sens === 'vente' : x.sens !== 'vente')) && (!from || dOf(x) >= from) && (!to || dOf(x) <= to))
      .sort((a, b) => dOf(a).localeCompare(dOf(b)));
  }
  const rowsOf = list => list.map(x => ({
    'Sens': x.sens === 'vente' ? 'Émise' : 'Reçue', 'Date': x.date, 'Fournisseur / client': x.societe, 'N°': x.numero, 'Catégorie': x.categorie,
    'HT': x.ht, 'TVA': x.tva, 'Taux TVA %': x.taux_tva, 'TTC (EUR)': x.montant, 'Devise': x.devise, 'Montant devise': x.montant_orig,
    'Note': [x.note, x.km ? `${x.km.trajet} (${x.km.distance} km${x.km.ar ? ' A/R' : ''}, ${x.km.cv} CV)` : ''].filter(Boolean).join(' — '),
    'Transmise': x.transmis ? x.transmis.slice(0, 10) : '', 'Fichier': x.filename || '',
  }));
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function exportCsv(list, label) {
    const rows = rowsOf(list), head = Object.keys(rows[0]);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`, n = v => typeof v === 'number' ? String(v).replace('.', ',') : v;
    const csv = [head.map(cell).join(';'), ...rows.map(r => head.map(h => cell(n(r[h]))).join(';'))].join('\r\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `factures-flp_${label}.csv`);
  }
  async function exportXlsx(list, label) {
    const X = await C.lib('xlsx');
    const rows = rowsOf(list);
    const ws = X.utils.json_to_sheet(rows);
    ws['!cols'] = [8, 11, 28, 14, 26, 10, 10, 9, 11, 7, 12, 40, 11, 36].map(w => ({ wch: w }));
    const range = X.utils.decode_range(ws['!ref']);
    for (let r = 1; r <= range.e.r; r++) for (const c of [5, 6, 8, 10]) { const a = X.utils.encode_cell({ r, c }); if (ws[a] && typeof ws[a].v === 'number') ws[a].z = '#,##0.00'; }
    ws['!autofilter'] = { ref: ws['!ref'] };
    const byCat = {};
    for (const x of list) { const k = `${x.sens === 'vente' ? 'Émise' : 'Reçue'} — ${x.categorie || 'Sans catégorie'}`; const o = byCat[k] || (byCat[k] = { 'Catégorie': k, 'Nombre': 0, 'HT': 0, 'TVA': 0, 'TTC (EUR)': 0 }); o['Nombre']++; o['HT'] += x.ht || 0; o['TVA'] += x.tva || 0; o['TTC (EUR)'] += x.montant || 0; }
    const sum = Object.values(byCat).map(o => ({ ...o, HT: +o.HT.toFixed(2), TVA: +o.TVA.toFixed(2), 'TTC (EUR)': +o['TTC (EUR)'].toFixed(2) }));
    const ws2 = X.utils.json_to_sheet(sum); ws2['!cols'] = [{ wch: 44 }, { wch: 9 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Factures'); X.utils.book_append_sheet(wb, ws2, 'Totaux par catégorie');
    X.writeFile(wb, `factures-flp_${label}.xlsx`);
  }
  async function exportPdf(list, label, r) {
    const { jsPDF } = await C.lib('jspdf'); await C.lib('autotable');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const money = v => v == null ? '' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v).replace(/ | /g, ' ');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Fabrice Lau Production — récapitulatif des factures', 14, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Période : ${r.from ? frDate(r.from) : 'début'} au ${r.to ? frDate(r.to) : 'aujourd’hui'} · ${list.length} facture(s) · édité le ${frDate(ymd(new Date()))}`, 14, 25);
    let y = 32;
    for (const sens of ['achat', 'vente']) {
      const L = list.filter(x => sens === 'vente' ? x.sens === 'vente' : x.sens !== 'vente'); if (!L.length) continue;
      const g = {}; L.forEach(x => { const k = x.categorie || 'Sans catégorie'; const o = g[k] || (g[k] = [0, 0, 0, 0]); o[0]++; o[1] += x.ht || 0; o[2] += x.tva || 0; o[3] += x.montant || 0; });
      const tot = Object.values(g).reduce((a, o) => [a[0] + o[0], a[1] + o[1], a[2] + o[2], a[3] + o[3]], [0, 0, 0, 0]);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(sens === 'vente' ? 'Factures émises — totaux par catégorie' : 'Factures reçues — totaux par catégorie', 14, y);
      doc.autoTable({ startY: y + 3, head: [['Catégorie', 'Nb', 'HT', 'TVA', 'TTC']], body: Object.entries(g).sort((a, b) => b[1][3] - a[1][3]).map(([k, o]) => [k, o[0], money(o[1]), money(o[2]), money(o[3])]),
        foot: [['Total', tot[0], money(tot[1]), money(tot[2]), money(tot[3])]], theme: 'grid', headStyles: { fillColor: [29, 34, 38] }, footStyles: { fillColor: [235, 230, 222], textColor: 20 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }, styles: { fontSize: 9 } });
      y = doc.lastAutoTable.finalY + 10;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Détail', 14, y);
    doc.autoTable({ startY: y + 3, head: [['Date', 'Sens', 'Fournisseur / client', 'Catégorie', 'N°', 'HT', 'TVA', 'TTC']],
      body: list.map(x => [frDate(x.date), x.sens === 'vente' ? 'Émise' : 'Reçue', x.societe || '', x.categorie || '', x.numero || '', money(x.ht), money(x.tva), money(x.montant)]),
      theme: 'striped', headStyles: { fillColor: [29, 34, 38] }, styles: { fontSize: 8, cellPadding: 1.6 },
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } } });
    doc.save(`recapitulatif-factures-flp_${label}.pdf`);
  }

  /* ===================== Tableau de bord ===================== */
  function renderBord() {
    const Y = S.bordYear, P = String(+Y - 1);
    const years = [...new Set(S.items.map(x => x.year).filter(Boolean).concat([String(new Date().getFullYear())]))].sort().reverse();
    const ach = S.items.filter(x => x.sens !== 'vente'), ven = S.items.filter(x => x.sens === 'vente');
    const sumBy = (arr, y) => { const m = new Array(12).fill(0); arr.forEach(x => { if (x.year === y && x.date) m[+x.date.slice(5, 7) - 1] += x.montant || 0; }); return m; };
    const aY = sumBy(ach, Y), aP = sumBy(ach, P), vY = sumBy(ven, Y);
    const tot = a => a.reduce((s, v) => s + v, 0);
    const lastM = Y === String(new Date().getFullYear()) ? new Date().getMonth() : 11;
    const aPtodate = aP.slice(0, lastM + 1).reduce((s, v) => s + v, 0), aYt = tot(aY);
    const delta = aPtodate > 0 ? Math.round((aYt - aPtodate) / aPtodate * 100) : null;
    const group = (arr, key) => { const g = {}; arr.forEach(x => { if (x.year !== Y) return; const k = x[key] || 'Sans ' + (key === 'societe' ? 'nom' : 'catégorie'); g[k] = (g[k] || 0) + (x.montant || 0); }); return Object.entries(g).sort((a, b) => b[1] - a[1]); };
    const bars = (rows, n = 10) => { const top = rows.slice(0, n), max = Math.max(1, ...top.map(r => r[1])); return top.length ? `<div class="bars">${top.map(([k, v]) => `<div class="row"><span title="${esc(k)}">${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div><span class="v">${eur(v)}</span></div>`).join('')}</div>` : '<p class="muted">Rien sur cette année.</p>'; };
    const vat = ach.filter(x => x.year === Y).reduce((s, x) => s + (x.tva || 0), 0);
    $('#bordView').innerHTML = `
      <div class="bord-head"><h2>Tableau de bord</h2><select id="bordYear" class="btn">${years.map(y => `<option ${y === Y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
      <div class="stats" style="padding:8px 0 0">
        <div class="stat acc"><b>${eur(aYt)}</b><span>dépensé en ${Y}</span>${delta !== null ? `<em class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta} % vs ${P} à date</em>` : ''}</div>
        <div class="stat"><b>${eur(tot(vY))}</b><span>facturé en ${Y}</span></div>
        <div class="stat"><b>${eur(vat)}</b><span>TVA payée sur les achats ${Y}</span></div>
        <div class="stat"><b>${ach.filter(x => x.year === Y).length}</b><span>factures reçues en ${Y}</span></div>
      </div>
      <div class="panel"><h3>Dépenses par mois</h3><p class="lead">${Y} comparé à ${P}.</p><div class="chart">${monthChart(aY, aP, Y, P)}</div>
        <div class="legend"><span><i style="background:var(--acc)"></i>${Y}</span><span><i style="background:var(--line2)"></i>${P}</span></div></div>
      ${tot(vY) ? `<div class="panel"><h3>Facturé par mois</h3><p class="lead">Chiffre d’affaires ${Y} (factures émises).</p><div class="chart">${monthChart(vY, sumBy(ven, P), Y, P)}</div></div>` : ''}
      <div class="grid2">
        <div class="panel"><h3>Dépenses par catégorie</h3><p class="lead">${Y}</p>${bars(group(ach, 'categorie'), 13)}</div>
        <div class="panel"><h3>Principaux fournisseurs</h3><p class="lead">${Y}</p>${bars(group(ach, 'societe'))}</div>
        ${ven.some(x => x.year === Y) ? `<div class="panel"><h3>Principaux clients</h3><p class="lead">${Y}</p>${bars(group(ven, 'societe'))}</div>` : ''}
      </div>`;
    $('#bordYear').onchange = e => { S.bordYear = e.target.value; renderBord(); };
  }
  function monthChart(cur, prev, Y, P) {
    const W = 720, H = 240, L = 54, B = 26, T = 10, max = Math.max(1, ...cur, ...prev);
    const step = niceStep(max), top = Math.ceil(max / step) * step;
    const cw = (W - L - 8) / 12, bw = Math.min(16, cw / 2.6);
    const y = v => T + (H - T - B) * (1 - v / top);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dépenses par mois ${Y} et ${P}">`;
    for (let v = 0; v <= top + 1e-6; v += step) s += `<line x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`;
    for (let m = 0; m < 12; m++) {
      const cx = L + cw * m + cw / 2;
      s += `<rect x="${cx - bw - 1}" y="${y(prev[m])}" width="${bw}" height="${Math.max(0, H - B - y(prev[m]))}" rx="2" fill="var(--line2)"><title>${MOIS[m + 1]} ${P} : ${eur(prev[m])}</title></rect>`;
      s += `<rect x="${cx + 1}" y="${y(cur[m])}" width="${bw}" height="${Math.max(0, H - B - y(cur[m]))}" rx="2" fill="var(--acc)"><title>${MOIS[m + 1]} ${Y} : ${eur(cur[m])}</title></rect>`;
      s += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${MOIS[m + 1].slice(0, 3)}</text>`;
    }
    return s + '</svg>';
  }
  function niceStep(max) { const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function short(v) { return v >= 1000 ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€' : Math.round(v) + ' €'; }

  /* ===================== Réglages ===================== */
  async function openSettings(focus) {
    let s;
    try { s = (await C.api('settings_get')).s; } catch (e) { return C.toast(e.message, 'err'); }
    const redirect = location.origin + BASE + 'dropbox.php';
    await C.dialog({ title: 'Réglages', wide: true, buttons: [{ label: 'Fermer', value: true, primary: true }],
      html: `
      <h4>Mise à jour de l’appli</h4>
      <div class="box"><div id="updState">${s.github_repo ? 'Version installée : <code>' + esc(s.version || 'première') + '</code>' : 'Pas encore reliée à GitHub.'}</div>
        <label class="chk" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="gAuto" ${s.github_auto ? 'checked' : ''}> Mettre à jour automatiquement (vérifié quand vous ouvrez l’appli)</label>
        ${s.maj_auto ? `<small class="muted">Dernière mise à jour automatique : ${esc(new Date(s.maj_auto.quand).toLocaleString('fr-FR'))} — ${esc(s.maj_auto.msg)}</small>` : ''}
        <div class="line"><button class="btn btn-sm" id="updCheck" ${s.github_repo ? '' : 'disabled'}>Vérifier</button><button class="btn btn-sm btn-acc" id="updRun" hidden>Mettre à jour</button></div></div>
      <details ${s.github_repo ? '' : 'open'}><summary class="muted" style="margin-top:8px;cursor:pointer">Liaison GitHub</summary>
        <label class="fld">Dépôt (compte/nom)<input id="gRepo" value="${esc(s.github_repo)}" placeholder="votre-compte/factures-flp"></label>
        <div class="row2"><label class="fld">Branche<input id="gBranch" value="${esc(s.github_branch)}"></label>
        <label class="fld">Jeton d’accès (lecture seule)<input id="gToken" type="password" placeholder="${s.github_token ? '•••••• enregistré' : 'github_pat_…'}" autocomplete="off"></label></div>
        <div class="line"><button class="btn btn-sm" id="gSave">Enregistrer</button></div></details>

      <h4>Dropbox</h4>
      <div class="box">${s.dropbox_on ? `<span class="ok-txt">Connecté</span> à ${esc(s.dropbox_account)} — dossier <code>${esc(s.dropbox_folder)}</code>. Chaque facture et la sauvegarde du jour y sont copiées automatiquement.` : 'Non connecté. Une fois connecté, chaque facture est copiée dans votre Dropbox, rangée par année, avec la sauvegarde quotidienne.'}
        <div class="line">${s.dropbox_on ? '<button class="btn btn-sm" id="dSync">Copier maintenant</button><button class="btn btn-sm btn-del" id="dOff">Déconnecter</button>' : `<button class="btn btn-sm btn-acc" id="dOn" ${s.dropbox_key && s.dropbox_secret ? '' : 'disabled'}>Connecter Dropbox</button>`}</div></div>
      ${s.dropbox_on ? '' : `<details ${s.dropbox_key ? '' : 'open'}><summary class="muted" style="margin-top:8px;cursor:pointer">Clés de l’application Dropbox</summary>
        <div class="box"><ol><li>Ouvrez <b>dropbox.com/developers/apps</b> → « Create app ».</li><li>Choisissez « Scoped access » puis « App folder », nommez-la (ex. <i>Factures FLP</i>).</li>
        <li>Onglet <b>Permissions</b> : cochez <code>files.content.write</code> et <code>files.content.read</code>, puis « Submit ».</li>
        <li>Onglet <b>Settings</b> : dans « Redirect URIs », ajoutez <code>${esc(redirect)}</code>.</li><li>Copiez « App key » et « App secret » ci-dessous, enregistrez, puis « Connecter Dropbox ».</li></ol></div>
        <div class="row2"><label class="fld">App key<input id="dKey" value="${esc(s.dropbox_key)}" autocomplete="off"></label>
        <label class="fld">App secret<input id="dSecret" type="password" placeholder="${s.dropbox_secret ? '•••••• enregistré' : ''}" autocomplete="off"></label></div>
        <label class="fld">Dossier dans Dropbox<input id="dFolder" value="${esc(s.dropbox_folder)}"></label>
        <div class="line"><button class="btn btn-sm" id="dSave">Enregistrer</button></div></details>`}

      <h4>Sauvegardes</h4>
      <div class="box">Sauvegarde automatique chaque jour (les ${s.backups} dernières sont gardées, la plus récente : <code>${esc(s.last_backup || 'pas encore')}</code>)${s.dropbox_on ? ', copiée dans Dropbox' : ''}.
        <div class="line"><a class="btn btn-sm" href="${API}?a=backup">Télécharger toute ma sauvegarde</a><small class="muted">factures + données, en un fichier ZIP</small></div></div>

      <h4>Accès comptable</h4>
      <div class="box">${s.compta ? '<span class="ok-txt">Activé.</span> Votre comptable se connecte sur la même adresse avec son propre mot de passe : il voit et exporte tout, sans rien pouvoir modifier.' : 'Donnez à votre comptable un mot de passe à lui : il pourra consulter et exporter, sans rien modifier.'}
        <div class="line"><input id="cPass" type="password" placeholder="${s.compta ? 'Nouveau mot de passe comptable' : 'Mot de passe du comptable (8 caractères min.)'}" autocomplete="new-password" style="flex:1;min-width:200px;background:var(--ink2);border:1px solid var(--line);color:var(--bone);border-radius:8px;padding:9px 11px">
        <button class="btn btn-sm" id="cSave">${s.compta ? 'Changer' : 'Activer'}</button>${s.compta ? '<button class="btn btn-sm btn-del" id="cOff">Retirer l’accès</button>' : ''}</div>
        <p class="muted" style="margin:8px 0 0">Adresse à lui donner : <code>${esc(location.origin + BASE)}</code></p></div>

      <h4>Votre compte</h4>
      <div class="box"><label class="fld" style="margin-top:0">E-mail (mot de passe oublié)<input id="sEmail" type="email" value="${esc(s.email)}"></label>
        <div class="line"><button class="btn btn-sm" id="sSave">Enregistrer</button><button class="btn btn-sm" id="pChange">Changer mon mot de passe</button></div></div>`,
      onOpen: (w, close) => {
        const q = s => w.querySelector(s);
        const save = async (data, msg) => { try { await C.api('settings', data); C.toast(msg || 'Enregistré.', 'ok'); close(true); openSettings(); } catch (e) { C.toast(e.message, 'err'); } };
        q('#gAuto') && (q('#gAuto').onchange = () => save({ github_auto: q('#gAuto').checked ? '1' : '0' }, q('#gAuto').checked ? 'Mises à jour automatiques activées.' : 'Mises à jour automatiques coupées.'));
        q('#gSave') && (q('#gSave').onclick = () => save({ github_repo: q('#gRepo').value.trim(), github_branch: q('#gBranch').value.trim() || 'main', github_token: q('#gToken').value.trim() }, 'Liaison GitHub enregistrée.'));
        q('#updCheck') && (q('#updCheck').onclick = async () => {
          q('#updState').textContent = 'Vérification…';
          const r = await C.api('update_check', null, { quiet: true });
          if (!r.ok) { q('#updState').innerHTML = `<span class="err-txt">${esc(r.msg)}</span>`; return; }
          if (r.up_to_date) { q('#updState').innerHTML = `<span class="ok-txt">À jour</span> — version <code>${esc(r.current)}</code>.`; return; }
          q('#updState').innerHTML = `Nouvelle version disponible : <b>${esc(r.message || r.latest.slice(0, 7))}</b>${r.date ? ` <span class="muted">(${frDate(r.date.slice(0, 10))})</span>` : ''}.`;
          q('#updRun').hidden = false;
        });
        q('#updRun') && (q('#updRun').onclick = async () => {
          q('#updRun').disabled = true; q('#updState').textContent = 'Installation… (ne fermez pas la page)';
          const r = await C.api('update_run', {}, { quiet: true }).catch(e => ({ ok: false, msg: e.message }));
          if (!r.ok) { q('#updState').innerHTML = `<span class="err-txt">${esc(r.msg)}</span>`; q('#updRun').disabled = false; return; }
          q('#updState').innerHTML = `<span class="ok-txt">${esc(r.msg)}</span>`;
          setTimeout(() => location.reload(), 1500);
        });
        q('#dSave') && (q('#dSave').onclick = () => save({ dropbox_key: q('#dKey').value.trim(), dropbox_secret: q('#dSecret').value.trim(), dropbox_folder: q('#dFolder').value.trim() }, 'Clés Dropbox enregistrées.'));
        q('#dOn') && (q('#dOn').onclick = () => { location.href = BASE + 'dropbox.php?start=1'; });
        q('#dOff') && (q('#dOff').onclick = async () => { if (await C.confirmBox('Déconnecter Dropbox ? Les fichiers déjà copiés y restent.', { ok: 'Déconnecter', danger: true })) save({ dropbox_off: '1' }, 'Dropbox déconnecté.'); });
        q('#dSync') && (q('#dSync').onclick = async () => { q('#dSync').disabled = true; q('#dSync').textContent = 'Copie en cours…'; try { const r = await C.api('dropbox_sync'); C.toast(r.msg, 'ok'); } catch (e) { C.toast(e.message, 'err'); } q('#dSync').disabled = false; q('#dSync').textContent = 'Copier maintenant'; });
        q('#cSave').onclick = () => { const p = q('#cPass').value; if (p.length < 8) return C.toast('8 caractères minimum.', 'err'); save({ compta: p }, 'Accès comptable enregistré.'); };
        q('#cOff') && (q('#cOff').onclick = () => save({ compta: '' }, 'Accès comptable retiré.'));
        q('#sSave').onclick = () => save({ email: q('#sEmail').value.trim() }, 'E-mail enregistré.');
        q('#pChange').onclick = async () => {
          const r = await C.formBox({ title: 'Changer mon mot de passe', ok: 'Changer', fields: [
            { name: 'old', label: 'Mot de passe actuel', type: 'password', auto: 'current-password' },
            { name: 'new', label: 'Nouveau mot de passe (8 caractères min.)', type: 'password', auto: 'new-password' },
            { name: 'new2', label: 'Confirmez', type: 'password', auto: 'new-password' }] });
          if (!r) return; if (r.new !== r.new2) return C.toast('Les deux mots de passe diffèrent.', 'err');
          try { const j = await C.api('password', { old: r.old, new: r.new }); C.toast(j.msg, 'ok'); } catch (e) { C.toast(e.message, 'err'); }
        };
      } });
  }

  /* ===================== Menu, onglets, événements ===================== */
  function setTab(t) {
    S.tab = t; S.filter = 'all'; S.adv = { cat: '', soc: '', min: '', max: '', from: '', to: '' };
    $$('#tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
    if (S.selecting) setSelecting(false);
    ['fMin', 'fMax', 'fFrom', 'fTo'].forEach(id => $('#' + id).value = '');
    if (t !== 'bord') fillAdv();
    render();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  const menu = $('#menu');
  $('#menuBtn').onclick = () => { $('#trashN') && ($('#trashN').textContent = S.trash || ''); $('#themeLabel').textContent = document.documentElement.dataset.theme === 'light' ? 'Thème sombre' : 'Thème clair'; menu.hidden = false; };
  menu.addEventListener('click', e => {
    if (e.target.closest('[data-mclose]')) { menu.hidden = true; return; }
    const b = e.target.closest('[data-m]'); if (!b) return; menu.hidden = true;
    ({ km: addKm, export: openExport, trash: openTrash, settings: () => openSettings(),
       theme: () => C.theme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'),
       logout: async () => { try { await C.api('logout', {}); } catch (e) {} try { await caches.delete('flp-donnees'); } catch (e) {} location.href = BASE; } })[b.dataset.m]?.();
  });
  $('#app').addEventListener('click', e => {
    const c = e.target.closest('.card');
    if (c) {
      if (S.selecting) { const id = +c.dataset.id; S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); c.classList.toggle('sel'); updSel(); return; }
      return openSheet(c.dataset.id);
    }
    const h = e.target.closest('.month-h');
    if (h) { const k = h.parentElement.dataset.k; S.closed[k] = !S.closed[k]; h.parentElement.classList.toggle('closed'); }
  });
  let qT; $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value; render(); }, 160); });
  $('#filters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { S.filter = b.dataset.f; render(); } });
  $('#sort').value = S.sort;
  $('#sort').addEventListener('change', e => { S.sort = e.target.value; saveUi(); render(); });
  const setView = v => { S.view = v; saveUi(); $('#vGrid').classList.toggle('on', v === 'grid'); $('#vList').classList.toggle('on', v === 'list'); render(); };
  $('#vGrid').onclick = () => setView('grid'); $('#vList').onclick = () => setView('list');
  setView(S.view);
  $('#advBtn').onclick = () => { const a = $('#adv'); a.hidden = !a.hidden; $('#advBtn').setAttribute('aria-expanded', !a.hidden); };
  [['fCat', 'cat'], ['fSoc', 'soc'], ['fMin', 'min'], ['fMax', 'max'], ['fFrom', 'from'], ['fTo', 'to']].forEach(([id, k]) =>
    $('#' + id).addEventListener(id.startsWith('fM') ? 'input' : 'change', e => { S.adv[k] = e.target.value; render(); }));
  $('.adv-quick').addEventListener('click', e => {
    const b = e.target.closest('[data-per]'); if (!b) return;
    if (b.dataset.per === 'clear') { S.adv = { cat: '', soc: '', min: '', max: '', from: '', to: '' }; ['fMin', 'fMax', 'fFrom', 'fTo'].forEach(id => $('#' + id).value = ''); fillAdv(); }
    else { const p = periodOf(b.dataset.per); S.adv.from = p.from; S.adv.to = p.to; $('#fFrom').value = p.from; $('#fTo').value = p.to; }
    render();
  });
  document.addEventListener('keydown', e => {
    if (document.querySelector('.dlg')) return;
    if (!$('#viewer').hidden) {
      if (e.target.closest && e.target.closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight') $('#vNext').click(); if (e.key === 'ArrowLeft') $('#vPrev').click(); if (e.key === 'Escape') closeViewer(); return;
    }
    if (e.key === 'Escape') { closeSheet(); menu.hidden = true; if (S.selecting) setSelecting(false); }
  });

  /* Retours (Dropbox, partage) */
  async function hashActions() {
    const h = location.hash;
    if (h.startsWith('#reglages')) {
      history.replaceState(null, '', location.pathname);
      const m = { '-dropbox-ok': ['Dropbox connecté ✓', 'ok'], '-dropbox-erreur': ['La connexion à Dropbox a échoué. Vérifiez les clés et l’adresse de retour.', 'err'],
        '-dropbox-refus': ['Connexion Dropbox annulée.', ''], '-dropbox-cle': ['Enregistrez d’abord la clé et le secret Dropbox.', 'err'] }[h.slice(9)];
      if (m) C.toast(m[0], m[1]);
      if (ADMIN) openSettings();
    }
    if (h === '#partage' && ADMIN) {
      history.replaceState(null, '', location.pathname);
      try { const r = await C.api('partage', {}); if (r.ids && r.ids.length) relireShared(r.ids); } catch (e) {}
    }
  }
  /* Petit point dans le menu quand une mise à jour est disponible */
  async function checkUpdateQuietly() {
    try {
      const last = +(localStorage.getItem('flp-upd-check') || 0); if (Date.now() - last < 6 * 3600e3) return;
      localStorage.setItem('flp-upd-check', Date.now());
      const r = await C.api('update_check', null, { quiet: true });
      if (r.ok && !r.up_to_date) $('#updDot').textContent = '•';
    } catch (e) {}
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register(BASE + 'sw.js').catch(() => {});
  load().then(() => { hashActions(); if (ADMIN) checkUpdateQuietly(); });
})();
