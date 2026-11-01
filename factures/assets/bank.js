/* =====================================================================
   Factures FLP — lecture des relevés bancaires.
   Formats : PDF (texte, colonnes Débit / Crédit ou Montant signé),
   CSV (export de la banque), OFX / QFX, QIF.
   Renvoie les opérations { d: 'AAAA-MM-JJ', l: 'libellé', m: ±montant }
   et ce qu'on sait du relevé : période, banque, ancien / nouveau solde,
   et un contrôle (ancien solde + entrées − sorties = nouveau solde ?).
   ===================================================================== */
(function (G) {
  'use strict';
  const C = () => G.FLPC;
  const low = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const r2 = v => Math.round(v * 100) / 100;

  /* montant « 1 250,00 », « -12,50 € », « 1.250,00 », « 1250.00 » → nombre (null si ce n'en est pas un) */
  const AMT = /^([+\-−]?)\s*(\d{1,3}(?:[   .']\d{3})+|\d+)[,.](\d{2})\s*(?:€|eur|euros?)?\s*([+-]|cr|db)?$/i;
  function amount(s) {
    const m = String(s).trim().match(AMT); if (!m) return null;
    let v = parseFloat(m[2].replace(/[   .']/g, '') + '.' + m[3]);
    if (m[1] === '-' || m[1] === '−' || /^(-|db)$/i.test(m[4] || '')) v = -v;
    return { v, signed: !!(m[1] || m[4]) };
  }
  const DATE = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/;
  function dateOf(s, ctx) {
    const m = String(s).trim().match(DATE); if (!m) return null;
    const d = +m[1], mo = +m[2]; if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    let y = m[3] ? +m[3] : null; if (y !== null && y < 100) y += 2000;
    if (y === null) {   // année déduite de la période du relevé
      y = ctx.year || new Date().getFullYear();
      if (ctx.endMonth && mo > ctx.endMonth + 1) y -= 1;        // opérations de décembre sur un relevé de janvier
    }
    return iso(y, mo, d);
  }
  const BANKS = ['BRED', 'Crédit Agricole', 'La Banque Postale', 'Banque Postale', 'BNP Paribas', 'Société Générale', 'LCL', 'Caisse d’Epargne', "Caisse d'Epargne", 'Banque Populaire', 'CIC', 'Crédit Mutuel', 'Boursorama', 'BoursoBank', 'Qonto', 'Shine', 'Revolut', 'N26', 'Banque de la Réunion', 'BFC Océan Indien', 'Hello bank', 'Fortuneo', 'Monabanq', 'Crédit Coopératif', 'Mynd'];
  function bankName(text) { const t = low(text); for (const b of BANKS) if (t.includes(low(b))) return b.replace('’', "'"); return ''; }
  /* période « du 01/10/2026 au 31/10/2026 », date d'arrêté… */
  function period(text) {
    const t = low(text);
    let m = t.match(/du\s+(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\s+au\s+(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
    const Y = y => (+y < 100 ? 2000 + +y : +y);
    if (m) return { du: iso(Y(m[3]), +m[2], +m[1]), au: iso(Y(m[6]), +m[5], +m[4]), year: Y(m[6]), endMonth: +m[5] };
    m = t.match(/(?:arrete|arret|edite|etabli)[^\d]{0,25}(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
    if (m) return { au: iso(Y(m[3]), +m[2], +m[1]), year: Y(m[3]), endMonth: +m[2] };
    m = t.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
    if (m) return { year: +m[3], endMonth: +m[2] };
    return {};
  }
  const SKIP = /^(ancien|nouveau)\s+solde|solde\s+(crediteur|debiteur|au|precedent|final|initial)|^solde\b|total\s+des\s+op|^total\b|sous.?total|^report\b|a\s+reporter|^page\s+\d/;

  /* ---------- PDF ---------- */
  async function fromPdf(file) {
    const pdfjs = await C().pdfLib();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        const s = (it.str || '').trim(); if (!s) continue;
        const x = it.transform[4], y = it.transform[5], w = it.width || s.length * 4;
        let r = rows.find(r => Math.abs(r.y - y) < 3);
        if (!r) { r = { y, items: [] }; rows.push(r); }
        r.items.push({ s, x, w });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        // « 1 » + « 008,58 » découpés par le PDF → « 1 008,58 »
        const m = [];
        for (const it of r.items) {
          const pv = m[m.length - 1];
          if (pv) {
            const gap = it.x - (pv.x + pv.w), cw = pv.w / Math.max(1, pv.s.length);
            if (/^[+\-\u2212]?\d{1,3}(?:[ .]\d{3})*$/.test(pv.s) && /^\d{3}(?:[ .]\d{3})*(?:,\d{2})?\s*\u20ac?$/.test(it.s) && gap < cw * 2.2) { pv.s += ' ' + it.s; pv.w = it.x + it.w - pv.x; continue; }
          }
          m.push({ ...it });
        }
        r.items = m; r.page = p; lines.push(r);
      }
    }
    const text = lines.map(r => r.items.map(i => i.s).join(' ')).join('\n');
    if (text.replace(/\s/g, '').length < 40) return { tx: [], meta: {}, warn: 'Ce PDF est une image (relevé scanné) : l’appli ne peut pas en lire les chiffres. Téléchargez plutôt le relevé en PDF ou en CSV depuis le site de votre banque.' };
    return parseLines(lines, text);
  }
  /* coupe les éléments qui contiennent plusieurs colonnes collées (« 05/10 06/10 CB PROMOCASH 12,50 ») */
  function explode(items) {
    const out = [];
    for (const it of items) {
      if (!/\s{2,}/.test(it.s)) { out.push(it); continue; }
      // position réelle de chaque morceau dans la ligne (chasse fixe : 1 caractère = même largeur)
      const cw = it.w / Math.max(1, it.s.length), re = /\S+(?: \S+)*/g; let m;
      while ((m = re.exec(it.s))) out.push({ s: m[0], x: it.x + m.index * cw, w: m[0].length * cw });
    }
    // date en tête d'un élément plus long : on la sépare
    const out2 = [];
    for (const it of out) {
      const m = it.s.match(/^(\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?)\s+(.+)$/);
      if (m) { const cw = it.w / Math.max(1, it.s.length); out2.push({ s: m[1], x: it.x, w: m[1].length * cw }); out2.push({ s: m[2], x: it.x + (m[1].length + 1) * cw, w: m[2].length * cw }); }
      else out2.push(it);
    }
    // montant en fin d'élément texte : on le sépare aussi
    const out3 = [];
    for (const it of out2) {
      const m = it.s.match(/^(.*?\S)\s+([+\-−]?\d{1,3}(?:[  .]\d{3})*,\d{2}\s*€?)$/);
      if (m && !amount(it.s)) { const cw = it.w / Math.max(1, it.s.length); out3.push({ s: m[1], x: it.x, w: m[1].length * cw }); out3.push({ s: m[2], x: it.x + it.w - m[2].length * cw, w: m[2].length * cw }); }
      else out3.push(it);
    }
    return out3;
  }
  function parseLines(lines, text) {
    const ctx = period(text);
    const meta = { banque: bankName(text), du: ctx.du || '', au: ctx.au || '' };
    let cols = null;     // { deb: x, cre: x } ou { mt: x }
    const tx = [];
    let last = null, labelX = null;
    for (const r of lines) {
      const items = explode(r.items);
      const lineText = items.map(i => i.s).join(' '), L = low(lineText);
      // en-tête de tableau : position des colonnes Débit / Crédit (ou Montant)
      const hd = items.find(i => /^d[eé]bits?\b/i.test(i.s)), hc = items.find(i => /^cr[eé]dits?\b/i.test(i.s));
      if (hd && hc) { cols = { deb: hd.x + hd.w / 2, cre: hc.x + hc.w / 2, debR: hd.x + hd.w, creR: hc.x + hc.w }; const lab = items.find(i => /libell|op[eé]ration|d[eé]tail|nature/i.test(i.s)); if (lab) labelX = lab.x; last = null; continue; }
      const hm = items.find(i => /^montant/i.test(i.s));
      if (hm && !cols && /date/i.test(lineText)) { cols = { mt: hm.x + hm.w / 2 }; const lab = items.find(i => /libell|op[eé]ration|d[eé]tail/i.test(i.s)); if (lab) labelX = lab.x; continue; }
      // soldes (pour le contrôle)
      if (/(ancien|precedent|initial)[^0-9]{0,20}solde|solde\s+(precedent|initial|au\s+\d)|^ancien solde|solde crediteur au|solde debiteur au/.test(L) && meta.ancien === undefined && !tx.length) {
        const tail = lineText.match(/(?:^|\s)([+\-\u2212]?\d{1,3}(?:[ \u00a0\u202f.]\d{3})*,\d{2})\s*\u20ac?\s*$/);
        const a = items.map(i => amount(i.s)).filter(Boolean).pop() || (tail ? amount(tail[1]) : null);
        if (a) meta.ancien = /debiteur/.test(L) ? -Math.abs(a.v) : a.v;
        continue;
      }
      if (/nouveau solde|solde (final|au \d|crediteur au|debiteur au)/.test(L) && tx.length) {
        const a = items.map(i => amount(i.s)).filter(Boolean).pop();
        if (a) meta.nouveau = /debiteur/.test(L) ? -Math.abs(a.v) : a.v;
        last = null; continue;
      }
      const first = items[0];
      const d = first ? dateOf(first.s, ctx) : null;
      const amts = items.filter(i => amount(i.s));
      if (d && amts.length) {
        if (SKIP.test(L.replace(/^\S+\s+/, ''))) { last = null; continue; }
        // libellé : le texte entre les dates et les montants
        const lab = items.slice(1).filter(i => !amount(i.s) && !dateOf(i.s, ctx)).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
        if (!lab) continue;
        const a = amts[amts.length - 1], av = amount(a.s), cx = a.x + a.w / 2, rx = a.x + a.w;
        let v = av.v;
        if (cols && cols.deb !== undefined) {
          const toDeb = Math.min(Math.abs(cx - cols.deb), Math.abs(rx - cols.debR)), toCre = Math.min(Math.abs(cx - cols.cre), Math.abs(rx - cols.creR));
          v = toDeb <= toCre ? -Math.abs(av.v) : Math.abs(av.v);
        } else if (!av.signed) {
          v = /\b(vir(ement)?s?\b.*(recu|de\s)|remise|depot|versement|avoir|rembourst?|remboursement|interets crediteurs)/i.test(low(lab)) ? Math.abs(av.v) : -Math.abs(av.v);
          meta.devine = true;
        }
        last = { d, l: lab, m: r2(v) }; tx.push(last);
        continue;
      }
      // suite du libellé sur la ligne suivante
      if (last && !d && !amts.length && items.length && !SKIP.test(L) && lineText.length < 80 && (labelX === null || Math.abs(first.x - labelX) < 40 || first.x > labelX - 10)) {
        if (last.l.length < 140) last.l = (last.l + ' ' + lineText).replace(/\s+/g, ' ').trim();
        continue;
      }
      if (!amts.length && !d) continue;
      last = null;
    }
    return finish(tx, meta);
  }

  /* ---------- CSV ---------- */
  function decode(buf) {
    let t = new TextDecoder('utf-8').decode(buf);
    if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf);
    return t.replace(/^﻿/, '');
  }
  function splitCsv(line, sep) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out.map(s => s.trim());
  }
  function fromCsv(text) {
    const rows = text.split(/\r?\n/).filter(l => l.trim());
    if (!rows.length) return { tx: [], meta: {} };
    const sepOf = l => [';', '\t', ','].map(s => [s, splitCsv(l, s).length]).sort((a, b) => b[1] - a[1])[0][0];
    // ligne d'en-tête : la première qui contient « date »
    let hi = rows.findIndex(l => /date/i.test(l) && /(libell|label|description|op[eé]ration|d[eé]tail|montant|amount|d[eé]bit)/i.test(l));
    if (hi < 0) hi = 0;
    const sep = sepOf(rows[hi]);
    const H = splitCsv(rows[hi], sep).map(low);
    const col = re => H.findIndex(h => re.test(h));
    const iDate = (() => { const a = col(/date\s*(d.?)?op|date\s*comptable|^date$/); return a >= 0 ? a : col(/date/); })();
    const iLab = (() => { const a = col(/libell|label|description|detail|operation|nature|beneficiaire|tiers/); return a; })();
    const iDeb = col(/debit|sortie|depense/), iCre = col(/credit|entree|recette/), iMt = col(/montant|amount|valeur\s*\(?eur|somme/);
    const tx = [];
    for (const l of rows.slice(hi + 1)) {
      const c = splitCsv(l, sep);
      const ds = c[iDate] || '';
      let d = null, m;
      if ((m = ds.match(/^(\d{4})-(\d{2})-(\d{2})/))) d = `${m[1]}-${m[2]}-${m[3]}`;
      else d = dateOf(ds.slice(0, 10), {});
      if (!d) continue;
      let v = null;
      if (iDeb >= 0 || iCre >= 0) {
        const a = iDeb >= 0 ? amount((c[iDeb] || '').replace(/^-/, '')) : null, b = iCre >= 0 ? amount(c[iCre] || '') : null;
        if (a && a.v) v = -Math.abs(a.v); else if (b && b.v) v = Math.abs(b.v);
        if (v === null && iMt >= 0) { const x = amount(c[iMt] || ''); if (x) v = x.v; }
      } else if (iMt >= 0) { const x = amount(c[iMt] || ''); if (x) v = x.v; }
      if (v === null || !v) continue;
      const lab = (iLab >= 0 ? c[iLab] : c.filter((x, i) => i !== iDate && !amount(x)).join(' ')).replace(/\s+/g, ' ').trim();
      tx.push({ d, l: lab || 'Opération', m: r2(v) });
    }
    return finish(tx, { banque: bankName(rows.slice(0, 5).join(' ')) });
  }

  /* ---------- OFX / QFX ---------- */
  function fromOfx(text) {
    const tx = [];
    const tag = (b, t) => { const m = b.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
    for (const b of text.split(/<STMTTRN>/i).slice(1)) {
      const dt = tag(b, 'DTPOSTED'), a = parseFloat(tag(b, 'TRNAMT').replace(',', '.'));
      if (!/^\d{8}/.test(dt) || isNaN(a)) continue;
      const name = tag(b, 'NAME'), memo = tag(b, 'MEMO');
      tx.push({ d: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`, l: (memo.length > name.length ? memo : name) || 'Opération', m: r2(a) });
    }
    const bal = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([-\d.,]+)/i);
    return finish(tx, { nouveau: bal ? parseFloat(bal[1].replace(',', '.')) : undefined, banque: bankName(tag(text, 'ORG')) });
  }
  /* ---------- QIF ---------- */
  function fromQif(text) {
    const tx = [];
    for (const b of text.split(/^\^/m)) {
      let d = null, v = null, p = '', mm = '';
      for (const line of b.split(/\r?\n/)) {
        const k = line[0], val = line.slice(1).trim();
        if (k === 'D') { const m = val.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-'](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; d = iso(y, +m[2], +m[1]); } }
        else if (k === 'T' || k === 'U') { const a = amount(val) || { v: parseFloat(val.replace(/,/g, '')) }; if (a && !isNaN(a.v)) v = a.v; }
        else if (k === 'P') p = val; else if (k === 'M') mm = val;
      }
      if (d && v) tx.push({ d, l: p || mm || 'Opération', m: r2(v) });
    }
    return finish(tx, {});
  }

  /* ---------- Fin : tri, période, contrôle des soldes ---------- */
  function finish(tx, meta) {
    tx.sort((a, b) => a.d.localeCompare(b.d));
    const inn = r2(tx.filter(t => t.m > 0).reduce((s, t) => s + t.m, 0)), out = r2(tx.filter(t => t.m < 0).reduce((s, t) => s - t.m, 0));
    meta.du = meta.du || (tx[0] && tx[0].d) || ''; meta.au = meta.au || (tx.length && tx[tx.length - 1].d) || '';
    meta.entrees = inn; meta.sorties = out; meta.n = tx.length;
    if (typeof meta.ancien === 'number' && typeof meta.nouveau === 'number') meta.verif = Math.abs(meta.ancien + inn - out - meta.nouveau) < 0.02 ? 'ok' : 'ecart';
    return { tx, meta };
  }

  async function parse(file) {
    const name = (file.name || '').toLowerCase();
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) return Object.assign({ kind: 'pdf' }, await fromPdf(file));
    const text = decode(await file.arrayBuffer());
    if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(text) || /\.(ofx|qfx)$/.test(name)) return Object.assign({ kind: 'ofx' }, fromOfx(text));
    if (/^!Type:/im.test(text) || name.endsWith('.qif')) return Object.assign({ kind: 'qif' }, fromQif(text));
    return Object.assign({ kind: 'csv' }, fromCsv(text));
  }

  G.FLPBank = { parse, parseLines, fromCsv, fromOfx, fromQif, amount };
})(window);
