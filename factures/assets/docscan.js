/* =====================================================================
   Factures FLP — traitement d'image du scanner (sans bibliothèque).
   · detect()  : trouve les 4 coins de la feuille (feuille claire sur fond sombre)
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

  /* ---------- 4 coins de la feuille ---------- */
  function detect(src) {
    const { c, k } = small(src, 420);
    const W = c.width, H = c.height;
    const g = gray(ctx(c).getImageData(0, 0, W, H).data);
    const th = otsu(g);
    const bin = new Uint8Array(W * H);
    for (let i = 0; i < g.length; i++) bin[i] = g[i] > th ? 1 : 0;
    // plus grande zone claire d'un seul tenant
    const lab = new Int32Array(W * H); let bestLab = 0, bestN = 0, cur = 0;
    const stack = new Int32Array(W * H);
    for (let s = 0; s < W * H; s++) {
      if (!bin[s] || lab[s]) continue;
      cur++; let sp = 0, n = 0; stack[sp++] = s; lab[s] = cur;
      while (sp) {
        const p = stack[--sp]; n++;
        const x = p % W, y = (p / W) | 0;
        if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; stack[sp++] = p - 1; }
        if (x < W - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; stack[sp++] = p + 1; }
        if (y > 0 && bin[p - W] && !lab[p - W]) { lab[p - W] = cur; stack[sp++] = p - W; }
        if (y < H - 1 && bin[p + W] && !lab[p + W]) { lab[p + W] = cur; stack[sp++] = p + W; }
      }
      if (n > bestN) { bestN = n; bestLab = cur; }
    }
    const def = inset(src.width || src.videoWidth, src.height || src.videoHeight, 0.06);
    if (!bestLab || bestN < W * H * 0.12 || bestN > W * H * 0.97) return { pts: def, found: false };
    // coins = points extrêmes selon x+y et x−y
    let tl = [0, 0, 1e9], br = [0, 0, -1e9], tr = [0, 0, -1e9], bl = [0, 0, 1e9];
    for (let p = 0; p < W * H; p++) {
      if (lab[p] !== bestLab) continue;
      const x = p % W, y = (p / W) | 0, s = x + y, d = x - y;
      if (s < tl[2]) tl = [x, y, s]; if (s > br[2]) br = [x, y, s];
      if (d > tr[2]) tr = [x, y, d]; if (d < bl[2]) bl = [x, y, d];
    }
    const pts = [tl, tr, br, bl].map(([x, y]) => ({ x: x / k, y: y / k }));
    const area = quadArea(pts), full = (W / k) * (H / k);
    if (area < full * 0.12) return { pts: def, found: false };
    return { pts, found: true };
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
  function filter(src) {
    const w = src.width, h = src.height;
    const out = mk(w, h), oc = ctx(out);
    oc.drawImage(src, 0, 0);
    const img = oc.getImageData(0, 0, w, h), d = img.data;
    // fond estimé : image très réduite puis ré-agrandie (moyenne locale de la lumière)
    const bw = Math.max(8, Math.round(w / 24)), bh = Math.max(8, Math.round(h / 24));
    const b1 = mk(bw, bh); ctx(b1).drawImage(src, 0, 0, bw, bh);
    const b2 = mk(w, h), b2c = ctx(b2); b2c.imageSmoothingEnabled = true; b2c.imageSmoothingQuality = 'high'; b2c.drawImage(b1, 0, 0, w, h);
    const bg = b2c.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      const bgv = Math.max(40, (bg[i] * 77 + bg[i + 1] * 150 + bg[i + 2] * 29) >> 8);
      let v = Math.min(1, g / bgv * 1.08);         // 1 = papier blanc
      v = v > 0.9 ? 1 : Math.pow(Math.max(0, (v - 0.25) / 0.65), 1.6); // fond blanc, encre bien noire
      const o = Math.round(v * 255);
      d[i] = d[i + 1] = d[i + 2] = o;
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
