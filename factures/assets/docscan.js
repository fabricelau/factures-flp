/* =====================================================================
   Factures FLP — traitement d'image du scanner (sans bibliothèque).
   · detect()  : trouve les 4 coins de la feuille (fond sombre, bois, bureau clair, doigt sur un coin…)
   · warp()    : redresse la feuille (correction de perspective)
   · filter()  : filtre « document » noir et blanc, fond blanchi, texte net
   · rotate()  : rotation de 90°
   · stitch()  : recolle plusieurs photos bout à bout (ticket long)
   · quality() : repère une photo floue ou trop sombre
   ===================================================================== */
(function (G) {
  'use strict';

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctx = c => c.getContext('2d', { willReadFrequently: true });

  function small(src, max) {
    const w = src.width || src.videoWidth, h = src.height || src.videoHeight;
    const k = Math.min(1, max / Math.max(w, h));
    const c = mk(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    ctx(c).drawImage(src, 0, 0, c.width, c.height);
    return { c, k };
  }
  function gray(data) {
    const g = new Uint8ClampedArray(data.length / 4);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    return g;
  }
  function otsu(g) {
    const hist = new Array(256).fill(0); for (const v of g) hist[v]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, max = 0, th = 128; const tot = g.length;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
      if (v > max) { max = v; th = i; }
    }
    return th;
  }

  /* ---------- 4 coins de la feuille ----------
     1. Plusieurs façons de séparer la feuille du fond (luminosité, écart à la
        couleur du fond mesurée sur les bords de la photo, « blanc papier »
        = clair et peu coloré) : ça marche sur fond sombre, bois, bureau clair.
     2. Pour chacune : la plus grande zone, trous bouchés (le texte), contour.
     3. Chaque côté est redressé en ligne droite (tirage aléatoire robuste) :
        un doigt ou une ombre sur un coin ne le fait plus dévier, et un coin
        caché est retrouvé à l'intersection de ses deux côtés.
     4. On garde la meilleure, puis on la cale sur les vrais contours de la
        feuille à plus haute définition.                                       */
  function detect(src, opts = {}) {
    const fast = !!opts.fast;
    const SW = src.width || src.videoWidth, SH = src.height || src.videoHeight;
    // contour déjà repéré en direct par la caméra : il suffit de le caler finement (≈ 10 fois plus rapide)
    if (opts.init && opts.init.length === 4 && quadArea(opts.init) > SW * SH * 0.08) {
      const p = snap(src, opts.init);
      if (p) return { pts: p.map(q => ({ x: Math.max(0, Math.min(SW, q.x)), y: Math.max(0, Math.min(SH, q.y)) })), found: true, score: 1 };
    }
    const def = inset(SW, SH, 0.06);
    const { c, k } = small(src, fast ? 300 : 460);
    const W = c.width, H = c.height, N = W * H;
    const d = ctx(c).getImageData(0, 0, W, H).data;
    const Lr = new Float32Array(N), Sa = new Float32Array(N), Rr = new Float32Array(N), Gg = new Float32Array(N), Bb = new Float32Array(N);
    for (let i = 0, j = 0; j < N; i += 4, j++) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      Rr[j] = r; Gg[j] = g; Bb[j] = b; Lr[j] = 0.299 * r + 0.587 * g + 0.114 * b; Sa[j] = mx ? (mx - mn) / mx * 255 : 0;
    }
    const L = blur(blur(Lr, W, H), W, H), S = blur(Sa, W, H);
    // couleur du fond : médiane d'une bande le long des bords de la photo
    const ring = Math.max(2, Math.round(Math.min(W, H) * 0.035));
    const med = arr => { const h = new Uint32Array(256); let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < ring || y < ring || x >= W - ring || y >= H - ring) { h[arr[y * W + x] | 0]++; n++; } let a = 0; for (let v = 0; v < 256; v++) { a += h[v]; if (a >= n / 2) return v; } return 0; };
    const bR = med(Rr), bG = med(Gg), bB = med(Bb), bL = 0.299 * bR + 0.587 * bG + 0.114 * bB;
    const dist = new Float32Array(N);
    for (let j = 0; j < N; j++) dist[j] = Math.hypot(Rr[j] - bR, Gg[j] - bG, Bb[j] - bB);
    const D = blur(blur(dist, W, H), W, H);
    const P = new Float32Array(N); for (let j = 0; j < N; j++) P[j] = L[j] - 1.3 * S[j];
    const maps = [L, D, P];
    // fond clair (bureau blanc) : la feuille est « plus claire que le fond » de peu → seuil relatif
    if (bL > 150) { const Q = new Float32Array(N); for (let j = 0; j < N; j++) Q[j] = (L[j] - bL) - 0.8 * S[j]; maps.push(Q); }

    // contours (force et direction) : servent à départager les candidats et à trouver les lignes droites
    const E = edges(L, W, H);
    const cands = [];
    for (const m of maps) {
      const th = otsuF(m);
      const bin = new Uint8Array(N);
      for (let j = 0; j < N; j++) bin[j] = m[j] > th ? 1 : 0;
      morph(bin, W, H, 2);
      for (const comp of components(bin, W, H, N * 0.08)) {
        const q = quadFrom(comp, W, H, fast);
        if (q) cands.push(q);
      }
    }
    // 2e méthode, sans zones : les 4 plus longues lignes droites qui forment une feuille
    // (utile quand le fond a presque la même teinte que le papier)
    if (!fast) for (const q of houghQuads(E, W, H)) cands.push(q);
    let best = null;
    for (const q of cands) {
      const sup = q.sup = support(q.pts, E, W, H), ang = angleScore(q.pts), af = quadArea(q.pts) / (W * H);
      q.final = sup * (0.5 + 0.5 * ang) * (0.5 + 0.5 * Math.sqrt(af)) * (q.score != null ? 0.85 + 0.15 * q.score : 0.9);
      if (!best || q.final > best.final) best = q;
    }
    if (best) best = extend(best, cands, L, S, W, H);
    if (opts.debug) opts.debug.push(...cands.map(q => ({ pts: q.pts.map(p => ({ x: Math.round(p.x / k), y: Math.round(p.y / k) })), final: +q.final.toFixed(3), region: q.score != null ? +q.score.toFixed(3) : null, sup: +support(q.pts, E, W, H).toFixed(3) })));
    if (!best || best.final < 0.45) return { pts: def, found: false, score: best ? best.final : 0 };
    let pts = best.pts.map(p => ({ x: p.x / k, y: p.y / k }));
    if (!fast) pts = snap(src, pts) || pts;
    pts = pts.map(p => ({ x: Math.max(0, Math.min(SW, p.x)), y: Math.max(0, Math.min(SH, p.y)) }));
    if (quadArea(pts) < SW * SH * 0.08) return { pts: def, found: false, score: best.final };
    return { pts, found: true, score: best.final };
  }

  /* côté posé sur un bord de la photo → la droite de ce bord */
  function borderLine(a, b, W, H, t) {
    if (a.x <= t && b.x <= t) return [1, 0, 0];
    if (a.x >= W - t && b.x >= W - t) return [1, 0, -W];
    if (a.y <= t && b.y <= t) return [0, 1, 0];
    if (a.y >= H - t && b.y >= H - t) return [0, 1, -H];
    return null;
  }
  /* force et direction des contours (Sobel) */
  function edges(L, W, H) {
    const N = W * H, gx = new Float32Array(N), gy = new Float32Array(N), mag = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const a = L[i - W - 1], b = L[i - W], c = L[i - W + 1], d = L[i - 1], f = L[i + 1], g = L[i + W - 1], h = L[i + W], k = L[i + W + 1];
      const X = (c + 2 * f + k) - (a + 2 * d + g), Y = (g + 2 * h + k) - (a + 2 * b + c);
      gx[i] = X; gy[i] = Y; mag[i] = Math.hypot(X, Y);
    }
    // seuil : les 10 % de pixels les plus contrastés (mais jamais du bruit pur)
    const hist = new Uint32Array(512); let mx = 0;
    for (let i = 0; i < N; i++) if (mag[i] > mx) mx = mag[i];
    const sc = 511 / (mx || 1);
    for (let i = 0; i < N; i++) hist[(mag[i] * sc) | 0]++;
    let acc = 0, th = mx;
    for (let v = 511; v >= 0; v--) { acc += hist[v]; if (acc >= N * 0.18) { th = v / sc; break; } }
    return { gx, gy, mag, th: Math.max(th, 10) };
  }
  /* part du contour du quadrilatère qui suit un vrai bord net, parallèle au côté */
  function support(q, E, W, H) {
    let sum = 0, mn = 1;
    for (let s = 0; s < 4; s++) {
      const a = q[s], b = q[(s + 1) % 4];
      let cov;
      if (borderLine(a, b, W, H, 2.5)) cov = 0.45;   // côté coupé par la photo : ni preuve ni contre-preuve
      else {
        const dx = b.x - a.x, dy = b.y - a.y, Ls = Math.hypot(dx, dy) || 1, nx = -dy / Ls, ny = dx / Ls;
        let hit = 0, n = 0;
        for (let t = 0.06; t <= 0.94; t += 0.022) {
          n++;
          const px = a.x + dx * t, py = a.y + dy * t;
          for (let o = -2; o <= 2; o++) {
            const x = Math.round(px + nx * o), y = Math.round(py + ny * o);
            if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
            const i = y * W + x, m = E.mag[i];
            if (m > E.th && Math.abs(E.gx[i] * nx + E.gy[i] * ny) > 0.8 * m) { hit++; break; }
          }
        }
        cov = n ? hit / n : 0;
      }
      sum += cov; if (cov < mn) mn = cov;
    }
    return 0.6 * sum / 4 + 0.4 * mn;
  }
  /* Un candidat plus grand qui englobe le meilleur, et dont la bande en plus est du même
     papier (marge, barre noire, tableau…), est la vraie feuille : la ligne trouvée était DANS la feuille. */
  function extend(best, cands, L, S, W, H) {
    const at = (x, y) => { x = Math.round(x); y = Math.round(y); return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x; };
    const inside = (q, p) => { for (let s = 0; s < 4; s++) { const a = q[s], b = q[(s + 1) % 4]; if (((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / (Math.hypot(b.x - a.x, b.y - a.y) || 1) < -3) return false; } return true; };
    const tone = q => { const l = [], t = []; grid(q, 9, (x, y) => { const i = at(x, y); if (i >= 0) { l.push(L[i]); t.push(S[i]); } }); l.sort((u, v) => u - v); t.sort((u, v) => u - v); return [l[l.length >> 1], t[t.length >> 1]]; };
    for (let guard = 0; guard < 4; guard++) {
      const [pL, pS] = tone(best.pts), A0 = quadArea(best.pts);
      let nb = null;
      for (const c of cands) {
        if (c === best || c.sup < 0.7 || c.sup < best.sup * 0.8) continue;
        const A = quadArea(c.pts); if (A < A0 * 1.03) continue;
        if (!best.pts.every(p => inside(c.pts, p))) continue;
        let n = 0, ok = 0;
        grid(c.pts, 24, (x, y) => { if (inside(best.pts, { x, y })) return; const i = at(x, y); if (i < 0) return; n++; if (Math.abs(L[i] - pL) < 22 && Math.abs(S[i] - pS) < 18) ok++; });
        if (n >= 6 && ok / n >= 0.55 && (!nb || A > quadArea(nb.pts))) nb = c;
      }
      if (!nb) break;
      best = nb;
    }
    return best;
  }
  function grid(q, n, fn) {
    for (let u = 0.5 / n; u < 1; u += 1 / n) for (let v = 0.5 / n; v < 1; v += 1 / n) {
      const tx = q[0].x + (q[1].x - q[0].x) * u, ty = q[0].y + (q[1].y - q[0].y) * u, bx = q[3].x + (q[2].x - q[3].x) * u, by = q[3].y + (q[2].y - q[3].y) * u;
      fn(tx + (bx - tx) * v, ty + (by - ty) * v);
    }
  }
  /* Transformée de Hough : grandes lignes droites → quadrilatères candidats */
  function houghQuads(E, W, H) {
    const nT = 120, dT = Math.PI / nT, diag = Math.ceil(Math.hypot(W, H)), nR = 2 * diag + 1;
    const acc = new Float32Array(nT * nR), cs = new Float32Array(nT), sn = new Float32Array(nT);
    for (let t = 0; t < nT; t++) { cs[t] = Math.cos(t * dT); sn[t] = Math.sin(t * dT); }
    const win = 4; // ±6° autour de la direction du contour
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, m = E.mag[i]; if (m <= E.th) continue;
      let ph = Math.atan2(E.gy[i], E.gx[i]); if (ph < 0) ph += Math.PI; if (ph >= Math.PI) ph -= Math.PI;
      const t0 = Math.round(ph / dT);
      for (let dt = -win; dt <= win; dt++) {
        const t = ((t0 + dt) % nT + nT) % nT;
        const r = Math.round(x * cs[t] + y * sn[t]) + diag;
        acc[t * nR + r] += 1;
      }
    }
    // pics locaux
    const peaks = [];
    let amax = 0; for (let i = 0; i < acc.length; i++) if (acc[i] > amax) amax = acc[i];
    const minV = Math.max(15, amax * 0.12);
    for (let t = 0; t < nT; t++) for (let r = 1; r < nR - 1; r++) {
      const v = acc[t * nR + r]; if (v < minV) continue;
      let ok = true;
      for (let dt = -3; dt <= 3 && ok; dt++) for (let dr = -4; dr <= 4; dr++) {
        if (!dt && !dr) continue;
        let tt = t + dt, rr = r + dr;
        if (tt < 0) { tt += nT; rr = nR - 1 - rr; } else if (tt >= nT) { tt -= nT; rr = nR - 1 - rr; }
        if (rr < 0 || rr >= nR) continue;
        const w = acc[tt * nR + rr]; if (w > v || (w === v && (dt < 0 || (dt === 0 && dr < 0)))) { ok = false; break; }
      }
      if (ok) peaks.push({ v, th: t * dT, line: [cs[t], sn[t], -(r - diag)] });
    }
    peaks.sort((a, b) => b.v - a.v);
    const L = peaks.slice(0, 22);
    // les bords de la photo comptent aussi (feuille coupée)
    [[1, 0, 0, 0], [1, 0, -W, 0], [0, 1, 0, Math.PI / 2], [0, 1, -H, Math.PI / 2]].forEach(b => L.push({ v: 0, th: b[3], line: [b[0], b[1], b[2]], border: true }));
    const angD = (a, b) => { let d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };
    const pairs = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      if (L[i].border && L[j].border) continue;
      if (angD(L[i].th, L[j].th) > 0.5) continue;                // ~ parallèles (perspective comprise)
      const mid = { x: W / 2, y: H / 2 };
      const di = L[i].line[0] * mid.x + L[i].line[1] * mid.y + L[i].line[2], dj = L[j].line[0] * mid.x + L[j].line[1] * mid.y + L[j].line[2];
      const sameSide = Math.sign(di) === Math.sign(dj * (Math.cos(angD(L[i].th, L[j].th)) > 0 && Math.abs(L[i].th - L[j].th) > Math.PI / 2 ? -1 : 1));
      void sameSide;
      pairs.push([L[i], L[j], (L[i].th + (angD(L[i].th, L[j].th) < Math.abs(L[i].th - L[j].th) ? L[j].th + (L[j].th < L[i].th ? Math.PI : -Math.PI) : L[j].th)) / 2]);
    }
    const out = [];
    for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) {
      const A = pairs[a], B = pairs[b];
      const d = angD(A[2], B[2]); if (d < 0.95) continue;        // les deux familles ~ perpendiculaires
      if ([A[0], A[1]].some(l => l === B[0] || l === B[1])) continue;
      const P = [inter(A[0].line, B[0].line), inter(B[0].line, A[1].line), inter(A[1].line, B[1].line), inter(B[1].line, A[0].line)];
      if (P.some(p => !p || p.x < -2 || p.y < -2 || p.x > W + 2 || p.y > H + 2)) continue;
      if (!isConvex(P)) continue;
      const q = order(P), ar = quadArea(q);
      if (ar < W * H * 0.1 || ar > W * H * 0.985) continue;
      out.push({ pts: q, score: null });
    }
    return out;
  }

  function blur(a, W, H) { // flou 3×3 rapide (séparable)
    const t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < W; x++) { const l = x ? a[r + x - 1] : a[r + x], rr = x < W - 1 ? a[r + x + 1] : a[r + x]; t[r + x] = (l + a[r + x] + rr) / 3; } }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, u = y ? t[i - W] : t[i], dn = y < H - 1 ? t[i + W] : t[i]; o[i] = (u + t[i] + dn) / 3; }
    return o;
  }
  function otsuF(a) {
    let mn = Infinity, mx = -Infinity; for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < 1e-6) return mx;
    const q = new Uint8ClampedArray(a.length), sc = 255 / (mx - mn);
    for (let i = 0; i < a.length; i++) q[i] = (a[i] - mn) * sc;
    return mn + otsu(q) / sc;
  }
  /* fermeture puis ouverture : bouche les lettres, retire les miettes */
  function morph(bin, W, H, r) {
    const op = (src, dil) => {
      const t = new Uint8Array(src.length), o = new Uint8Array(src.length);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = dil ? 0 : 1; for (let dx = -r; dx <= r; dx++) { const xx = Math.min(W - 1, Math.max(0, x + dx)); const s = src[y * W + xx]; if (dil ? s : !s) { v = dil ? 1 : 0; break; } } t[y * W + x] = v; }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = dil ? 0 : 1; for (let dy = -r; dy <= r; dy++) { const yy = Math.min(H - 1, Math.max(0, y + dy)); const s = t[yy * W + x]; if (dil ? s : !s) { v = dil ? 1 : 0; break; } } o[y * W + x] = v; }
      return o;
    };
    let m = op(op(bin, true), false); m = op(op(m, false), true);
    bin.set(m);
  }
  /* zones d'un seul tenant (les 2 plus grandes au-dessus d'une taille mini), trous bouchés */
  function components(bin, W, H, minA) {
    const N = W * H, lab = new Int32Array(N), stack = new Int32Array(N), sizes = [0];
    let cur = 0;
    for (let s = 0; s < N; s++) {
      if (!bin[s] || lab[s]) continue;
      cur++; let sp = 0, n = 0; stack[sp++] = s; lab[s] = cur;
      while (sp) {
        const p = stack[--sp]; n++; const x = p % W;
        if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; stack[sp++] = p - 1; }
        if (x < W - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; stack[sp++] = p + 1; }
        if (p >= W && bin[p - W] && !lab[p - W]) { lab[p - W] = cur; stack[sp++] = p - W; }
        if (p < N - W && bin[p + W] && !lab[p + W]) { lab[p + W] = cur; stack[sp++] = p + W; }
      }
      sizes.push(n);
    }
    const ids = sizes.map((n, i) => [n, i]).filter(([n, i]) => i && n >= minA && n < N * 0.985).sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]);
    return ids.map(id => {
      const m = new Uint8Array(N); for (let i = 0; i < N; i++) if (lab[i] === id) m[i] = 1;
      // trous : tout ce qui n'est pas relié au bord de l'image
      const out = new Uint8Array(N); let sp = 0;
      const push = i => { if (!m[i] && !out[i]) { out[i] = 1; stack[sp++] = i; } };
      for (let x = 0; x < W; x++) { push(x); push(N - W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
      while (sp) { const p = stack[--sp], x = p % W; if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < N - W) push(p + W); }
      let area = 0; for (let i = 0; i < N; i++) { if (!out[i]) m[i] = 1; area += m[i]; }
      return { m, area };
    });
  }
  /* contour → enveloppe → quadrilatère → côtés redressés */
  function quadFrom(comp, W, H, fast) {
    const { m, area } = comp, pts = [], edgePts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!m[i]) continue;
      const onB = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      if (onB || !m[i - 1] || !m[i + 1] || !m[i - W] || !m[i + W]) { pts.push([x, y]); if (!onB) edgePts.push([x, y]); }
    }
    if (pts.length < 20) return null;
    const hull = convexHull(pts);
    if (hull.length < 4) return null;
    let q = bestQuad(hull);
    if (!q) return null;
    // deux passes : large bande (corrige un coin faussé), puis bande fine
    const md = Math.min(W, H);
    let inl = 0;
    for (const band of [md * 0.09, md * 0.03]) {
      const lines = [];
      inl = 0;
      for (let s = 0; s < 4; s++) {
        const a = q[s], b = q[(s + 1) % 4];
        const bl = borderLine(a, b, W, H, 2.5);
        if (bl) { lines.push(bl); continue; }        // feuille coupée par le bord de la photo
        const near = edgePts.filter(p => segDist(p, a, b) < band);
        const f = ransacLine(near, Math.max(1.2, md / 220), fast ? 40 : 90);
        if (f && f.n >= 10) { lines.push(f.line); inl += f.n; }
        else lines.push(borderOrChord(a, b, W, H));
      }
      const nq = [];
      for (let s = 0; s < 4; s++) { const p = inter(lines[(s + 3) % 4], lines[s]); nq.push(p && p.x > -W * 0.3 && p.x < W * 1.3 && p.y > -H * 0.3 && p.y < H * 1.3 ? p : q[s]); }
      if (isConvex(nq)) q = nq;
    }
    const qa = quadArea(q);
    if (qa < W * H * 0.08) return null;
    const fill = area / qa, fillS = Math.min(fill, 1 / fill);
    const straight = edgePts.length ? Math.min(1, inl / edgePts.length) : 1;
    const ang = angleScore(q);
    const frac = qa / (W * H), sizeS = frac > 0.97 ? 0.3 : 1;
    return { pts: q, score: (0.4 * fillS + 0.35 * straight + 0.25 * ang) * sizeS };
  }
  function convexHull(p) {
    p = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1)).map(([x, y]) => ({ x, y }));
  }
  /* 4 sommets de l'enveloppe qui couvrent la plus grande surface, dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche */
  function bestQuad(h) {
    const n = h.length;
    let I = [0, 0, 0, 0];
    const ext = [p => -(p.x + p.y), p => p.x - p.y, p => p.x + p.y, p => p.y - p.x];
    ext.forEach((f, j) => { let bi = 0; for (let i = 1; i < n; i++) if (f(h[i]) > f(h[bi])) bi = i; I[j] = bi; });
    const area = J => quadArea(J.map(i => h[i]));
    for (let it = 0; it < 3; it++) for (let j = 0; j < 4; j++) {
      let bi = I[j], ba = area(I);
      for (let i = 0; i < n; i++) { const T = I.slice(); T[j] = i; const a = area(T); if (a > ba && isConvex(T.map(t => h[t]))) { ba = a; bi = i; } }
      I[j] = bi;
    }
    const q = I.map(i => ({ x: h[i].x, y: h[i].y }));
    return isConvex(q) ? order(q) : null;
  }
  function order(q) {
    const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
    const s = q.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); // sens horaire (y vers le bas)
    let tl = 0; s.forEach((p, i) => { if (p.x + p.y < s[tl].x + s[tl].y) tl = i; });
    return [0, 1, 2, 3].map(i => s[(tl + i) % 4]);
  }
  function isConvex(q) {
    let sg = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(z) < 1e-9) return false;
      if (!sg) sg = Math.sign(z); else if (Math.sign(z) !== sg) return false;
    }
    return true;
  }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    const t = ((p[0] - a.x) * dx + (p[1] - a.y) * dy) / L2;
    if (t < -0.08 || t > 1.08) return Infinity;
    return Math.abs((p[0] - a.x) * dy - (p[1] - a.y) * dx) / Math.sqrt(L2);
  }
  /* ligne robuste : tirages au hasard (graine fixe → résultat stable), puis moindres carrés sur les bons points */
  function ransacLine(P, tol, iters) {
    if (P.length < 10) return null;
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let best = null, bn = 0;
    for (let it = 0; it < iters; it++) {
      const a = P[(rnd() * P.length) | 0], b = P[(rnd() * P.length) | 0];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 5) continue;
      const nx = -dy / L, ny = dx / L, c = -(nx * a[0] + ny * a[1]);
      let n = 0; for (const p of P) if (Math.abs(nx * p[0] + ny * p[1] + c) < tol) n++;
      if (n > bn) { bn = n; best = [nx, ny, c]; }
    }
    if (!best) return null;
    const In = P.filter(p => Math.abs(best[0] * p[0] + best[1] * p[1] + best[2]) < tol * 1.5);
    return { line: fitLine(In) || best, n: In.length };
  }
  function fitLine(P) { // droite des moindres carrés (orthogonale)
    if (P.length < 2) return null;
    let mx = 0, my = 0; for (const p of P) { mx += p[0]; my += p[1]; } mx /= P.length; my /= P.length;
    let sxx = 0, syy = 0, sxy = 0; for (const p of P) { const x = p[0] - mx, y = p[1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(th), dy = Math.sin(th);
    const nx = -dy, ny = dx;
    return [nx, ny, -(nx * mx + ny * my)];
  }
  function borderOrChord(a, b) { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L; return [nx, ny, -(nx * a.x + ny * a.y)]; }
  function inter(l1, l2) {
    const det = l1[0] * l2[1] - l2[0] * l1[1];
    if (Math.abs(det) < 1e-9) return null;
    return { x: (l1[1] * l2[2] - l2[1] * l1[2]) / det, y: (l2[0] * l1[2] - l1[0] * l2[2]) / det };
  }
  function angleScore(q) {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
      const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
      const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
      s += Math.max(0, 1 - Math.abs(cos) / 0.6);   // 90° → 1, au-delà de ±37° de l'angle droit → 0
    }
    return s / 4;
  }
  /* Calage fin : chaque côté est recollé sur le plus fort contraste tout près de lui, à plus haute définition */
  function snap(src, pts) {
    const { c, k } = small(src, 1100);
    const W = c.width, H = c.height;
    const g = gray(ctx(c).getImageData(0, 0, W, H).data);
    const q = pts.map(p => ({ x: p.x * k, y: p.y * k }));
    const R = Math.max(4, Math.round(Math.hypot(W, H) * 0.012));
    const lines = [];
    for (let s = 0; s < 4; s++) {
      const a = q[s], b = q[(s + 1) % 4], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 20) return null;
      const bl = borderLine(a, b, W, H, Math.max(3, W * 0.006));
      if (bl) { lines.push(bl); continue; }
      const nx = -dy / L, ny = dx / L, found = [];
      for (let t = 0.1; t <= 0.9001; t += 0.02) {
        const px = a.x + dx * t, py = a.y + dy * t;
        let bv = 0, bo = null;
        for (let o = -R; o <= R; o++) {
          const x = Math.round(px + nx * o), y = Math.round(py + ny * o);
          const x1 = Math.round(px + nx * (o - 1.5)), y1 = Math.round(py + ny * (o - 1.5)), x2 = Math.round(px + nx * (o + 1.5)), y2 = Math.round(py + ny * (o + 1.5));
          if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 >= W || x2 >= W || y1 >= H || y2 >= H || x < 0 || y < 0 || x >= W || y >= H) continue;
          const v = Math.abs(g[y2 * W + x2] - g[y1 * W + x1]);
          if (v > bv) { bv = v; bo = [px + nx * o, py + ny * o]; }
        }
        if (bo && bv > 12) found.push(bo);
      }
      const f = ransacLine(found, 1.6, 80);
      if (!f || f.n < found.length * 0.45 || f.n < 8) { lines.push(borderOrChord(a, b)); continue; }
      lines.push(f.line);
    }
    const out = [];
    for (let s = 0; s < 4; s++) {
      const p = inter(lines[(s + 3) % 4], lines[s]);
      if (!p || Math.hypot(p.x - q[s].x, p.y - q[s].y) > R * 2.5) out.push(q[s]); else out.push(p);
    }
    return isConvex(out) ? out.map(p => ({ x: p.x / k, y: p.y / k })) : null;
  }
  function inset(w, h, m) { return [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }]; }
  function quadArea(p) { let a = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += p[i].x * p[j].y - p[j].x * p[i].y; } return Math.abs(a) / 2; }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* ---------- Correction de perspective ---------- */
  function solve(A, b) { // élimination de Gauss
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let mx = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[mx][i])) mx = r;
      [A[i], A[mx]] = [A[mx], A[i]]; [b[i], b[mx]] = [b[mx], b[i]];
      for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
    return x;
  }
  function homography(from, to) { // de « from » (rectangle) vers « to » (coins photo)
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = from[i], { x: X, y: Y } = to[i];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    return solve(A, b);
  }
  function warpCPU(src, pts, maxSide = 2200) {
    let w = Math.round((dist(pts[0], pts[1]) + dist(pts[3], pts[2])) / 2);
    let h = Math.round((dist(pts[0], pts[3]) + dist(pts[1], pts[2])) / 2);
    const k = Math.min(1, maxSide / Math.max(w, h)); w = Math.max(10, Math.round(w * k)); h = Math.max(10, Math.round(h * k));
    const sw = src.width || src.videoWidth, sh = src.height || src.videoHeight;
    const sc = src instanceof HTMLCanvasElement ? src : (() => { const c = mk(sw, sh); ctx(c).drawImage(src, 0, 0); return c; })();
    const S = ctx(sc).getImageData(0, 0, sw, sh).data;
    const out = mk(w, h), oc = ctx(out), O = oc.createImageData(w, h), D = O.data;
    const H = homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], pts);
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        const z = H[6] * u + H[7] * v + 1;
        const x = (H[0] * u + H[1] * v + H[2]) / z, y = (H[3] * u + H[4] * v + H[5]) / z;
        const x0 = x | 0, y0 = y | 0, o = (v * w + u) * 4;
        if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { D[o] = D[o + 1] = D[o + 2] = 255; D[o + 3] = 255; continue; }
        const fx = x - x0, fy = y - y0, i = (y0 * sw + x0) * 4, j = i + sw * 4;
        for (let c = 0; c < 3; c++) {
          const a = S[i + c] * (1 - fx) + S[i + 4 + c] * fx, bb = S[j + c] * (1 - fx) + S[j + 4 + c] * fx;
          D[o + c] = a * (1 - fy) + bb * fy;
        }
        D[o + 3] = 255;
      }
    }
    oc.putImageData(O, 0, 0);
    return out;
  }


  /* ---------- Accélération par la carte graphique (WebGL) ----------
     Redressement et filtre « document » calculés par le GPU du téléphone :
     10 à 30 fois plus rapide qu'en JavaScript. Repli automatique sur la
     version JavaScript si WebGL n'est pas disponible. */
  let GL = null;
  function glInit() {
    if (GL !== null) return GL;
    try {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
      if (!g) return (GL = false);
      const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
      const prog = fs => {
        const P = g.createProgram();
        for (const [type, src] of [[g.VERTEX_SHADER, vs], [g.FRAGMENT_SHADER, fs]]) {
          const sh = g.createShader(type); g.shaderSource(sh, src); g.compileShader(sh);
          if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh));
          g.attachShader(P, sh);
        }
        g.linkProgram(P); if (!g.getProgramParameter(P, g.LINK_STATUS)) throw new Error('link');
        return P;
      };
      const warpP = prog(`precision highp float;
        uniform sampler2D t; uniform mat3 H; uniform vec2 S, O;
        vec4 at(vec2 o){ vec3 q = H * vec3(o, 1.); vec2 s = q.xy / q.z;
          if (s.x < 0. || s.y < 0. || s.x > S.x || s.y > S.y) return vec4(1.); return texture2D(t, s / S); }
        void main(){ vec2 o = vec2(gl_FragCoord.x, O.y - gl_FragCoord.y);
          gl_FragColor = vec4(((at(o + vec2(-.25,-.25)) + at(o + vec2(.25,-.25)) + at(o + vec2(-.25,.25)) + at(o + vec2(.25,.25))) * .25).rgb, 1.); }`);
      const filtP = prog(`precision highp float;
        uniform sampler2D t, b; uniform vec2 O;
        void main(){ vec2 uv = vec2(gl_FragCoord.x, O.y - gl_FragCoord.y) / O;
          vec3 c = texture2D(t, uv).rgb, r = max(texture2D(b, uv).rgb, vec3(70. / 255.));
          vec3 v = min(vec3(1.), c * min(vec3(2.4), vec3(245. / 255.) / r));
          vec3 o = mix(v / .93, vec3(1.), step(.93, v));
          gl_FragColor = vec4(pow(o, vec3(1.5)), 1.); }`);
      const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
      GL = { c, g, warpP, filtP, max: g.getParameter(g.MAX_TEXTURE_SIZE) };
    } catch (e) { GL = false; }
    return GL;
  }
  function glTex(g, unit, img) {
    const t = g.createTexture(); g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, t);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
    return t;
  }
  function glRun(P, w, h, setup) {
    const { c, g } = GL;
    c.width = w; c.height = h; g.viewport(0, 0, w, h);
    g.useProgram(P);
    const loc = g.getAttribLocation(P, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    const texs = setup(g, n => g.getUniformLocation(P, n));
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    const out = mk(w, h), oc = ctx(out); oc.drawImage(c, 0, 0);
    texs.forEach(t => g.deleteTexture(t));
    if (g.getError() !== g.NO_ERROR) throw new Error('gl');
    // contrôle : une image vide (GPU qui a échoué sans le dire) → version JavaScript
    const px = oc.getImageData(w >> 1, h >> 1, 1, 1).data;
    if (px[3] !== 255) throw new Error('gl vide');
    return out;
  }
  function warp(src, pts, maxSide = 2200) {
    const G2 = glInit(), sw = src.width || src.videoWidth, sh = src.height || src.videoHeight;
    if (G2 && sw <= G2.max && sh <= G2.max) {
      try {
        let w = Math.round((dist(pts[0], pts[1]) + dist(pts[3], pts[2])) / 2);
        let h = Math.round((dist(pts[0], pts[3]) + dist(pts[1], pts[2])) / 2);
        const k = Math.min(1, maxSide / Math.max(w, h)); w = Math.max(10, Math.round(w * k)); h = Math.max(10, Math.round(h * k));
        if (w <= G2.max && h <= G2.max) {
          const Hm = homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], pts);
          return glRun(G2.warpP, w, h, (g, U) => {
            const t = glTex(g, 0, src);
            g.uniform1i(U('t'), 0);
            g.uniformMatrix3fv(U('H'), false, new Float32Array([Hm[0], Hm[3], Hm[6], Hm[1], Hm[4], Hm[7], Hm[2], Hm[5], 1]));
            g.uniform2f(U('S'), sw, sh); g.uniform2f(U('O'), w, h);
            return [t];
          });
        }
      } catch (e) { /* repli JavaScript */ }
    }
    return warpCPU(src, pts, maxSide);
  }
  /* niveau du papier (petite grille : le plus clair du voisinage, puis lissé) — commun GPU / JS */
  function paperGrid(src) {
    const w = src.width, h = src.height;
    const gw = Math.max(6, Math.round(w / 40)), gh = Math.max(6, Math.round(h / 40));
    const g1 = mk(gw, gh), g1c = ctx(g1); g1c.drawImage(src, 0, 0, gw, gh);
    const gd = g1c.getImageData(0, 0, gw, gh), sd = gd.data, md = new Uint8ClampedArray(sd.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const o = (y * gw + x) * 4; let r = 0, g = 0, bb = 0, best = -1;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(gw - 1, Math.max(0, x + dx)), yy = Math.min(gh - 1, Math.max(0, y + dy)), q = (yy * gw + xx) * 4;
        const l = sd[q] * 77 + sd[q + 1] * 150 + sd[q + 2] * 29;
        if (l > best) { best = l; r = sd[q]; g = sd[q + 1]; bb = sd[q + 2]; }
      }
      md[o] = r; md[o + 1] = g; md[o + 2] = bb; md[o + 3] = 255;
    }
    // lissage 3×3 (deux passes) : transitions douces
    for (let pass = 0; pass < 2; pass++) {
      const cp = md.slice();
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) for (let c = 0; c < 3; c++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; s += cp[(yy * gw + xx) * 4 + c]; n++; }
        md[(y * gw + x) * 4 + c] = s / n;
      }
    }
    gd.data.set(md); g1c.putImageData(gd, 0, 0);
    return g1;
  }
  function filter(src) {
    const G2 = glInit();
    if (G2 && src.width <= G2.max && src.height <= G2.max) {
      try {
        const bg = paperGrid(src);
        return glRun(G2.filtP, src.width, src.height, (g, U) => {
          const t = glTex(g, 0, src), b = glTex(g, 1, bg);
          g.uniform1i(U('t'), 0); g.uniform1i(U('b'), 1); g.uniform2f(U('O'), src.width, src.height);
          return [t, b];
        });
      } catch (e) { /* repli JavaScript */ }
    }
    return filterCPU(src);
  }

  /* ---------- Filtre « document » ---------- */
  /* Mode « Document » doux : on éclaircit le papier de façon uniforme (ombres et
     lumière inégale retirées) et on renforce un peu l'encre, sans jamais passer
     en noir et blanc pur : texte fin, tampons, logos et couleurs restent lisibles. */
  function filterCPU(src) {
    const w = src.width, h = src.height;
    const out = mk(w, h), oc = ctx(out);
    oc.drawImage(src, 0, 0);
    const img = oc.getImageData(0, 0, w, h), d = img.data;
    // niveau du papier : petite grille, puis on garde le plus clair du voisinage
    // (le texte ne « noircit » donc pas l'estimation), puis on lisse et on agrandit.
    const gw = Math.max(6, Math.round(w / 40)), gh = Math.max(6, Math.round(h / 40));
    const g1 = mk(gw, gh), g1c = ctx(g1); g1c.drawImage(src, 0, 0, gw, gh);
    const gd = g1c.getImageData(0, 0, gw, gh), sd = gd.data, md = new Uint8ClampedArray(sd);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const o = (y * gw + x) * 4; let r = 0, g = 0, bb = 0, best = -1;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(gw - 1, Math.max(0, x + dx)), yy = Math.min(gh - 1, Math.max(0, y + dy)), q = (yy * gw + xx) * 4;
        const l = sd[q] * 77 + sd[q + 1] * 150 + sd[q + 2] * 29;
        if (l > best) { best = l; r = sd[q]; g = sd[q + 1]; bb = sd[q + 2]; }
      }
      md[o] = r; md[o + 1] = g; md[o + 2] = bb; md[o + 3] = 255;
    }
    gd.data.set(md); g1c.putImageData(gd, 0, 0);
    const b2 = mk(w, h), b2c = ctx(b2); b2c.imageSmoothingEnabled = true; b2c.imageSmoothingQuality = 'high';
    b2c.filter = 'blur(' + Math.round(Math.max(w, h) / 60) + 'px)';
    b2c.drawImage(g1, 0, 0, w, h);
    const bg = b2c.getImageData(0, 0, w, h).data;
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {               // courbe douce : papier → blanc, encre un peu plus sombre, gris conservés
      const v = i / 255;
      let o = v >= 0.93 ? 1 : v / 0.93;
      o = Math.pow(o, 1.5);
      curve[i] = o * 255;
    }
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const ref = Math.max(70, bg[i + c]);
        const v = Math.min(255, d[i + c] * Math.min(2.4, 245 / ref));
        d[i + c] = curve[v | 0];
      }
    }
    oc.putImageData(img, 0, 0);
    return out;
  }

  function rotate(src, deg) {
    const r = ((deg % 360) + 360) % 360; if (!r) return src;
    const swap = r === 90 || r === 270;
    const out = mk(swap ? src.height : src.width, swap ? src.width : src.height), c = ctx(out);
    c.translate(out.width / 2, out.height / 2); c.rotate(r * Math.PI / 180); c.drawImage(src, -src.width / 2, -src.height / 2);
    return out;
  }

  function stitch(list) {
    const W = Math.min(1800, Math.max(...list.map(c => c.width)));
    const hs = list.map(c => Math.round(c.height * W / c.width));
    const out = mk(W, hs.reduce((a, b) => a + b, 0)), c = ctx(out);
    c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height);
    let y = 0; list.forEach((cv, i) => { c.drawImage(cv, 0, y, W, hs[i]); y += hs[i]; });
    return out;
  }

  /* Netteté (variance du laplacien) et luminosité moyenne */
  function quality(src) {
    const { c } = small(src, 360), W = c.width, H = c.height;
    const g = gray(ctx(c).getImageData(0, 0, W, H).data);
    let s = 0, s2 = 0, n = 0, lum = 0;
    for (let i = 0; i < g.length; i++) lum += g[i];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x, l = 4 * g[p] - g[p - 1] - g[p + 1] - g[p - W] - g[p + W];
      s += l; s2 += l * l; n++;
    }
    const varL = s2 / n - (s / n) ** 2;
    return { sharp: varL, light: lum / g.length, blurry: varL < 60, dark: lum / g.length < 70 };
  }

  /* Netteté du texte, indépendante du contraste : force des contours les plus nets (2 % du haut)
     rapportée à l'écart clair/sombre de la page. ~1 = net ; sous ~0,35 = flou. */
  function sharpText(src) {
    const { c } = small(src, 900), W = c.width, H = c.height;
    const g = gray(ctx(c).getImageData(0, 0, W, H).data);
    const hist = new Uint32Array(256); for (const v of g) hist[v]++;
    const pct = q => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= g.length * q) return v; } return 255; };
    const lo = pct(0.03), hi = pct(0.97), light = pct(0.5);
    const lap = new Uint16Array(1024); let n = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x, l = Math.abs(4 * g[p] - g[p - 1] - g[p + 1] - g[p - W] - g[p + W]);
      lap[Math.min(1023, l)]++; n++;
    }
    let a = 0, top = 0; for (let v = 1023; v >= 0; v--) { a += lap[v]; if (a >= n * 0.02) { top = v; break; } }
    const range = Math.max(20, hi - lo);
    return { score: top / range, light, range };
  }
  G.FLPScan = { detect, warp, filter, rotate, stitch, quality, inset, sharpText, _warpCPU: warpCPU, _filterCPU: filterCPU };
})(window);
