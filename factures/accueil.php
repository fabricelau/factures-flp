<?php
/* Écran de lancement de l'appli installée : « Factures » ou « Photo ». */
require_once __DIR__ . '/lib.php';
$role = flp_role();
if (!$role) { header('Location: ' . flp_base_path() . '?next=accueil'); exit; }
if ($role !== 'admin') { header('Location: ' . flp_base_path()); exit; }   // comptable : directement la liste
$base = flp_base_path();
?><!doctype html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title><?= htmlspecialchars(FLP_SHORT) ?></title>
<meta name="theme-color" content="#0d1114">
<link rel="icon" href="<?= $base ?>icon.php?s=64">
<link rel="manifest" href="<?= $base ?>manifest.webmanifest">
<link rel="apple-touch-icon" href="<?= $base ?>icon.php?s=180">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="<?= htmlspecialchars(FLP_SHORT) ?>">
<link rel="stylesheet" href="<?= flp_asset('assets/app.css') ?>">
<script>try{var t=localStorage.getItem('flp-theme');if(t)document.documentElement.dataset.theme=t;sessionStorage.setItem('flp-lance','1')}catch(e){}</script>
<style>
  body.launch{padding:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;
    padding:max(18px,env(safe-area-inset-top)) var(--g) max(22px,env(safe-area-inset-bottom))}
  .l-head{display:flex;align-items:center;gap:12px;margin:6px 0 22px}
  .l-head img{width:44px;height:44px;border-radius:10px}
  .l-head b{display:block;font:800 22px/1 var(--dsp);text-transform:uppercase;letter-spacing:.02em}
  .l-head small{color:var(--mute);font:600 11px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase}
  .l-choices{flex:1;display:grid;grid-template-rows:1fr 1fr;gap:14px}
  .l-btn{position:relative;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding:22px;border-radius:22px;
    text-decoration:none;color:var(--bone);background:var(--ink2);border:1px solid var(--line);overflow:hidden;
    transition:transform .12s ease,border-color .2s}
  .l-btn:active{transform:scale(.98)}
  .l-btn svg{position:absolute;top:22px;left:22px;width:46px;height:46px;stroke-width:1.6}
  .l-btn b{font:800 clamp(30px,9vw,44px)/1 var(--dsp);text-transform:uppercase;letter-spacing:.01em}
  .l-btn span{color:var(--mute);font-size:15px}
  .l-btn em{position:absolute;top:22px;right:22px;font:700 12px/1 var(--mono);background:var(--acc);color:var(--acc-ink);padding:6px 9px;border-radius:999px;font-style:normal}
  .l-photo{background:var(--acc);border-color:var(--acc);color:var(--acc-ink)}
  .l-photo span{color:color-mix(in srgb,var(--acc-ink) 70%,transparent)}
  @media (min-width:700px){.l-choices{grid-template-rows:none;grid-template-columns:1fr 1fr;max-height:420px}}
</style>
</head>
<body class="launch">
  <header class="l-head">
    <img src="<?= $base ?>icon.php?s=96" alt="">
    <div><b>Factures</b><small><?= htmlspecialchars(FLP_SITE) ?></small></div>
  </header>
  <main class="l-choices">
    <a class="l-btn l-photo" href="<?= $base ?>scan" id="goPhoto">
      <svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg>
      <b>Photo</b><span>Photographier une facture</span>
    </a>
    <a class="l-btn" href="<?= $base ?>" id="goList">
      <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>
      <em id="nCheck" hidden></em>
      <b>Factures</b><span>Voir, vérifier, exporter</span>
    </a>
  </main>
<script>
  // le nombre de factures « à vérifier », en badge (sans ralentir l'affichage)
  fetch(<?= json_encode($base . 'api.php?a=list') ?>, { credentials: 'same-origin' }).then(r => r.json()).then(j => {
    const n = (j.items || []).filter(x => x.check).length;
    if (n) { const e = document.getElementById('nCheck'); e.textContent = n + ' à vérifier'; e.hidden = false; }
  }).catch(() => {});
  // « Photo » ouvre l'appareil photo directement : la demande d'accès à la caméra part dès l'ouverture
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(<?= json_encode($base . 'sw.js') ?>).catch(() => {});
</script>
</body>
</html>
