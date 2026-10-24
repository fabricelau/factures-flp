/* =====================================================================
   Factures FLP — lecture automatique d'une facture (texte → champs).
   Devine : fournisseur, date, montant TTC, HT, TVA, taux, devise,
   catégorie, n° de facture. Chaque champ a un indice de confiance :
   ceux qui sont douteux sont listés dans « doutes » et surlignés.
   « learn » = ce que l'appli a appris de vos corrections :
   [{ n: 'Promocash', cat: 'Repas & réception', w: ['promocash','cash',…] }]
   ===================================================================== */
(function (G) {
  'use strict';

  const CATS = [
    ['Équipement & matériel vidéo', /cam[ée]ra|objectif|tr[ée]pied|micro(?!soft)|lumi[eè]re|sony|canon|nikon|dji|gopro|gimbal|carte sd|batterie|slider|softbox|godox|blackmagic|rode|aputure|sigma|tamron/i],
    ['Informatique & logiciels', /adobe|logiciel|licence|macbook|apple|dell|ssd|disque dur|ordinateur|ldlc|informatique|microsoft|google one|davinci|frame\.io|icloud/i],
    ['Déplacements & carburant', /carburant|essence|gazole|sp ?9[58]|\btotal ?(?:energies|access)|p[ée]age|parking|billet d'avion|air austral|corsair|air france|location de v[ée]hicule|station[ -]service|engen/i],
    ['Repas & réception', /restaurant|boulangerie|traiteur|caf[ée]\b|snack|pizza|repas|promocash|carrefour|leclerc|super ?u\b|r[ée]ception|leader price|score\b|jumbo/i],
    ['Location & studio', /location|studio|salle|loyer/i],
    ['Sous-traitance & prestations', /prestation|sous.?traitance|honoraires|freelance|graphiste|monteur|cadreur/i],
    ['Marketing & publicité', /publicit[ée]|facebook|meta platforms|instagram|google ads|flyer|impression|runprint|carte de visite|bâche|kakemono/i],
    ['Fournitures de bureau', /papeterie|cartouche|encre|ramette|classeur|stylo|bureau vall[ée]e/i],
    ['Assurance & banque', /assurance|banque|cotisation|mutuelle|frais bancaires|axa|maif|generali|cr[ée]dit agricole|bred|caisse d'[ée]pargne/i],
    ['Hébergement & web', /h[ée]bergement|o2switch|ovh|nom de domaine|serveur|wordpress|\bssl\b|ionos|pixieset/i],
    ['Charges & abonnements', /edf|[ée]lectricit[ée]|\beau\b|t[ée]l[ée]phone|orange|sfr|free mobile|zeop|canal\+|internet|abonnement|forfait/i],
  ];
  const MONTHS = { 'janvier': 1, 'janv': 1, 'jan': 1, 'février': 2, 'fevrier': 2, 'févr': 2, 'fevr': 2, 'fév': 2, 'fev': 2, 'mars': 3, 'mar': 3,
    'avril': 4, 'avr': 4, 'mai': 5, 'juin': 6, 'juillet': 7, 'juil': 7, 'août': 8, 'aout': 8, 'septembre': 9, 'sept': 9, 'sep': 9,
    'octobre': 10, 'oct': 10, 'novembre': 11, 'nov': 11, 'décembre': 12, 'decembre': 12, 'déc': 12, 'dec': 12 };
  const CURRENCIES = [['USD', /\$|usd|us dollars?/i], ['GBP', /£|gbp/i], ['MUR', /\brs\.?\s?\d|\bmur\b|roupies?/i], ['CHF', /\bchf\b/i], ['JPY', /¥|\bjpy\b|\byen\b/i], ['CAD', /\bcad\b|ca\$/i], ['ZAR', /\bzar\b|\brand\b/i]];

  const norm = s => (s || '').replace(/ | /g, ' ').replace(/[ \t]+/g, ' ');
  const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const lowNoAcc = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* ---------- Date ---------- */
  function findDate(t) {
    const now = new Date(), yNow = now.getFullYear(), today = iso(yNow, now.getMonth() + 1, now.getDate());
    const c = []; let m;
    const push = (y, mo, d, i, w) => {
      if (y < 100) y += 2000;
      if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2010 || y > yNow + 1) return;
      const v = iso(y, mo, d); if (v > today) w -= 0.3;
      const ctx = t.slice(Math.max(0, i - 30), i).toLowerCase();
      if (/date|le |du |factur|émis|emis/.test(ctx)) w += 0.25;
      if (/échéance|echeance|valable|validit|livraison|naissance/.test(ctx)) w -= 0.35;
      c.push({ v, w });
    };
    const re1 = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;
    while ((m = re1.exec(t))) push(+m[3], +m[2], +m[1], m.index, 0.6);
    const re2 = /\b(\d{1,2})(?:er)?\s+([a-zéûôèà]{3,9})\.?\s+(\d{4})\b/gi;
    while ((m = re2.exec(t))) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) push(+m[3], mo, +m[1], m.index, 0.7); }
    const re3 = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
    while ((m = re3.exec(t))) push(+m[1], +m[2], +m[3], m.index, 0.65);
    if (!c.length) return { value: '', conf: 0 };
    c.sort((a, b) => b.w - a.w || (b.v > a.v ? 1 : -1));
    return { value: c[0].v, conf: Math.min(0.95, c[0].w) };
  }

  /* ---------- Montants ---------- */
  function amountsIn(s) {
    const out = [];
    const re = /(?:€|eur|euros?|\$)?\s*(-?(?:\d{1,3}(?:[ .\u00a0',]\d{3})+|\d+)[.,]\d{2})(?!\d)\s*(?:€|eur|euros?|ttc|\$)?/gi;
    let m;
    while ((m = re.exec(s))) {
      if (/^\s*%/.test(s.slice(m.index + m[0].length)) || /%\s*$/.test(m[0])) continue;   // un taux (2,10 %), pas un montant
      const r0 = m[1]; let raw = r0.slice(0, -3).replace(/[ .\u00a0',]/g, '') + '.' + r0.slice(-2);  // séparateur décimal = avant les 2 derniers chiffres
      const v = parseFloat(raw);
      if (!isNaN(v) && Math.abs(v) > 0 && Math.abs(v) < 1e7) out.push(Math.round(v * 100) / 100);
    }
    return out;
  }
  /* Montant TTC : chaque montant du ticket reçoit des points (libellé, répétition, cohérence HT + TVA,
     ligne de paiement…) et le mieux noté l'emporte. Résiste aux erreurs de lecture d'un libellé. */
  function findAmount(t) {
    const lines = t.split(/\n/), L = lines.map(lowNoAcc);
    const STRONG = /net a payer|t[o0]t[a@]l\s*[:.]?\s*t\.?\s*[t1i]\.?\s*[ce]\b|montant\s*t\.?t\.?c|t[o0]tal\s*a\s*payer|a\s*regler|reste\s*(a\s*payer|du)|montant\s*du|t[o0]tal\s*du|t[o0]tal\s*eur/;
    const PAY = /^\s*(cb|c\.b|carte|visa|mastercard|paiement|regle|especes|cheque|sans contact|montant regle)\b/;
    const BAD = /rendu|monnaie|a rendre|sous.?total|remise|acompte|avoir|economie|fidelite|unit|prix u/;
    const HTL = /\bh\.?t\.?\b|hors tax/, TVAL = /\btva\b|t\.v\.a/;
    const cands = [];
    let ht = null, tva = null;
    L.forEach((l, i) => {
      const nums = amountsIn(lines[i]);
      if (HTL.test(l) && !/ttc/.test(l) && nums.length && ht === null) ht = nums[nums.length - 1];
      if (TVAL.test(l) && !/intracom|n[°o]|fr\d{2}|ttc/.test(l) && nums.length && tva === null) tva = Math.min(...nums);
      nums.forEach((v, k) => cands.push({ v, i, last: k === nums.length - 1, n: nums.length }));
    });
    if (!cands.length) return { value: null, conf: 0 };
    const count = {}; for (const c of cands) count[c.v] = (count[c.v] || 0) + 1;
    const maxV = Math.max(...cands.map(c => c.v));
    // en-tête de tableau « HT TVA TTC » : le dernier montant de la ligne suivante est le TTC
    const ttcCol = new Set(); L.forEach((l, i) => { if (/\bttc\b/.test(l) && HTL.test(l) && !amountsIn(lines[i]).length) ttcCol.add(i + 1); });
    let best = null;
    for (const c of cands) {
      const l = L[c.i], prev = c.i > 0 ? L[c.i - 1] : '';
      let s = 0;
      if (STRONG.test(l)) s += 3;
      else if (STRONG.test(prev) && !amountsIn(lines[c.i - 1]).length) s += 2.4;     // libellé seul sur la ligne d'avant
      else if (/\bt[o0]tal\b|montant/.test(l) && !HTL.test(l) && !TVAL.test(l)) s += 1.5;
      if (PAY.test(l)) s += 1.2;
      if (ttcCol.has(c.i) && c.last) s += 1.5;
      if (/\bttc\b/.test(l) && c.last) s += 0.6;
      s += Math.min(2.4, (count[c.v] - 1) * 0.8);                                  // le total revient souvent (TTC, paiement…)
      if (ht != null && tva != null && Math.abs(ht + tva - c.v) < 0.02 && c.v > ht) s += 2;
      if (c.v === maxV) s += 0.5;
      if (BAD.test(l)) s -= 3;
      if ((HTL.test(l) || TVAL.test(l)) && !/ttc/.test(l) && !ttcCol.has(c.i)) s -= 1.5;
      if (c.v <= 0) s -= 5;
      if (!best || s > best.s || (s === best.s && c.v > best.v)) best = { v: c.v, s };
    }
    const conf = best.s >= 4 ? 0.92 : best.s >= 2.5 ? 0.8 : best.s >= 1.5 ? 0.7 : 0.4;
    return { value: best.v, conf };
  }
  function findVat(t, ttc) {
    const l = lowNoAcc(t);
    let taux = null, m;
    const rates = [8.5, 2.1, 20, 10, 5.5, 0];
    const rm = l.match(/(?:tva|t\.v\.a\.?|taux)[^\n%]{0,25}?(\d{1,2}(?:[.,]\d{1,2})?)\s?%|(\d{1,2}(?:[.,]\d{1,2})?)\s?%[^\n]{0,15}tva/);
    if (rm) { const v = parseFloat((rm[1] || rm[2]).replace(',', '.')); if (rates.includes(v)) taux = v; }
    let ht = null, tva = null;
    for (const ln of t.split('\n')) {
      const x = lowNoAcc(ln);
      if (ht === null && /(total|montant)?\s*h\.?t\.?\b|hors tax/.test(x) && !/ttc/.test(x)) { const n = amountsIn(ln); if (n.length) ht = Math.max(...n); }
      if (tva === null && /\btva\b|t\.v\.a/.test(x) && !/n[°o]|intracom|numero|fr\d{2}/.test(x)) { const n = amountsIn(ln).filter(v => !rates.includes(v)); if (n.length) tva = Math.min(...n); }
    }
    // ligne de tableau « taux  HT  TVA  TTC » (ex. 2,10 % 7,06 € 0,14 € 7,20 €) : la plus fiable car cohérente en elle-même
    if (ttc != null) for (const ln of t.split('\n')) {
      const n = amountsIn(ln); if (n.length < 3) continue;
      const c = n[n.length - 1]; if (Math.abs(c - ttc) > 0.011) continue;
      let hit = null;
      for (let i = 0; i < n.length - 1 && !hit; i++) for (let j = 0; j < n.length - 1; j++) if (i !== j && n[i] > n[j] && Math.abs(n[i] + n[j] - c) < 0.015) { hit = [n[i], n[j]]; break; }
      if (hit) {
        ht = hit[0]; tva = hit[1];
        const pm = ln.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s?%/); if (pm) { const v = parseFloat(pm[1].replace(',', '.')); if (rates.includes(v)) taux = v; }
        break;
      }
    }
    // HT lu de travers (7,06 → 1,06 ou 71,06) : incohérent avec le TTC → recalculé avec le taux
    if (ttc != null && ht != null && (ht >= ttc || (tva != null && Math.abs(ht + tva - ttc) > 0.05)) && taux) {
      ht = Math.round(ttc / (1 + taux / 100) * 100) / 100; tva = Math.round((ttc - ht) * 100) / 100;
    } else if (ttc != null && ht != null && ht >= ttc) { ht = null; tva = null; }
    if (ttc != null) {
      if (ht != null && tva == null && ht < ttc) tva = Math.round((ttc - ht) * 100) / 100;
      if (tva != null && ht == null && tva < ttc) ht = Math.round((ttc - tva) * 100) / 100;
      if (ht == null && tva == null && taux) { ht = Math.round(ttc / (1 + taux / 100) * 100) / 100; tva = Math.round((ttc - ht) * 100) / 100; }
      if (ht != null && taux == null && ht > 0) { const r = Math.round(((ttc - ht) / ht) * 1000) / 10; const near = rates.find(x => Math.abs(x - r) < 0.4); if (near !== undefined) taux = near; }
    }
    const ok = ht != null && tva != null && ttc != null && Math.abs(ht + tva - ttc) < 0.05;
    return { ht, tva, taux, conf: ok ? 0.85 : (ht != null || tva != null ? 0.5 : 0) };
  }

  /* ---------- Devise ---------- */
  function findCurrency(t) {
    if (/€|\beur\b|euros?/i.test(t)) return { value: 'EUR', conf: 0.9 };
    for (const [c, re] of CURRENCIES) if (re.test(t)) return { value: c, conf: 0.7 };
    return { value: 'EUR', conf: 0.5 };
  }

  /* ---------- Fournisseur (avec ce qui a été appris) ---------- */
  /* Reconnaissance par le logo / la disposition de l'en-tête (empreinte visuelle) */
  function byLook(vh, learn) {
    const H = G.FLPC && G.FLPC.hamming;
    if (!vh || !H) return null;
    const r = [];
    for (const e of learn || []) { if (!e.v || !e.v.length) continue; let d = 1; for (const h of e.v) d = Math.min(d, H(vh, h)); r.push({ e, d }); }
    r.sort((a, b) => a.d - b.d);
    if (!r.length || r[0].d >= 0.2) return null;
    if (r.length > 1 && r[1].d - r[0].d < 0.06) return null;      // deux fournisseurs trop ressemblants : on ne tranche pas
    return r[0];
  }
  function findCompany(t, learn, vh) {
    const low = lowNoAcc(t);
    // 1) nom déjà connu présent tel quel
    let best = null;
    for (const e of learn || []) {
      const k = lowNoAcc(e.n);
      if (k.length >= 3 && low.includes(k) && (!best || k.length > best.k.length)) best = { k, e };
    }
    if (best) return { value: best.e.n, conf: 0.93, cat: best.e.cat, e: best.e };
    // 2) mots typiques appris (logo illisible mais adresse, slogan… reconnus)
    const words = new Set((low.match(/[a-z]{4,}/g) || []));
    let top = null;
    for (const e of learn || []) {
      if (!e.w || e.w.length < 3) continue;
      const hit = e.w.filter(w => words.has(lowNoAcc(w))).length;
      const score = hit / Math.min(e.w.length, 12);
      if (hit >= 3 && (!top || score > top.score)) top = { e, score };
    }
    if (top && top.score >= 0.35) return { value: top.e.n, conf: Math.min(0.85, 0.5 + top.score / 2), cat: top.e.cat, e: top.e };
    // 2 bis) logo et disposition de l'en-tête déjà vus : quasi identiques → on fait confiance tout de suite ;
    //       seulement ressemblants → seulement si le texte ne donne rien de mieux (en-têtes « texte seul »
    //       de deux commerces différents peuvent se ressembler)
    const look = byLook(vh, learn);
    const fromLook = () => ({ value: look.e.n, conf: look.d < 0.08 ? 0.88 : 0.7, cat: look.e.cat, e: look.e });
    if (look && look.d < 0.08) return fromLook();
    // 2 ter) en-tête « type de commerce + nom » (BOULANGERIE BURHANI, GARAGE DU PORT, SARL …) : c'est le vrai nom
    const head = t.split(/\n/).map(x => x.trim()).filter(Boolean).slice(0, 10);
    const SHOP = /^(boulangerie|patisserie|restaurant|brasserie|snack|pizzeria|cafe|bar|boucherie|charcuterie|traiteur|epicerie|superette|supermarche|hypermarche|magasin|boutique|librairie|pharmacie|garage|station|carrosserie|hotel|imprimerie|quincaillerie|sarl|sas|sasu|eurl|ets|etablissements|societe|ste)\b/;
    for (const ln of head) {
      const l0 = lowNoAcc(ln).replace(/[^a-z0-9&' -]/g, ' ').replace(/\s+/g, ' ').trim();
      if (SHOP.test(l0) && l0.split(' ').length >= 2 && l0.length <= 40) {
        const clean = ln.replace(/[^0-9A-Za-zÀ-ÿ&'’. -]/g, '').replace(/\s+/g, ' ').trim();
        return { value: clean === clean.toUpperCase() ? clean.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, c => c.toUpperCase()) : clean, conf: 0.72 };
      }
    }
    // 3) enseignes courantes
    const brands = ['Promocash', 'Carrefour', 'E.Leclerc', 'Leclerc', 'Super U', 'Leader Price', 'Score', 'Jumbo', 'Decathlon', 'Leroy Merlin', 'Mr Bricolage',
      'Bureau Vallée', 'LDLC', 'Fnac', 'Darty', 'Boulanger', 'Chronopost', 'DHL', 'Colissimo', 'Amazon', 'Apple', 'Adobe', 'Google', 'Microsoft', 'O2switch',
      'RunPrint', 'Foir Fouille', 'Run Market', 'TotalEnergies', 'Engen', 'Shell', 'Vito', 'Air Austral', 'Corsair', 'Orange', 'SFR', 'Zeop', 'EDF', 'Pixieset', 'Blackmagic'];
    // mot entier seulement : « Boulanger » ne doit pas sortir de « BOULANGERIE »
    for (const b of brands) { const k = lowNoAcc(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (new RegExp('(^|[^a-z0-9])' + k + '(?![a-z0-9])').test(low)) return { value: b, conf: 0.75 }; }
    if (look) return fromLook();
    // 4) première ligne d'en-tête plausible — seulement si la lecture est propre
    //    (une photo floue ou qui n'est pas une facture donne du charabia : mieux vaut un champ vide)
    const toks = t.split(/\s+/).filter(Boolean);
    const wordy = toks.filter(w => /^[A-Za-zÀ-ÿ'’-]{3,}[.,:;]?$/.test(w) && /[aeiouyàâéèêëîïôûù]/i.test(w)).length;
    if (toks.length < 6 || wordy / toks.length < 0.3) return { value: '', conf: 0 };
    const plausible = ln => {
      const ws = ln.split(/\s+/).filter(Boolean);
      const shortW = ws.filter(w => w.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').length <= 2).length;
      const letters = ln.replace(/[^A-Za-zÀ-ÿ]/g, '').length, chars = ln.replace(/\s/g, '').length || 1;
      return ws.some(w => /[A-Za-zÀ-ÿ]{3,}/.test(w) && /[aeiouyàâéèêëîïôûù]/i.test(w)) && shortW / ws.length <= 0.4 && letters / chars >= 0.7;
    };
    const lines = t.split(/\n/).map(s => s.trim()).filter(Boolean);
    for (const ln of lines.slice(0, 7)) {
      if (ln.length >= 3 && ln.length <= 40 && /[a-zA-Zéèà]{3}/.test(ln) && plausible(ln) && !/facture|invoice|ticket|re[cç]u|devis|\d{2}[\/.]\d{2}|siret|siren|tva|www\.|@|tel|t[ée]l[ée]phone|rue|avenue|bienvenue|merci/i.test(ln)) {
        const clean = ln.replace(/[^0-9A-Za-zÀ-ÿ&'’. -]/g, '').replace(/\s+/g, ' ').trim();
        if (clean.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3)
          return { value: clean.length > 3 && clean === clean.toUpperCase() ? clean.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()) : clean, conf: 0.35 };
      }
    }
    return { value: '', conf: 0 };
  }

  function findCategory(t) {
    for (const [name, re] of CATS) if (re.test(t)) return { value: name, conf: 0.6 };
    return { value: '', conf: 0 };
  }
  function findNumber(t) {
    const m = t.match(/(?:facture|invoice|fact\.?)\s*(?:n[°o.]?|num[ée]ro|#)?\s*[:#]?\s*([A-Z]{0,5}[-\/]?\d[\w\-\/]{2,20})/i)
           || t.match(/\b(?:n[°o]|ref|réf)\s*[:.]?\s*([A-Z0-9][\w\-\/]{3,20})/i);
    return m ? { value: m[1].toUpperCase(), conf: 0.55 } : { value: '', conf: 0 };
  }

  /* ---------- Tout ensemble ---------- */
  /* la ligne contient-elle ce libellé ? (mots dans l'ordre, sans accents) */
  function hasLabel(line, lbl) {
    const l = ' ' + lowNoAcc(line).replace(/[^a-z0-9]+/g, ' ') + ' ';
    let at = 0;
    for (const w of lowNoAcc(lbl).split(/\s+/).filter(Boolean)) { const i = l.indexOf(' ' + w + ' ', at); if (i < 0) return false; at = i + w.length; }
    return true;
  }
  function extract(raw, learn, opts = {}) {
    const t = norm(raw || '');
    const company = findCompany(t, learn, opts.vh);
    let date = findDate(t), amount = findAmount(t);
    // Mise en page apprise pour ce fournisseur : le bon montant / la bonne date sont sur la ligne de tel libellé
    const e = company.e;
    if (e && (e.tm || e.td)) {
      const lines = t.split(/\n/);
      if (e.tm) for (let i = lines.length - 1; i >= 0; i--) {
        if (!hasLabel(lines[i], e.tm)) continue;
        let a = amountsIn(lines[i]);
        if (!a.length && lines[i + 1]) a = amountsIn(lines[i + 1]);   // montant à la ligne suivante
        if (a.length) { amount = { value: a[a.length - 1], conf: 0.93 }; break; }
      }
      if (e.td) for (const ln of lines) {
        if (!hasLabel(ln, e.td)) continue;
        const d = findDate(ln);
        if (d.value) { date = { value: d.value, conf: Math.max(0.9, d.conf) }; break; }
      }
    }
    const cur = findCurrency(t), vat = findVat(t, amount.value), num = findNumber(t);
    // Catégorie : celle apprise pour ce fournisseur passe avant la devinette
    const cat = company.cat ? { value: company.cat, conf: 0.9 } : findCategory(t);
    const doutes = [];
    if (company.conf < 0.6) doutes.push('societe');
    if (amount.conf < 0.7) doutes.push('montant');
    if (date.conf < 0.6) doutes.push('date');
    if (!cat.value) doutes.push('categorie');
    if (cur.value !== 'EUR') doutes.push('devise');
    return {
      societe: company.value, date: date.value, montant: amount.value, devise: cur.value,
      ht: vat.ht, tva: vat.tva, taux_tva: vat.taux, categorie: cat.value, numero: num.value,
      texte: t.slice(0, 20000), doutes,
      conf: { societe: company.conf, date: date.conf, montant: amount.conf, categorie: cat.conf, tva: vat.conf, devise: cur.conf },
    };
  }

  G.FLPExtract = { extract, findDate, findAmount, findCompany, findCategory, findNumber, findVat, findCurrency, amountsIn };
})(typeof window !== 'undefined' ? window : globalThis);
