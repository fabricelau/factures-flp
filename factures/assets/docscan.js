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

    let best = null;
    for (const m of maps) {
      const th = otsuF(m);
      const bin = new Uint8Array(N);
      for (let j = 0; j < N; j++) bin[j] = m[j] > th ? 1 : 0;
      morph(bin, W, H, 2);
      for (const comp of components(bin, W, H, N * 0.08)) {
        const q = quadFrom(comp, W, H, fast);
        if (q && (!best || q.score > best.score)) best = q;
      }
    }
    if (!best || best.score < 0.55) return { pts: def, found: false, score: best ? best.score : 0 };
    let pts = best.pts.map(p => ({ x: p.x / k, y: p.y / k }));
    if (!fast) pts = snap(src, pts) || pts;
    pts = pts.map(p => ({ x: Math.max(0, Math.min(SW, p.x)), y: Math.max(0, Math.min(SH, p.y)) }));
    if (quadArea(pts) < SW * SH * 0.08) return { pts: def, found: false, score: best.score };
    return { pts, found: true, score: best.score };
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
  function warp(src, pts, maxSide = 2200) {
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

  /* ---------- Filtre « document » ---------- */
  /* Mode « Document » doux : on éclaircit le papier de façon uniforme (ombres et
     lumière inégale retirées) et on renforce un peu l'encre, sans jamais passer
     en noir et blanc pur : texte fin, tampons, logos et couleurs restent lisibles. */
  function filter(src) {
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

  G.FLPScan = { detect, warp, filter, rotate, stitch, quality, inset };
})(window);
