<?php
require_once __DIR__ . '/lib.php';
if (!flp_is_admin()) { header('Location: ' . flp_base_path()); exit; }
$base = flp_base_path();
?><!doctype html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Scanner une facture · <?= htmlspecialchars(FLP_SITE) ?></title>
<meta name="theme-color" content="#0d1114">
<link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="icon" href="<?= $base ?>icon.php?s=64">
<link rel="manifest" href="<?= $base ?>manifest.webmanifest">
<link rel="apple-touch-icon" href="<?= $base ?>icon.php?s=180">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="<?= htmlspecialchars(FLP_SHORT) ?>">
<link rel="stylesheet" href="<?= flp_asset('assets/app.css') ?>">
<link rel="stylesheet" href="<?= flp_asset('assets/scan.css') ?>">
<script>try{var t=localStorage.getItem('flp-theme');if(t)document.documentElement.dataset.theme=t;
var sa=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone;
if(sa&&!sessionStorage.getItem('flp-lance')&&!document.referrer){sessionStorage.setItem('flp-lance','1');location.replace(<?= json_encode($base . 'accueil') ?>)}}catch(e){}</script>
</head>
<body class="scan">

<header class="sbar">
  <a class="back" href="<?= $base ?>"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>Factures</a>
  <span class="ttl">Scanner</span>
  <span class="queue" id="queue"></span>
</header>

<!-- 1. Appareil photo -->
<section class="stage" id="camView">
  <video id="cam" autoplay playsinline muted></video>
  <div class="guide"><div class="frame"></div></div>
  <svg class="live" id="live" aria-hidden="true"></svg>
  <div class="hint" id="hint">Cadrez la facture, posée à plat</div>
  <div class="camerr" id="camErr" hidden>
    <p><b>Impossible d’ouvrir l’appareil photo.</b></p>
    <p>Autorisez la caméra pour ce site, ou choisissez une photo existante avec le bouton de gauche.</p>
  </div>
  <div class="pagecount" id="pageCount" hidden></div>
</section>

<!-- 2. Réglage des coins -->
<section class="editor" id="editView" hidden>
  <div class="edit-wrap" id="editWrap">
    <canvas id="editCanvas"></canvas>
    <svg id="editQuad" class="quad"></svg>
  </div>
  <p class="edit-hint" id="editHint">Faites glisser les 4 coins sur les bords de la feuille.</p>
  <div class="edit-tools">
    <button class="tool" id="eRot" type="button"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg><span>Tourner</span></button>
    <button class="tool" id="eFilter" type="button" aria-pressed="true"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg><span>Document</span></button>
    <button class="tool" id="eAuto" type="button"><svg viewBox="0 0 24 24"><path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2"/></svg><span>Bords auto</span></button>
    <button class="tool" id="eFull" type="button"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg><span>Toute la photo</span></button>
  </div>
  <div class="edit-foot">
    <button class="btn" id="eRetake" type="button">Reprendre</button>
    <button class="btn btn-acc" id="eOk" type="button">Valider</button>
  </div>
</section>

<!-- 3. Aperçu avant envoi -->
<section class="review" id="reviewView" hidden>
  <div class="pages" id="pages"></div>
  <div class="review-foot">
    <button class="btn" id="rMore" type="button"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Ajouter une page</button>
    <button class="btn btn-acc" id="rSend" type="button">Envoyer</button>
  </div>
</section>

<!-- 4. Validation rapide après l'envoi -->
<section class="quick" id="quickView" hidden>
  <div class="quick-box">
    <div class="quick-head"><img id="qThumb" alt=""><div><b id="qTitle">Facture envoyée</b><small id="qSub">Vérifiez et validez</small></div></div>
    <form id="qForm" autocomplete="off">
      <input type="hidden" name="id">
      <label class="fld">Fournisseur<input name="societe" list="qSocs"></label>
      <datalist id="qSocs"></datalist>
      <div class="row2">
        <label class="fld">Montant TTC <span id="qCur" class="muted"></span><input name="montant" inputmode="decimal"></label>
        <label class="fld">Date<input name="date" type="date"></label>
      </div>
      <label class="fld">Catégorie<select name="categorie" id="qCat"></select></label>
      <div class="quick-foot">
        <button type="button" class="btn" id="qLater">Plus tard</button>
        <button type="submit" class="btn btn-acc">Valider</button>
      </div>
    </form>
  </div>
</section>

<div class="busy" id="busy" hidden><div class="spin"></div><p id="busyTxt">Traitement…</p></div>

<nav class="modes" id="modes">
  <button class="mode" data-m="1" aria-pressed="true">1 page</button>
  <button class="mode" data-m="multi" aria-pressed="false">Plusieurs pages</button>
  <button class="mode" data-m="long" aria-pressed="false">Ticket long</button>
</nav>
<nav class="controls" id="controls">
  <label class="ctrl gallery" title="Choisir une photo ou un PDF">
    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
    <input type="file" accept="image/*,application/pdf,.heic,.heif" multiple hidden id="pick">
  </label>
  <button class="shutter" id="shot" aria-label="Prendre la photo"></button>
  <div class="ctrl-col">
    <button class="ctrl" id="torch" aria-label="Lampe" hidden><svg viewBox="0 0 24 24"><path d="M9 2h6l-1 7h4L10 22l1-9H7z"/></svg></button>
    <button class="ctrl" id="flip" aria-label="Changer de caméra"><svg viewBox="0 0 24 24"><path d="M3 7h3l2-2h8l2 2h3v12H3z"/><path d="M9 13a3 3 0 0 0 5.2 2M15 13a3 3 0 0 0-5.2-2"/></svg></button>
  </div>
</nav>

<div class="install" id="install" hidden>
  <p><b>Astuce :</b> installez l’appli sur l’écran d’accueil pour l’ouvrir d’un geste.</p>
  <button id="installBtn" class="btn btn-acc">Installer</button>
  <button class="x" id="installX" aria-label="Fermer">✕</button>
</div>
<div class="toasts" id="toasts"></div>

<script>window.FLP = { base: <?= json_encode($base) ?>, t: <?= json_encode(flp_csrf()) ?> };</script>
<script src="<?= flp_asset('assets/common.js') ?>"></script>
<script src="<?= flp_asset('assets/extract.js') ?>"></script>
<script src="<?= flp_asset('assets/docscan.js') ?>"></script>
<script src="<?= flp_asset('assets/scan.js') ?>"></script>
</body>
</html>
