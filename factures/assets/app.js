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
    items: [], cfg: { categories: [], categories_ventes: [], categories_docs: [], bareme: {} }, learn: [], societes: [], dup: new Set(), trash: 0,
    tab: 'achat', q: '', filter: 'all', adv: { cat: '', soc: '', min: '', max: '', from: '', to: '' },
    sort: 'date-desc', view: 'grid', closed: {}, selecting: false, sel: new Set(), bordYear: String(new Date().getFullYear()),
  };
  try { const v = JSON.parse(localStorage.getItem('flp-ui') || '{}'); if (v.view) S.view = v.view; if (v.sort) S.sort = v.sort; } catch (e) {}
  const saveUi = () => { try { localStorage.setItem('flp-ui', JSON.stringify({ view: S.view, sort: S.sort })); } catch (e) {} };
  const byId = id => S.items.find(x => +x.id === +id);
  const cats = sens => sens === 'vente' ? S.cfg.categories_ventes : sens === 'doc' ? (S.cfg.categories_docs || []) : S.cfg.categories;
  const isDoc = x => x.sens === 'doc', isBank = x => x.sens === 'banque', isAchat = x => x.sens !== 'vente' && x.sens !== 'doc' && x.sens !== 'banque';
  const sensLabel = x => x.sens === 'vente' ? 'Émise' : x.sens === 'doc' ? 'Document' : x.sens === 'banque' ? 'Relevé' : 'Reçue';
  const thumbUrl = x => `${API}?a=thumb&id=${x.id}&r=${x.rot || 0}`;
  // adresse « parlante » : le fichier s'ouvre et se télécharge sous son vrai nom (date_fournisseur_montant.pdf)
  const fmt2 = v => v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ',');   // 68,1 → 68,10
  const fileName = x => x.filename || `facture-${x.id}.${x.ext || 'pdf'}`;
  const fileUrl = (x, dl) => `${BASE}f/${x.id}/${encodeURIComponent(fileName(x))}?r=${x.rot || 0}${dl ? '&dl=1' : ''}`;
  const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
  const ymd = d => d.toISOString().slice(0, 10);
  // « à vérifier » = pas encore validée par vous (case verte) ; les frais km, saisis à la main, n'en ont pas besoin
  const todo = x => x.type !== 'km' && x.sens !== 'doc' && x.sens !== 'banque' && !x.verifie;
  const dOf = x => x.date || (x.added || '').slice(0, 10);

  /* ===================== Chargement ===================== */
  async function load() {
    try {
      const d = await C.api('list');
      S.bank = null;   // opérations bancaires rechargées à la prochaine ouverture de l'onglet Relevés
      Object.assign(S, { items: d.items, cfg: d.cfg, learn: d.learn || [], societes: d.societes || [], dup: new Set(d.doublons || []), trash: d.trash || 0 });
      fillAdv(); render();
      setOffline(d.offline);
      if (!d.offline) prefetchThumbs();
      // nouvelle version installée automatiquement depuis la dernière visite
      try { const v = d.cfg.version || '', was = localStorage.getItem('flp-version'); if (v) { if (was && was !== v) C.toast('Appli mise à jour automatiquement ✓', 'ok'); localStorage.setItem('flp-version', v); } } catch (x) {}
    } catch (e) { if (e.message !== 'auth') $('#app').innerHTML = `<p class="empty">Impossible de charger les factures. ${esc(e.message)}</p>`; }
  }

  /* ===================== Export d'une seule facture ===================== */
  // iPhone : feuille de partage (Enregistrer dans Fichiers, Mail, AirDrop, WhatsApp…) ; ailleurs : téléchargement
  async function shareOne(x) {
    try {
      progress('Préparation…');
      const blob = await fetch(fileUrl(x), { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error('Fichier introuvable.'); return r.blob(); });
      const name = fileName(x);
      const file = new File([blob], name, { type: blob.type || (x.ext === 'pdf' ? 'application/pdf' : 'image/jpeg') });
      progress('');
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== 'AbortError') throw e; }
        return;
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    } catch (e) { progress(''); C.toast(e.message || 'Export impossible.', 'err'); }
  }
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.dl[data-share]')) { e.preventDefault(); e.stopPropagation(); e.target.click(); } }, true);
  document.addEventListener('click', e => { if (S.selecting) return; const b = e.target.closest('[data-share]'); if (!b) return; e.preventDefault(); const x = S.items.find(i => +i.id === +b.dataset.share); if (x) shareOne(x); });

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
  function inTab(x) { return S.tab === 'vente' ? x.sens === 'vente' : S.tab === 'doc' ? isDoc(x) : S.tab === 'banque' ? isBank(x) : isAchat(x); }
  function visible() {
    const a = S.adv, min = num(a.min), max = num(a.max);
    let r = S.items.filter(inTab);
    if (S.filter === 'check') r = r.filter(todo);
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
        // texte de recherche calculé une seule fois par facture (et recalculé si elle change)
        const key = x.societe + '|' + x.date + '|' + x.numero + '|' + x.categorie + '|' + x.note + '|' + (x.texte || '').length;
        if (x._k !== key) { x._k = key; x._h = [x.societe, x.date, frDate(x.date), x.numero, x.categorie, x.note, x.texte, x.km && x.km.trajet].join(' ').toLowerCase(); }
        return x._h.includes(q) || (qn !== null && x.montant !== null && Math.abs(x.montant - qn) < 0.005);
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
    const cs = cats(S.tab === 'vente' ? 'vente' : S.tab === 'doc' ? 'doc' : 'achat');
    $('#fCat').innerHTML = '<option value="">Toutes</option>' + cs.map(c => `<option ${c === S.adv.cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const socs = [...new Set(S.items.filter(inTab).map(x => x.societe).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    $('#fSoc').innerHTML = '<option value="">Tous</option>' + socs.map(c => `<option ${c === S.adv.soc ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#fSocLabel').textContent = S.tab === 'vente' ? 'Client' : S.tab === 'doc' ? 'Titre' : 'Fournisseur';
  }

  /* ===================== Rendu de la liste ===================== */
  function render() {
    $('#bankView').hidden = S.tab !== 'banque';
    if (S.tab === 'banque') { $('#listView').hidden = true; $('#bordView').hidden = true; renderBank(); return; }
    if (S.tab === 'bord') { $('#listView').hidden = true; $('#bordView').hidden = false; renderBord(); return; }
    $('#listView').hidden = false; $('#bordView').hidden = true;
    renderStats(); renderFilters();
    const n = advCount(); $('#advN').textContent = n || ''; $('#advBtn').classList.toggle('on', !!n);
    const rb = $('#reviewBtn'); if (rb) { const k = S.items.filter(x => inTab(x) && todo(x)).length; rb.hidden = !k; rb.textContent = `Revue rapide (${k})`; }
    document.body.classList.toggle('selecting', S.selecting);
    const list = visible(), app = $('#app');
    if (!list.length) {
      const none = !S.items.some(inTab);
      app.innerHTML = `<p class="empty">${none ? (S.tab === 'doc' ? 'Aucun document pour l’instant. Contrats, devis, assurances, garanties… : importez-les avec « Importer », ou photographiez-les en choisissant « Document » dans l’appli photo.' : S.tab === 'vente' ? 'Aucune facture émise pour l’instant. Importez vos factures de vente avec « Importer », puis basculez-les en « Émise » dans leur fiche.' : 'Aucune facture pour l’instant. Scannez-en une depuis votre téléphone ou importez un fichier.') : 'Aucune facture ne correspond.'}</p>`;
      return;
    }
    const cls = S.view === 'list' ? 'cards list' : 'cards';
    // les factures pas encore validées par vous attendent tout en bas, dans « À vérifier »
    const waiting = list.filter(todo), done = list.filter(x => !todo(x));
    const waitHtml = waiting.length ? `<section class="month todo-sec${S.closed.todo ? ' closed' : ''}" data-k="todo">
          <div class="month-h"><h2><span class="vdot todo"></span> À vérifier</h2><span class="n">${waiting.length} facture${waiting.length > 1 ? 's' : ''}</span>
          <span class="tot">${eur(waiting.reduce((t, x) => t + (x.montant || 0), 0))}</span><svg class="car" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div>
          <p class="todo-help">Ouvrez chaque facture, contrôlez-la, puis cochez la case verte « Vérifiée » : elle rejoint son mois.</p>
          <div class="${cls}">${waiting.slice().sort((a, b) => dOf(b).localeCompare(dOf(a)) || b.id - a.id).map(card).join('')}</div></section>` : '';
    if (S.sort.startsWith('date')) {
      const groups = new Map();
      for (const x of done) { const k = dOf(x).slice(0, 7) || '0000-00'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
      let html = '';
      for (const [k, g] of groups) {
        const tot = g.reduce((s, x) => s + (x.montant || 0), 0);
        const [y, m] = k.split('-');
        html += `<section class="month${S.closed[k] ? ' closed' : ''}" data-k="${k}">
          <div class="month-h"><h2>${k === '0000-00' ? 'Sans date' : MOIS[+m] + ' ' + y}</h2><span class="n">${g.length} ${S.tab === 'doc' ? 'document' : 'facture'}${g.length > 1 ? 's' : ''}</span>
          ${S.tab === 'doc' ? '<span class="tot"></span>' : `<span class="tot">${eur(tot)}</span>`}<svg class="car" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div>
          <div class="${cls}">${g.map(card).join('')}</div></section>`;
      }
      app.innerHTML = html + waitHtml;
    } else app.innerHTML = (done.length ? `<div class="${cls}" style="margin-top:14px">${done.map(card).join('')}</div>` : '') + waitHtml;
  }
  function badges(x) {
    let b = '';
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
    // icône de téléchargement de la facture seule (élément « bouton » dans la carte, qui est elle-même un bouton)
    const dl = x.ext ? `<span class="dl" role="button" tabindex="0" data-share="${x.id}" title="Télécharger cette facture" aria-label="Télécharger ${title}"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></span>` : '<span class="dl dl-none"></span>';
    if (S.view === 'list') return `<button class="card${sel}" data-id="${x.id}"><span class="tick"></span>
      <div class="info"><h3>${title}</h3><div class="meta">${frDate(x.date)}${x.categorie ? ' · ' + esc(x.categorie) : ''}</div></div>
      <div class="right">${isDoc(x) ? '' : `<div class="mt">${eur(x.montant)}${conv}</div>`}<div class="lbdg">${badges(x)}</div></div>${x.verifie ? '<span class="vdot" title="Vérifiée par vous"></span>' : todo(x) ? '<span class="vdot todo" title="À vérifier"></span>' : '<span class="vdot off"></span>'}${dl}</button>`;
    return `<button class="card${sel}" data-id="${x.id}"><span class="tick"></span>${pic.replace('</div>', `<div class="badges">${badges(x)}</div></div>`)}
      <div class="info"><h3>${title}${x.verifie ? ' <span class="vdot" title="Vérifiée par vous"></span>' : todo(x) ? ' <span class="vdot todo" title="À vérifier"></span>' : ''}</h3>${isDoc(x) ? '' : `<div class="mt">${eur(x.montant)}${conv}</div>`}<div class="meta">${frDate(x.date)}</div>
      ${x.categorie ? `<span class="cat">${esc(x.categorie)}</span>` : ''}</div>${dl}</button>`;
  }
  function renderStats() {
    const yr = String(new Date().getFullYear()), prev = String(+yr - 1), today = ymd(new Date()).slice(5);
    const mine = S.items.filter(inTab);
    const tot = (arr) => arr.reduce((s, x) => s + (x.montant || 0), 0);
    const cur = tot(mine.filter(x => x.year === yr));
    const before = tot(mine.filter(x => x.year === prev && dOf(x).slice(5) <= today));
    let cmp = '';
    if (before > 0) { const p = Math.round((cur - before) / before * 100); cmp = `<em class="${p > 0 ? (S.tab === 'vente' ? 'down' : 'up') : (S.tab === 'vente' ? 'up' : 'down')}">${p > 0 ? '+' : ''}${p} % vs ${prev} à date</em>`; }
    const nCheck = mine.filter(todo).length;
    if (S.tab === 'doc') {
      const last = mine.map(x => (x.added || '').slice(0, 10)).sort().pop();
      const nc = new Set(mine.map(x => x.categorie).filter(Boolean)).size;
      $('#stats').innerHTML = `<div class="stat"><b>${mine.length}</b><span>document${mine.length > 1 ? 's' : ''}</span></div>
        <div class="stat acc"><b>${mine.filter(x => x.year === yr).length}</b><span>en ${yr}</span></div>
        <div class="stat"><b>${last ? frDate(last).slice(0, 5) : '—'}</b><span>dernier ajout${nc ? ' · ' + nc + ' catégorie' + (nc > 1 ? 's' : '') : ''}</span></div>`;
      return;
    }
    $('#stats').innerHTML = `
      <div class="stat"><b>${mine.length}</b><span>facture${mine.length > 1 ? 's' : ''} ${S.tab === 'vente' ? 'émise' + (mine.length > 1 ? 's' : '') : 'reçue' + (mine.length > 1 ? 's' : '')}</span></div>
      <div class="stat acc"><b>${eur(cur)}</b><span>${S.tab === 'vente' ? 'facturé' : 'dépensé'} en ${yr}</span>${cmp}</div>
      <div class="stat"><b>${nCheck}</b><span>à vérifier</span></div>`;
  }
  function renderFilters() {
    const mine = S.items.filter(inTab);
    const years = [...new Set(mine.map(x => x.year).filter(Boolean))].sort().reverse();
    const nc = mine.filter(todo).length, nd = mine.filter(x => S.dup.has(+x.id)).length, ns = mine.filter(x => !x.transmis).length;
    const chip = (f, label, n, cls = '') => `<button class="chip ${cls}" data-f="${f}" aria-pressed="${S.filter === f}">${label} <small>${n}</small></button>`;
    let h = '';
    if (nc) h += chip('check', 'À vérifier', nc, 'warn');
    if (nd) h += chip('dup', 'Doublons', nd, 'warn');
    h += chip('all', 'Toutes', mine.length);
    for (const y of years) h += chip(y, y, mine.filter(x => x.year === y).length);
    if (mine.length && S.tab !== 'doc') h += chip('unsent', 'Non transmises', ns);
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
    const vente = x.sens === 'vente', doc = x.sens === 'doc' || x.sens === 'banque', bank = x.sens === 'banque';
    return `<input type="hidden" name="id" value="${x.id}">
      <label class="fld"${bank ? ' hidden' : ''}>Type<div class="seg seg3" data-seg="sens"><button type="button" data-v="achat" aria-pressed="${!vente && !doc}" ${dis}>Reçue</button><button type="button" data-v="vente" aria-pressed="${vente}" ${dis}>Émise</button><button type="button" data-v="doc" aria-pressed="${doc}" ${dis}>Document</button></div></label>
      <input type="hidden" name="sens" value="${['vente', 'doc', 'banque'].includes(x.sens) ? x.sens : 'achat'}">
      <label class="fld">${doc ? 'Titre' : vente ? 'Client' : 'Fournisseur'}<input name="societe" list="socList" value="${esc(x.societe)}" class="${d('societe')}" ${dis}></label>
      <div class="money-only">
      <label class="fld fld-ttc">Montant TTC<div class="amt"><input name="montant" inputmode="decimal" value="${fmt2(x.montant_orig != null ? x.montant_orig : x.montant)}" class="${d('montant')}" ${dis}>
        <select name="devise" class="${d('devise')}" ${dis}>${['EUR', 'USD', 'GBP', 'MUR', 'CHF', 'JPY', 'CAD', 'ZAR'].map(c => `<option ${c === x.devise ? 'selected' : ''}>${c}</option>`).join('')}</select></div></label>
      </div>
      <label class="fld">Date<input name="date" type="date" value="${esc(x.date)}" class="${d('date')}" ${dis}></label>
      <div class="money-only">${x.montant_orig != null ? `<p class="conv">= ${eur(x.montant)} au taux du ${frDate(x.date)} (1 € = ${x.taux_change} ${esc(x.devise)})</p>` : ''}
      <div class="row3"><label class="fld">HT<input name="ht" inputmode="decimal" value="${fmt2(x.ht)}" ${dis}></label>
      <label class="fld">TVA<input name="tva" inputmode="decimal" value="${fmt2(x.tva)}" ${dis}></label>
      <label class="fld">Taux %<input name="taux_tva" inputmode="decimal" list="tauxList" value="${x.taux_tva != null ? String(x.taux_tva).replace('.', ',') : ''}" ${dis}></label></div>
      <datalist id="tauxList"><option value="8,5"><option value="2,1"><option value="0"><option value="20"><option value="10"><option value="5,5"></datalist></div>
      <label class="fld">Catégorie<select name="categorie" class="${d('categorie')}" ${dis}><option value="">— Catégorie —</option>${cs.map(c => `<option ${c === x.categorie ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="fld">${doc ? 'Référence' : 'N° de facture'}<input name="numero" value="${esc(x.numero)}" ${dis}></label>
      <label class="fld">Note<textarea name="note" rows="2" ${dis}>${esc(x.note)}</textarea></label>
      <div class="money-only"><label class="check"><input type="checkbox" name="transmis" value="1" ${x.transmis ? 'checked' : ''} ${dis}> Transmise au comptable${x.transmis ? ` <span class="muted">(${frDate(x.transmis.slice(0, 10))})</span>` : ''}</label>
      <label class="verif${x.verifie ? ' on' : ''}"><input type="checkbox" name="verifie" value="1" ${x.verifie ? 'checked' : ''} ${dis}><span class="vbox"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span><b>Vérifiée</b><small>${x.verifie ? `par vous le ${frDate(String(x.verifie).slice(0, 10))}` : 'cochez quand vous avez contrôlé la facture vous-même'}</small></span></label></div>
      ${ro ? '' : `<div class="sheet-foot"><button type="button" class="btn btn-del" data-act="trash">Corbeille</button><button type="submit" class="btn btn-acc">Enregistrer</button></div>`}
      <datalist id="socList">${[...new Set(S.items.filter(y => y.sens === x.sens).map(y => y.societe).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>`;
  }
  function bindForm(form, x) {
    form.classList.toggle('is-doc', x.sens === 'doc' || x.sens === 'banque');
    form.querySelectorAll('[data-seg] button').forEach(b => b.onclick = () => {
      const v = b.dataset.v; form.sens.value = v;
      b.parentNode.querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', o === b));
      const sel = form.categorie; const keep = sel.value;
      sel.innerHTML = '<option value="">— Catégorie —</option>' + cats(v).map(c => `<option ${c === keep ? 'selected' : ''}>${esc(c)}</option>`).join('');
      form.querySelector('[name=societe]').closest('label').firstChild.textContent = v === 'vente' ? 'Client' : v === 'doc' ? 'Titre' : 'Fournisseur';
      form.classList.toggle('is-doc', v === 'doc');
      const num = form.querySelector('[name=numero]'); if (num) num.closest('label').firstChild.textContent = v === 'doc' ? 'Référence' : 'N° de facture';
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
  document.addEventListener('change', e => {
    if (e.target.name === 'verifie') { const f = e.target.form; e.target.closest('.verif').classList.toggle('on', e.target.checked); }
  });
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
    $('#sheetTools').querySelectorAll('[data-act^=rot]').forEach(b => b.hidden = !['jpg', 'png', 'webp', 'pdf'].includes(x.ext));
    const f = $('#sheetForm'); f.innerHTML = (x.verifie ? `<div class="vpill"><span class="vdot"></span>Vérifiée par vous le ${frDate(String(x.verifie).slice(0, 10))}</div>` : '') + (x.ext ? `<button type="button" class="btn btn-share" data-share="${x.id}"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Exporter cette facture</button>` : '') + fieldHTML(x, !ADMIN) + `<p class="sheet-meta">${x.source === 'scan' ? 'Scannée' : x.source === 'partage' ? 'Partagée' : x.source === 'dropbox' ? 'Importée depuis Dropbox' : x.source === 'saisie' ? 'Saisie' : 'Importée'} le ${frDate((x.added || '').slice(0, 10))}${x.ext ? ` · <a href="${fileUrl(x, true)}">Télécharger</a>` : ''}${x.dbx ? ' · copiée dans Dropbox' : ''}</p>`;
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
    if (act === 'addpage') $('#addPageInput').click();
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
  /* Ajouter une ou plusieurs pages (photo ou PDF) à la fin de la facture : un seul PDF en sortie */
  $('#addPageInput').addEventListener('change', async e => {
    const add = [...e.target.files]; e.target.value = ''; if (!add.length || !cur) return;
    const x = cur;
    try {
      progress('Lecture de la facture actuelle…');
      const pages = []; let text = x.texte || '';
      if (x.ext) {
        const blob = await fetch(fileUrl(x), { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error('Fichier actuel introuvable.'); return r.blob(); });
        const curFile = new File([blob], 'actuel.' + x.ext, { type: blob.type || (x.ext === 'pdf' ? 'application/pdf' : 'image/jpeg') });
        if (x.ext === 'pdf') { const r = await C.pdfPages(curFile); if (r.total > r.canvases.length) throw new Error(`Facture de plus de ${r.canvases.length} pages : ajout impossible ici.`); pages.push(...r.canvases); }
        else pages.push(await C.imageCanvas(curFile));
      }
      const before = pages.length;
      for (let i = 0; i < add.length; i++) {
        progress(`Ajout ${i + 1}/${add.length}…`);
        const f = add[i];
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { const r = await C.pdfPages(f); pages.push(...r.canvases); if (r.text) text += '\n' + r.text; }
        else pages.push(await C.imageCanvas(f));
      }
      if (pages.length > 60) throw new Error('60 pages maximum.');
      progress('Création du PDF…');
      const pdf = await C.toPdf(pages, 'facture.pdf', 0.85);
      const fd = new FormData(); fd.set('id', x.id); fd.set('file', pdf, 'facture.pdf'); fd.set('pages', pages.length);
      const th = await C.thumbOf(pages[0]); if (th) fd.set('thumb', th, 'thumb.jpg');
      if (text) fd.set('texte', text.slice(0, 20000));
      progress('Envoi…');
      const r = await C.api('replace', fd); replaceItem(r.item); cur = r.item; $('#sheetView').innerHTML = sheetView(cur); render();
      const n = pages.length - before;
      C.toast(`${n} page${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} — la facture compte maintenant ${pages.length} pages.`, 'ok');
    } catch (err) { C.toast(err.message || 'Ajout impossible.', 'err'); } finally { progress(''); }
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
      const r = await C.formBox({ title: 'Changer la catégorie', ok: 'Appliquer', fields: [{ name: 'c', label: 'Nouvelle catégorie', type: 'select', options: cats(S.tab === 'vente' ? 'vente' : S.tab === 'doc' ? 'doc' : 'achat') }] });
      if (r) bulk('categorie', r.c, '{n} facture(s) mises à jour.');
    };
    $('#selSent').onclick = () => bulk('transmis', '1', '{n} facture(s) marquées « transmises ».');
    $('#selOk').onclick = () => bulk('check', '0', '{n} facture(s) marquées vérifiées.');
    $('#selTrash').onclick = async () => { if (await C.confirmBox(`Mettre ${S.sel.size} facture(s) à la corbeille ?`, { ok: 'Corbeille', danger: true })) bulk('trash', '1', '{n} facture(s) à la corbeille.'); };
    $('#reviewBtn').onclick = () => openViewer(S.items.filter(x => inTab(x) && todo(x)).sort((a, b) => dOf(b).localeCompare(dOf(a))), 0, true);
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
    if (S.tab === 'banque') return bankImport(files, extra);
    files = files.filter(f => /^image\/|application\/pdf/.test(f.type) || /\.(heic|heif|pdf)$/i.test(f.name));
    if (!files.length) return;
    let ok = 0, dup = 0;
    for (let i = 0; i < files.length; i++) {
      const pre = files.length > 1 ? `${i + 1}/${files.length} · ` : '';
      try {
        const prep = await C.prepare(files[i], { learn: S.learn, onStep: s => progress(pre + s, (i + 0.5) / files.length * 100) });
        progress(pre + 'Envoi…', (i + 0.9) / files.length * 100);
        const r = await C.api('upload', C.uploadForm(prep, { source: 'import', sens: S.tab === 'vente' ? 'vente' : S.tab === 'doc' ? 'doc' : 'achat', ...extra }));
        ok++; if (r.doublon) dup++;
      } catch (e) { C.toast(`Échec : ${files[i].name} — ${e.message}`, 'err'); }
    }
    progress('');
    C.toast(`${ok} facture${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}${dup ? ` · ${dup} doublon(s) possible(s)` : ''}.`, 'ok');
    await load();
  }
  /* ===================== Importer : depuis l'iPhone ou directement depuis Dropbox ===================== */
  if (ADMIN) $('#impBtn').addEventListener('click', () => {
    const inp = S.tab === 'banque' ? $('#bankInput') : $('#imp');
    if (!S.cfg || !S.cfg.dropbox) { inp.click(); return; }      // Dropbox pas relié : sélecteur de fichiers direct
    const w = document.createElement('div'); w.className = 'dlg';
    w.innerHTML = `<div class="dlg-bg"></div><div class="dlg-box imp-choice" role="dialog" aria-modal="true"><h3>Importer</h3>
      <div class="imp-opts">
        <label class="imp-opt" for="${S.tab === 'banque' ? 'bankInput' : 'imp'}"><svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg><b>Depuis l’iPhone</b><span>Photos, Fichiers</span></label>
        <button type="button" class="imp-opt" id="impDbx"><svg viewBox="0 0 24 24"><path d="M7 3l5 3.2L7 9.4 2 6.2zM17 3l5 3.2-5 3.2-5-3.2zM2 12.6l5-3.2 5 3.2-5 3.2zM22 12.6l-5-3.2-5 3.2 5 3.2zM7 17l5 3.2 5-3.2-5-3.2z"/></svg><b>Depuis Dropbox</b><span>Vos dossiers</span></button>
      </div><div class="dlg-foot"><button type="button" class="btn" data-x>Annuler</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    w.querySelector('.dlg-bg').onclick = close; w.querySelector('[data-x]').onclick = close;
    w.querySelector('label.imp-opt').addEventListener('click', () => setTimeout(close, 50));   // le sélecteur de l'iPhone s'ouvre (même geste)
    w.querySelector('#impDbx').onclick = () => { close(); openDropboxPicker(); };
  });
  async function openDropboxPicker() {
    let path = ''; try { path = localStorage.getItem('flp-dbx-path') || ''; } catch (e) {}
    const chosen = new Map();
    const r = await C.dialog({ title: 'Importer depuis Dropbox', wide: true,
      html: `<div class="dbx-crumbs" id="dbxCrumbs"></div><div class="dbx-list" id="dbxList"><p class="muted">Chargement…</p></div>`,
      buttons: [{ label: 'Annuler', value: null }, { label: 'Importer', primary: true, value: () => [...chosen.values()] }],
      onOpen: w => {
        const okBtn = w.querySelector('.dlg-foot .btn-acc');
        const upd = () => { okBtn.textContent = chosen.size ? `Importer (${chosen.size})` : 'Importer'; okBtn.disabled = !chosen.size; };
        const show = async p => {
          path = p; try { localStorage.setItem('flp-dbx-path', p); } catch (e) {}
          const parts = p.split('/').filter(Boolean);
          w.querySelector('#dbxCrumbs').innerHTML = `<button type="button" data-go="">Dropbox</button>` + parts.map((n, i) => `<span>›</span><button type="button" data-go="/${esc(parts.slice(0, i + 1).join('/'))}">${esc(n)}</button>`).join('');
          const L = w.querySelector('#dbxList'); L.innerHTML = '<p class="muted">Chargement…</p>';
          let j; try { j = await C.api('dbx_list', null, { qs: '&path=' + encodeURIComponent(p) }); }
          catch (e) { if (p) return show(''); L.innerHTML = `<p class="err-txt">${esc(e.message)}</p>`; return; }
          if (path !== p) return;
          if (!j.items.length) { L.innerHTML = '<p class="muted">Aucune photo ni PDF dans ce dossier.</p>'; return; }
          L.innerHTML = j.items.map(it => it.t === 'd'
            ? `<button type="button" class="dbx-it dir" data-go="${esc(it.p)}"><svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><b>${esc(it.n)}</b><svg class="go" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`
            : `<button type="button" class="dbx-it file${chosen.has(it.p) ? ' on' : ''}" data-f="${esc(it.p)}" data-n="${esc(it.n)}"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><b>${esc(it.n)}</b><small>${it.d ? frDate(it.d) + ' · ' : ''}${Math.max(1, Math.round(it.s / 1024))} Ko</small><span class="ck"></span></button>`).join('');
        };
        w.addEventListener('click', e => {
          const g = e.target.closest('[data-go]'); if (g) { show(g.dataset.go); return; }
          const f = e.target.closest('[data-f]'); if (!f) return;
          if (chosen.has(f.dataset.f)) chosen.delete(f.dataset.f); else chosen.set(f.dataset.f, { p: f.dataset.f, n: f.dataset.n });
          f.classList.toggle('on', chosen.has(f.dataset.f)); upd();
        });
        upd(); show(path);
      } });
    if (!r || !r.length) return;
    const files = [];
    for (let i = 0; i < r.length; i++) {
      progress(`${i + 1}/${r.length} · Récupération dans Dropbox…`, (i + 0.5) / r.length * 30);
      try {
        const res = await fetch(`${API}?a=dbx_get&path=${encodeURIComponent(r[i].p)}`, { credentials: 'same-origin' });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.msg || 'Téléchargement impossible.'); }
        const b = await res.blob();
        const type = /\.hei[cf]$/i.test(r[i].n) ? 'image/heic' : /\.(csv|ofx|qfx|qif)$/i.test(r[i].n) ? 'text/plain' : (b.type || (/\.pdf$/i.test(r[i].n) ? 'application/pdf' : 'image/jpeg'));
        files.push(new File([b], r[i].n, { type }));
      } catch (e) { C.toast(`${r[i].n} : ${e.message}`, 'err'); }
    }
    progress('');
    if (files.length) handleFiles(files, { source: 'dropbox' });
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
  async function openExport(pre = {}) {
    const p0 = pre.from ? pre : periodOf('lastmonth');
    const years = [...new Set(S.items.map(x => dOf(x).slice(0, 4)).filter(Boolean))].sort().reverse();
    if (!years.length) years.push(String(new Date().getFullYear()));
    const now = new Date(), curMon = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const r = await C.dialog({ title: 'Exporter pour le comptable', wide: true,
      html: `<label class="fld">Période<select name="per">
          <option value="pickmonth">Un mois au choix</option><option value="pickyear">Une année entière</option>
          <option value="lastmonth">Mois dernier</option><option value="month">Ce mois</option><option value="lastquarter">Trimestre dernier</option>
          <option value="quarter">Ce trimestre</option><option value="lastyear">Année dernière</option><option value="year">Cette année</option><option value="custom">Dates au choix</option><option value="all">Tout</option></select></label>
        <label class="fld" id="exMon">Mois<input type="month" name="mon" value="${pre.mon || curMon}"></label>
        <label class="fld" id="exYr">Année<select name="yr">${years.map(y => `<option ${y === pre.yr ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <div class="row2" id="exDates"><label class="fld">Du<input type="date" name="from" value="${p0.from}"></label><label class="fld">Au<input type="date" name="to" value="${p0.to}"></label></div>
        <label class="fld">Factures<select name="sens"><option value="">Reçues et émises</option><option value="achat">Reçues seulement</option><option value="vente">Émises seulement</option><option value="doc">Documents</option></select></label>
        <label class="fld">Format<select name="fmt">
          <option value="zip">ZIP : toutes les pièces renommées + tableau</option><option value="xlsx">Excel (.xlsx)</option>
          <option value="pdf">PDF récapitulatif (totaux par catégorie)</option><option value="csv">CSV</option></select></label>
        ${ADMIN ? '<label class="check"><input type="checkbox" name="mark" value="1" checked> Marquer ces factures « transmises au comptable »</label>' : ''}
        <p class="muted" id="exN" style="margin-top:12px"></p>`,
      buttons: [{ label: 'Annuler', value: null }, { label: 'Exporter', primary: true, value: w => { const o = {}; w.querySelectorAll('[name]').forEach(el => o[el.name] = el.type === 'checkbox' ? el.checked : el.value); return o; } }],
      onOpen: w => {
        const per = w.querySelector('[name=per]'), from = w.querySelector('[name=from]'), to = w.querySelector('[name=to]');
        const count = () => { const L = exportItems(from.value, to.value, w.querySelector('[name=sens]').value); w.querySelector('#exN').textContent = `${L.length} facture(s) · ${eur(L.reduce((s, x) => s + (x.montant || 0), 0))}`; };
        const mon = w.querySelector('[name=mon]'), yr = w.querySelector('[name=yr]');
        const vis = () => { w.querySelector('#exMon').hidden = per.value !== 'pickmonth'; w.querySelector('#exYr').hidden = per.value !== 'pickyear'; w.querySelector('#exDates').hidden = per.value === 'pickmonth' || per.value === 'pickyear'; };
        const fromMon = () => { const [y, m] = (mon.value || curMon).split('-').map(Number); from.value = ymd(new Date(Date.UTC(y, m - 1, 1))); to.value = ymd(new Date(Date.UTC(y, m, 0))); };
        const fromYr = () => { from.value = yr.value + '-01-01'; to.value = yr.value + '-12-31'; };
        per.onchange = () => { if (per.value === 'pickmonth') fromMon(); else if (per.value === 'pickyear') fromYr(); else if (per.value !== 'custom') { const p = periodOf(per.value); from.value = p.from; to.value = p.to; } vis(); count(); };
        mon.onchange = () => { fromMon(); count(); }; yr.onchange = () => { fromYr(); count(); };
        per.value = pre.per || 'pickmonth'; if (!pre.from) { if (per.value === 'pickmonth') fromMon(); } vis();
        [from, to, w.querySelector('[name=sens]')].forEach(el => el.addEventListener('change', () => { if (el !== w.querySelector('[name=sens]')) per.value = 'custom'; count(); }));
        count();
      } });
    if (!r) return;
    const list = exportItems(r.from, r.to, r.sens);
    if (!list.length) return C.toast('Aucune facture sur cette période.', 'err');
    const label = r.per === 'pickmonth' ? (r.mon || r.from.slice(0, 7)) : r.per === 'pickyear' ? r.yr : `${r.from || 'debut'}_${r.to || 'fin'}`;
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
    return S.items.filter(x => (sens === 'doc' ? isDoc(x) : !isDoc(x) && !isBank(x) && (!sens || (sens === 'vente' ? x.sens === 'vente' : isAchat(x)))) && (!from || dOf(x) >= from) && (!to || dOf(x) <= to))
      .sort((a, b) => dOf(a).localeCompare(dOf(b)));
  }
  const rowsOf = list => list.map(x => ({
    'Sens': sensLabel(x), 'Date': x.date, 'Fournisseur / client': x.societe, 'N°': x.numero, 'Catégorie': x.categorie,
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
    for (const x of list) { const k = `${sensLabel(x)} — ${x.categorie || 'Sans catégorie'}`; const o = byCat[k] || (byCat[k] = { 'Catégorie': k, 'Nombre': 0, 'HT': 0, 'TVA': 0, 'TTC (EUR)': 0 }); o['Nombre']++; o['HT'] += x.ht || 0; o['TVA'] += x.tva || 0; o['TTC (EUR)'] += x.montant || 0; }
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
      const L = list.filter(x => sens === 'vente' ? x.sens === 'vente' : isAchat(x)); if (!L.length) continue;
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
      body: list.map(x => [frDate(x.date), sensLabel(x), x.societe || '', x.categorie || '', x.numero || '', money(x.ht), money(x.tva), money(x.montant)]),
      theme: 'striped', headStyles: { fillColor: [29, 34, 38] }, styles: { fontSize: 8, cellPadding: 1.6 },
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } } });
    doc.save(`recapitulatif-factures-flp_${label}.pdf`);
  }

  /* ===================== Tableau de bord ===================== */
  function renderBord() {
    const Y = S.bordYear, P = String(+Y - 1);
    const years = [...new Set(S.items.map(x => x.year).filter(Boolean).concat([String(new Date().getFullYear())]))].sort().reverse();
    const ach = S.items.filter(isAchat), ven = S.items.filter(x => x.sens === 'vente');
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
      <div class="box">${s.dropbox_on ? `<span class="ok-txt">Connecté</span> à ${esc(s.dropbox_account)}. ${s.dropbox_when === 'tout' ? 'Chaque facture' : 'Chaque facture <b>vérifiée</b>'} est copiée dans <code>${esc(s.dropbox_folder)}</code>, rangée en Reçues / Émises, puis par année et par mois (ex. <code>2026/01 - Janvier</code>), sous son nom « date – fournisseur – montant ». Si vous la modifiez, elle est renommée ; mise à la corbeille, elle est retirée.` : 'Non connecté. Une fois connecté, chaque facture vérifiée est copiée dans le dossier Dropbox de votre choix, rangée par année, avec la sauvegarde quotidienne.'}
        ${s.dropbox_on ? `<label class="fld">Copier dans Dropbox<select id="dWhen"><option value="verifie" ${s.dropbox_when !== 'tout' ? 'selected' : ''}>Seulement les factures vérifiées</option><option value="tout" ${s.dropbox_when === 'tout' ? 'selected' : ''}>Toutes, dès l’envoi</option></select></label>
        <label class="fld">Dossier dans Dropbox<input id="dFolder2" value="${esc(s.dropbox_folder)}" placeholder="/Compta/Factures"></label>
        <div class="line"><button class="btn btn-sm" id="dSave2">Enregistrer</button></div>` : ''}
        <div class="line">${s.dropbox_on ? '<button class="btn btn-sm" id="dSync">Copier maintenant</button><button class="btn btn-sm btn-del" id="dOff">Déconnecter</button>' : `<button class="btn btn-sm btn-acc" id="dOn" ${s.dropbox_key && s.dropbox_secret ? '' : 'disabled'}>Connecter Dropbox</button>`}</div></div>
      ${s.dropbox_on ? '' : `<details ${s.dropbox_key ? '' : 'open'}><summary class="muted" style="margin-top:8px;cursor:pointer">Clés de l’application Dropbox</summary>
        <div class="box"><ol><li>Ouvrez <b>dropbox.com/developers/apps</b> → « Create app ».</li><li>Choisissez « Scoped access », puis <b>« Full Dropbox »</b> pour pouvoir choisir n’importe quel dossier (ou « App folder » pour tout ranger dans <i>Applications/…</i>). Nommez-la (ex. <i>Factures FLP</i>).</li>
        <li>Onglet <b>Permissions</b> : cochez <code>files.metadata.read</code>, <code>files.content.read</code> et <code>files.content.write</code>, puis « Submit ».</li>
        <li>Onglet <b>Settings</b> : dans « Redirect URIs », ajoutez <code>${esc(redirect)}</code>.</li><li>Copiez « App key » et « App secret » ci-dessous, enregistrez, puis « Connecter Dropbox ».</li></ol></div>
        <div class="row2"><label class="fld">App key<input id="dKey" value="${esc(s.dropbox_key)}" autocomplete="off"></label>
        <label class="fld">App secret<input id="dSecret" type="password" placeholder="${s.dropbox_secret ? '•••••• enregistré' : ''}" autocomplete="off"></label></div>
        <label class="fld">Dossier dans Dropbox<input id="dFolder" value="${esc(s.dropbox_folder)}"></label>
        <div class="line"><button class="btn btn-sm" id="dSave">Enregistrer</button></div></details>`}

      <h4>Catégories</h4>
      <div class="box catbox">
        <div class="seg seg3 cat-tabs"><button type="button" data-ct="achat" aria-pressed="true">Reçues</button><button type="button" data-ct="vente" aria-pressed="false">Émises</button><button type="button" data-ct="doc" aria-pressed="false">Documents</button></div>
        <ul class="cat-list" id="catList"></ul>
        <div class="cat-add"><input id="catNew" placeholder="Nouvelle catégorie" maxlength="50" autocomplete="off">
          <select id="catWhere"><option value="achat">dans Reçues</option><option value="vente">dans Émises</option><option value="doc">dans Documents</option></select>
          <button class="btn btn-sm" id="catAdd" type="button">Ajouter</button></div>
        <div class="line"><button class="btn btn-sm btn-acc" id="catSave" type="button">Enregistrer les catégories</button><button class="btn btn-sm" id="catReset" type="button">Revenir aux catégories d’origine</button></div>
        <p class="muted" style="margin:8px 0 0;font-size:12.5px">Retirer une catégorie ne change pas les factures qui l’ont déjà. Le menu ⇄ déplace une catégorie entre Reçues, Émises et Documents.</p>
      </div>

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
        // ----- Catégories -----
        const C3 = { achat: [...(s.cats?.achat || [])], vente: [...(s.cats?.vente || [])], doc: [...(s.cats?.doc || [])] };
        const used = s.cats_used || {};
        const LBL = { achat: 'Reçues', vente: 'Émises', doc: 'Documents' };
        let ct = 'achat';
        const drawCats = () => {
          q('#catList').innerHTML = C3[ct].map((c, i) => `<li><span class="cn">${esc(c)}</span>${used[ct]?.[c] ? `<small>${used[ct][c]} fact.</small>` : ''}
            <select data-mv="${i}" aria-label="Déplacer"><option value="">⇄</option>${['achat', 'vente', 'doc'].filter(k => k !== ct).map(k => `<option value="${k}">vers ${LBL[k]}</option>`).join('')}</select>
            <button type="button" class="cat-up" data-up="${i}" aria-label="Monter" ${i ? '' : 'disabled'}>↑</button>
            <button type="button" class="cat-del" data-del="${i}" aria-label="Retirer">✕</button></li>`).join('') || '<li class="muted">Aucune catégorie.</li>';
          q('.cat-tabs').querySelectorAll('[data-ct]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ct === ct));
          q('#catWhere').value = ct;
        };
        q('.cat-tabs').addEventListener('click', e => { const b = e.target.closest('[data-ct]'); if (b) { ct = b.dataset.ct; drawCats(); } });
        q('#catList').addEventListener('click', e => {
          const d = e.target.closest('[data-del]'), u = e.target.closest('[data-up]');
          if (d) { C3[ct].splice(+d.dataset.del, 1); drawCats(); }
          if (u) { const i = +u.dataset.up; [C3[ct][i - 1], C3[ct][i]] = [C3[ct][i], C3[ct][i - 1]]; drawCats(); }
        });
        q('#catList').addEventListener('change', e => {
          const m = e.target.closest('[data-mv]'); if (!m || !m.value) return;
          const [c] = C3[ct].splice(+m.dataset.mv, 1); if (!C3[m.value].includes(c)) C3[m.value].push(c);
          C.toast(`« ${c} » déplacée vers ${LBL[m.value]} (pensez à enregistrer).`); drawCats();
        });
        const addCat = () => {
          const n = q('#catNew').value.trim().replace(/\s+/g, ' '), w = q('#catWhere').value;
          if (!n) return;
          if (C3[w].some(c => c.toLowerCase() === n.toLowerCase())) return C.toast('Cette catégorie existe déjà.', 'err');
          C3[w].push(n); q('#catNew').value = ''; ct = w; drawCats();
        };
        q('#catAdd').onclick = addCat;
        q('#catNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addCat(); } });
        q('#catSave').onclick = async () => {
          try { await C.api('settings', { cats: JSON.stringify(C3) }); C.toast('Catégories enregistrées.', 'ok'); await load(); } catch (e) { C.toast(e.message, 'err'); }
        };
        q('#catReset').onclick = async () => {
          if (!await C.confirmBox('Revenir aux catégories d’origine ? Vos ajouts et suppressions seront annulés (les factures gardent leur catégorie).', { ok: 'Revenir' })) return;
          try { await C.api('settings', { cats: 'defaut' }); C.toast('Catégories d’origine rétablies.', 'ok'); await load(); close(true); openSettings(); } catch (e) { C.toast(e.message, 'err'); }
        };
        drawCats();
        q('#dSave2') && (q('#dSave2').onclick = () => save({ dropbox_when: q('#dWhen').value, dropbox_folder: q('#dFolder2').value.trim() }, 'Réglages Dropbox enregistrés.'));
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
        q('#dSync') && (q('#dSync').onclick = async () => { q('#dSync').disabled = true; q('#dSync').textContent = 'Copie en cours…'; try { const r = await C.api('dropbox_sync', {}); C.toast(r.msg, 'ok'); } catch (e) { C.toast(e.message, 'err'); } q('#dSync').disabled = false; q('#dSync').textContent = 'Copier maintenant'; });
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

  /* ===================== Relevés bancaires ===================== */
  // Opérations lues sur les relevés (chargées à l'ouverture de l'onglet)
  S.bank = null; S.bankYear = ''; S.bankQ = ''; S.bankF = 'all';
  async function loadBank() {
    try { const j = await C.api('bank_list'); S.bank = j.tx || []; } catch (e) { S.bank = S.bank || []; if (e.message !== 'auth') C.toast(e.message, 'err'); }
  }
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + eur(Math.abs(v)).replace('-', '');
  // Rapprochement : une dépense ↔ une facture reçue (une entrée ↔ une facture émise) de même montant, à ±15 jours
  function matchBank(tx) {
    const used = new Set(), out = new Map();
    const pool = S.items.filter(x => !x.trashed && x.montant != null && (x.sens === 'vente' || isAchat(x)));
    const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5);
    for (const t of tx) {
      let best = null;
      for (const x of pool) {
        if (used.has(x.id) || (t.m < 0 ? x.sens === 'vente' : x.sens !== 'vente')) continue;
        if (Math.abs(Math.abs(t.m) - x.montant) > 0.011) continue;
        const dd = x.date ? days(x.date, t.d) : 99; if (dd > 15) continue;
        if (!best || dd < best.dd) best = { x, dd };
      }
      if (best) { used.add(best.x.id); out.set(t.id, best.x); }
    }
    return out;
  }
  // nom « propre » d'un commerçant à partir du libellé bancaire (pour regrouper)
  const merchant = l => /^(CHEQUE|CHQ)\b/i.test(l || '') ? 'CHÈQUES' : /^REMISE\s+(DE\s+)?CH/i.test(l || '') ? 'REMISES DE CHÈQUES' : (l || '').toUpperCase()
    .replace(/^(PAIEMENT\s+)?(PAR\s+)?(CB|CARTE|CARTE X?\d+)\s*(\d{2}[\/.]?\d{2}(\s|$))?/, '')
    .replace(/^(PRLV|PRELEVEMENT)\s+(SEPA\s+)?/, '').replace(/^(VIR(EMENT)?\s+(SEPA\s+|INST\s+)?(RECU|EMIS)?\s*\/?\s*(DE\s+)?)/, '')
    .replace(/\b\d{4,}\b|\b\d{2}[\/.]\d{2}([\/.]\d{2,4})?\b/g, '').replace(/[\/*].*$/, '').replace(/\s+/g, ' ').trim().slice(0, 32) || 'Divers';
  async function renderBank() {
    const V = $('#bankView');
    if (S.bank === null) { V.innerHTML = '<div class="loading">Chargement des relevés…</div>'; await loadBank(); }
    const st = S.items.filter(isBank).sort((a, b) => (a.date || a.bq?.au || '').localeCompare(b.date || b.bq?.au || ''));
    if (ADMIN && !bankFixing && st.some(x => x.ext && (!x.bq || x.bq.v !== 2))) setTimeout(fixOldStatements, 300);
    const years = [...new Set([...S.bank.map(t => t.d.slice(0, 4)), ...st.map(x => (x.date || '').slice(0, 4)).filter(Boolean)])].sort().reverse();
    if (!S.bankYear || !years.includes(S.bankYear)) S.bankYear = years[0] || String(new Date().getFullYear());
    const Y = S.bankYear, txY = S.bank.filter(t => t.d.startsWith(Y));
    const inn = txY.filter(t => t.m > 0).reduce((a, t) => a + t.m, 0), out = txY.filter(t => t.m < 0).reduce((a, t) => a - t.m, 0);
    const match = matchBank(txY);
    const noProof = txY.filter(t => t.m < 0 && !match.has(t.id));
    // par mois
    const M = Array.from({ length: 12 }, () => ({ i: 0, o: 0 }));
    txY.forEach(t => { const k = +t.d.slice(5, 7) - 1; if (t.m > 0) M[k].i += t.m; else M[k].o -= t.m; });
    const mx = Math.max(1, ...M.map(m => Math.max(m.i, m.o)));
    // principales dépenses par commerçant
    const byM = {}; txY.filter(t => t.m < 0).forEach(t => { const k = merchant(t.l); byM[k] = (byM[k] || 0) - t.m; });
    const top = Object.entries(byM).sort((a, b) => b[1] - a[1]).slice(0, 6), topMax = Math.max(1, ...top.map(t => t[1]));
    // liste filtrée
    const q = S.bankQ.trim().toLowerCase();
    let list = txY.filter(t => (S.bankF === 'in' ? t.m > 0 : S.bankF === 'out' ? t.m < 0 : S.bankF === 'noproof' ? (t.m < 0 && !match.has(t.id)) : true));
    if (q) { const qn = num(q); list = list.filter(t => t.l.toLowerCase().includes(q) || (qn !== null && Math.abs(Math.abs(t.m) - qn) < 0.005) || frDate(t.d).includes(q)); }
    const groups = new Map(); list.forEach(t => { const k = t.d.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    const stY = st.filter(x => (x.date || '').startsWith(Y) || (x.bq?.du || '').startsWith(Y));
    V.innerHTML = `
      <div class="bk-head">
        <div class="bk-years">${years.map(y => `<button class="chip" data-by="${y}" aria-pressed="${y === Y}">${y}</button>`).join('')}</div>
        ${ADMIN ? `<button class="btn btn-acc btn-sm" id="bkImport" type="button"><svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>Importer un relevé</button>` : ''}
      </div>
      <div class="stats bk-stats">
        <div class="stat bk-in"><b>${sgn(inn)}</b><span>entrées d’argent en ${Y}</span></div>
        <div class="stat bk-out"><b>${sgn(-out)}</b><span>dépenses en ${Y}</span></div>
        <div class="stat"><b class="${inn - out >= 0 ? 'pos' : 'neg'}">${sgn(inn - out)}</b><span>solde de l’année · ${txY.length} opération${txY.length > 1 ? 's' : ''}</span></div>
      </div>
      ${txY.length ? `<div class="bk-grid">
        <div class="bk-card"><h3>Mois par mois</h3><div class="bk-months">${M.map((m, i) => `<div class="bk-m" title="${MOIS[i + 1]} : +${eur(m.i)} / −${eur(m.o)}"><div class="bk-bars"><i class="in" style="height:${(m.i / mx * 100).toFixed(1)}%"></i><i class="out" style="height:${(m.o / mx * 100).toFixed(1)}%"></i></div><span>${MOIS[i + 1].slice(0, 3)}</span></div>`).join('')}</div>
          <p class="bk-leg"><i class="in"></i> entrées <i class="out"></i> dépenses</p></div>
        <div class="bk-card"><h3>Principales dépenses</h3>${top.length ? `<div class="bars">${top.map(([k, v]) => `<div class="row"><span title="${esc(k)}">${esc(k)}</span><div class="track"><div class="fill out" style="width:${(v / topMax * 100).toFixed(1)}%"></div></div><span class="v">${eur(v)}</span></div>`).join('')}</div>` : '<p class="muted">Aucune dépense.</p>'}
          <p class="bk-proof">${noProof.length ? `<button type="button" class="linkish" data-bf="noproof">${noProof.length} dépense${noProof.length > 1 ? 's' : ''} sans facture retrouvée</button> · ` : ''}${match.size} rapprochée${match.size > 1 ? 's' : ''} d’une facture</p></div>
      </div>` : ''}
      <h3 class="bk-h">Relevés ${Y} <small>${stY.length}</small></h3>
      <div class="bk-st">${stY.length ? stY.map(x => { const q = x.bq || {}; return `<button class="bk-stc" data-id="${x.id}" type="button">
          <b>${esc(x.societe || 'Relevé')}</b><span>${q.releve_au ? 'Relevé au ' + frDate(q.releve_au) : q.du ? frDate(q.du) + ' → ' + frDate(q.au) : frDate(x.date)} · ${q.n ?? 0} opération${(q.n ?? 0) > 1 ? 's' : ''}${q.doublons ? ` (${q.doublons} déjà lue${q.doublons > 1 ? 's' : ''})` : ''}</span>
          <em class="${q.verif === 'ok' ? 'ok' : q.verif === 'ecart' ? 'ko' : ''}">${q.verif === 'ok' ? '✓ soldes vérifiés' : q.verif === 'ecart' ? '⚠ écart avec le solde' : q.n ? '' : '⚠ rien lu'}</em>
          ${x.ext ? `<span class="dl" role="button" tabindex="0" data-share="${x.id}" aria-label="Télécharger"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></span>` : ''}</button>`; }).join('') : `<p class="empty" style="padding:14px 0">${st.length ? 'Aucun relevé sur cette année.' : 'Aucun relevé pour l’instant. Importez le PDF de votre relevé (ou l’export CSV / OFX depuis le site de votre banque) : l’appli lit les opérations, les classe par date et calcule vos entrées et dépenses.'}</p>`}</div>
      ${txY.length ? `<h3 class="bk-h">Opérations</h3>
      <div class="bk-tools"><div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><input id="bkQ" type="search" placeholder="Rechercher : libellé, montant, date…" value="${esc(S.bankQ)}" autocomplete="off"></div>
        <div class="filters">${[['all', 'Toutes'], ['in', 'Entrées'], ['out', 'Dépenses'], ['noproof', 'Sans facture']].map(([k, l]) => `<button class="chip" data-bf="${k}" aria-pressed="${S.bankF === k}">${l}</button>`).join('')}
        <button class="chip" id="bkXlsx" type="button">⬇ Excel</button></div></div>
      ${q ? (() => { const fi = list.filter(t => t.m > 0).reduce((a, t) => a + t.m, 0), fo = list.filter(t => t.m < 0).reduce((a, t) => a - t.m, 0);
        return `<div class="bk-sum"><span>${list.length} opération${list.length > 1 ? 's' : ''} trouvée${list.length > 1 ? 's' : ''} pour « ${esc(S.bankQ.trim())} » en ${Y}</span>
          <b>Total : ${sgn(fi - fo)}</b>${fi && fo ? `<small>dépenses −${eur(fo)} · entrées +${eur(fi)}</small>` : ''}</div>`; })() : ''}
      <div class="bk-tx">${[...groups].map(([k, g]) => { const [y, m] = k.split('-'); const gi = g.filter(t => t.m > 0).reduce((a, t) => a + t.m, 0), go = g.filter(t => t.m < 0).reduce((a, t) => a - t.m, 0);
        return `<section><div class="month-h"><h2>${MOIS[+m]} ${y}</h2><span class="n">${g.length} op.</span><span class="tot">${gi ? `<span class="pos">+${eur(gi)}</span> ` : ''}${go ? `<span class="neg">−${eur(go)}</span>` : ''}</span></div>
        ${g.map(t => { const x = match.get(t.id); return `<div class="bk-row"><span class="bd">${frDate(t.d).slice(0, 5)}</span><span class="bl">${esc(t.l)}${x ? `<button type="button" class="bk-link" data-open="${x.id}">📎 ${esc(x.societe || 'facture')}</button>` : ''}</span><span class="bm ${t.m > 0 ? 'pos' : 'neg'}">${sgn(t.m)}</span></div>`; }).join('')}</section>`; }).join('') || '<p class="empty">Aucune opération ne correspond.</p>'}</div>` : ''}`;
  }
  // événements de l'onglet
  $('#bankView').addEventListener('click', async e => {
    const y = e.target.closest('[data-by]'); if (y) { S.bankYear = y.dataset.by; return renderBank(); }
    const f = e.target.closest('[data-bf]'); if (f) { S.bankF = f.dataset.bf; await renderBank(); if (f.dataset.bf === 'noproof') $('.bk-tx')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (e.target.closest('#bkImport')) return $('#impBtn').click();
    if (e.target.closest('#bkXlsx')) return exportBank();
    const o = e.target.closest('[data-open]'); if (o) return openSheet(o.dataset.open);
    if (e.target.closest('[data-share]')) return;
    const c = e.target.closest('.bk-stc'); if (c) openSheet(c.dataset.id);
  });
  let bkT; $('#bankView').addEventListener('input', e => { if (e.target.id !== 'bkQ') return; clearTimeout(bkT); bkT = setTimeout(async () => { S.bankQ = e.target.value; const pos = e.target.selectionStart; await renderBank(); const i = $('#bkQ'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 250); });
  if (ADMIN) $('#bankInput').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) bankImport(f); });

  // Import : lecture sur le téléphone, puis envoi du fichier et des opérations
  async function bankImport(files, extra = {}) {
    const res = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i], pre = files.length > 1 ? `${i + 1}/${files.length} · ` : '';
      try {
        progress(pre + 'Lecture du relevé…', (i + 0.3) / files.length * 100);
        const r = await window.FLPBank.parse(f);
        if (!r.tx.length) { C.toast(`${f.name} : ${r.warn || 'aucune opération trouvée. Si c’est un relevé, envoyez-le en PDF texte ou en CSV / OFX depuis le site de votre banque.'}`, 'err'); continue; }
        progress(pre + 'Envoi…', (i + 0.7) / files.length * 100);
        const fd = new FormData();
        const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        fd.set('file', isPdf ? f : new File([f], f.name, { type: 'text/plain' }), f.name || 'releve');
        fd.set('sens', 'banque'); fd.set('source', extra.source || 'import'); fd.set('pages', 1); fd.set('categorie', 'Relevé bancaire');
        fd.set('texte', r.tx.map(t => `${t.d} ${t.l} ${t.m}`).join('\n').slice(0, 20000)); fd.set('doutes', '');
        if (isPdf) { try { const p = await C.readPdf(f); const th = await C.thumbOf(p.canvas); if (th) fd.set('thumb', th, 'thumb.jpg'); fd.set('pages', p.pages); } catch (e) {} }
        const up = await C.api('upload', fd);
        const sv = await C.api('bank_save', { id: up.item.id, tx: JSON.stringify(r.tx), meta: JSON.stringify(r.meta) });
        res.push({ name: f.name, meta: r.meta, ajout: sv.ajout, doublons: sv.doublons, titre: sv.item?.societe, deja: sv.deja });
      } catch (e) { C.toast(`${f.name} : ${e.message}`, 'err'); }
    }
    progress('');
    if (!res.length) return;
    await load(); await loadBank();
    const y = res[res.length - 1].meta.releveAu || res[res.length - 1].meta.au || res[res.length - 1].meta.du; if (y) S.bankYear = y.slice(0, 4);
    render();
    C.dialog({ title: res.length > 1 ? `${res.length} relevés importés` : 'Relevé importé', html: res.map(r => r.deja ? `<div class="box"><b>${esc(r.titre || r.name)}</b><br>Ce relevé était déjà importé : rien n’a été ajouté.</div>` : `<div class="box"><b>${esc(r.titre || r.name)}</b><br>
      ${r.meta.releveAu ? `Relevé au ${frDate(r.meta.releveAu)}<br>` : r.meta.du ? `Du ${frDate(r.meta.du)} au ${frDate(r.meta.au)}<br>` : ''}
      ${r.meta.n} opération${r.meta.n > 1 ? 's' : ''} lue${r.meta.n > 1 ? 's' : ''}${r.doublons ? ` · ${r.doublons} déjà présente${r.doublons > 1 ? 's' : ''} (relevé précédent)` : ''}<br>
      <span class="pos">Entrées +${eur(r.meta.entrees)}</span> · <span class="neg">Dépenses −${eur(r.meta.sorties)}</span><br>
      ${r.meta.verif === 'ok' ? '<span class="ok-txt">✓ Contrôle réussi : ancien solde + entrées − dépenses = nouveau solde.</span>' : r.meta.verif === 'ecart' ? '<span class="neg">⚠ Les opérations lues ne collent pas exactement au solde du relevé : vérifiez s’il manque une ligne.</span>' : '<span class="muted">Pas de solde indiqué sur le relevé : contrôle impossible.</span>'}
      ${r.meta.devine ? '<br><span class="muted">Le relevé n’a pas de colonnes Débit / Crédit séparées : le sens de quelques opérations a été deviné d’après leur libellé.</span>' : ''}</div>`).join('') });
  }
  /* Relevés importés avant la lecture de « Relevé au … » : relus une fois pour remettre la bonne date */
  let bankFixing = false;
  async function fixOldStatements() {
    if (bankFixing) return; bankFixing = true;
    const old = S.items.filter(x => isBank(x) && x.ext && (!x.bq || x.bq.v !== 2));
    let n = 0;
    try {
      for (const x of old) {
        progress(`Remise à la bonne date des relevés… ${n + 1}/${old.length}`, (n + 0.5) / old.length * 100);
        try {
          const blob = await fetch(fileUrl(x), { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error(); return r.blob(); });
          const f = new File([blob], fileName(x), { type: x.ext === 'pdf' ? 'application/pdf' : 'text/plain' });
          const r = await window.FLPBank.parse(f);
          if (r.tx.length) { await C.api('bank_save', { id: x.id, tx: JSON.stringify(r.tx), meta: JSON.stringify(r.meta) }); n++; }
        } catch (e) { /* fichier illisible : on le laisse tel quel */ }
      }
    } finally { progress(''); }
    if (n) { await load(); C.toast(`${n} relevé${n > 1 ? 's' : ''} remis à la date « Relevé au … ».`, 'ok'); }
  }
  async function exportBank() {
    const Y = S.bankYear, tx = (S.bank || []).filter(t => t.d.startsWith(Y)), match = matchBank(tx);
    if (!tx.length) return;
    try {
      const X = await C.lib('xlsx');
      const rows = tx.map(t => ({ 'Date': t.d, 'Libellé': t.l, 'Entrée': t.m > 0 ? t.m : null, 'Dépense': t.m < 0 ? -t.m : null, 'Facture rapprochée': match.get(t.id)?.filename || match.get(t.id)?.societe || '' }));
      const ws = X.utils.json_to_sheet(rows); ws['!cols'] = [{ wch: 11 }, { wch: 52 }, { wch: 12 }, { wch: 12 }, { wch: 40 }];
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Opérations ' + Y);
      X.writeFile(wb, `releves-${Y}.xlsx`);
    } catch (e) { C.toast(e.message, 'err'); }
  }

  /* ===================== Menu, onglets, événements ===================== */
  function setTab(t) {
    S.tab = t; S.filter = 'all'; S.adv = { cat: '', soc: '', min: '', max: '', from: '', to: '' };
    $$('#tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
    if (S.selecting) setSelecting(false);
    ['fMin', 'fMax', 'fFrom', 'fTo'].forEach(id => $('#' + id).value = '');
    if (t !== 'bord' && t !== 'banque') fillAdv();
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
    if (e.target.closest('[data-share]') && !S.selecting) return;     // l'icône ⬇ télécharge, sans ouvrir la fiche
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
