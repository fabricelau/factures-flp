<?php
/* Coquille de l'application (servie seulement quand on est connecté). */
require_once __DIR__ . '/lib.php';
flp_require_login();
$base = flp_base_path();
$admin = flp_is_admin();
?><!doctype html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Factures · <?= htmlspecialchars(FLP_SITE) ?></title>
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
<script>try{var t=localStorage.getItem('flp-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body class="<?= $admin ? 'is-admin' : 'is-compta' ?>">

<header class="top">
  <div class="brand">
    <img src="<?= $base ?>icon.php?s=96" alt="" width="38" height="38">
    <div><b>Factures</b><small><?= htmlspecialchars(FLP_SITE) ?><?= $admin ? '' : ' · accès comptable' ?></small></div>
  </div>
  <div class="top-act">
    <?php if ($admin): ?>
    <a class="btn btn-acc" href="<?= $base ?>scan"><svg viewBox="0 0 24 24"><path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M3 12h18"/></svg><span>Scanner</span></a>
    <button class="btn" id="impBtn" type="button"><svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg><span>Importer</span></button>
    <input id="imp" type="file" accept="image/*,application/pdf,.heic,.heif" multiple hidden>
    <?php endif; ?>
    <button class="btn btn-ic" id="menuBtn" aria-label="Menu"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>
  </div>
</header>

<nav class="tabs" id="tabs" role="tablist">
  <button role="tab" data-tab="achat" aria-selected="true">Reçues</button>
  <button role="tab" data-tab="vente" aria-selected="false">Émises</button>
  <button role="tab" data-tab="bord" aria-selected="false">Tableau de bord</button>
</nav>

<section id="listView">
  <div class="stats" id="stats"></div>
  <div class="toolbar">
    <div class="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="q" type="search" placeholder="Rechercher : société, date, montant, n°, note, texte…" autocomplete="off">
      <button class="adv-btn" id="advBtn" type="button" aria-expanded="false" title="Filtres"><svg viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4"/></svg><em id="advN"></em></button>
    </div>
    <div class="adv" id="adv" hidden>
      <label>Catégorie<select id="fCat"><option value="">Toutes</option></select></label>
      <label><span id="fSocLabel">Fournisseur</span><select id="fSoc"><option value="">Tous</option></select></label>
      <label>Montant de<input id="fMin" inputmode="decimal" placeholder="0"></label>
      <label>à<input id="fMax" inputmode="decimal" placeholder="∞"></label>
      <label>Du<input id="fFrom" type="date"></label>
      <label>Au<input id="fTo" type="date"></label>
      <div class="adv-quick">
        <button type="button" data-per="month">Ce mois</button><button type="button" data-per="lastmonth">Mois dernier</button>
        <button type="button" data-per="quarter">Ce trimestre</button><button type="button" data-per="year">Cette année</button>
        <button type="button" data-per="clear" class="clear">Effacer les filtres</button>
      </div>
    </div>
    <div class="filters" id="filters"></div>
    <div class="tools">
      <select id="sort" aria-label="Trier">
        <option value="date-desc">Plus récentes</option><option value="date-asc">Plus anciennes</option>
        <option value="mt-desc">Montant ↓</option><option value="mt-asc">Montant ↑</option><option value="soc">Fournisseur A→Z</option>
      </select>
      <div class="tools-r">
        <?php if ($admin): ?><button class="btn btn-sm" id="reviewBtn" hidden>Revue rapide</button>
        <button class="btn btn-sm" id="selBtn">Sélectionner</button><?php endif; ?>
        <div class="view">
          <button id="vGrid" class="on" aria-label="Grille"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg></button>
          <button id="vList" aria-label="Liste"><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button>
        </div>
      </div>
    </div>
  </div>
  <main id="app"><div class="loading">Chargement…</div></main>
</section>

<section id="bordView" hidden></section>

<!-- Barre de sélection multiple -->
<div class="selbar" id="selbar" hidden>
  <span id="selN">0 sélectionnée</span>
  <button class="btn btn-sm" id="selAll">Tout</button>
  <button class="btn btn-sm" id="selCat">Catégorie…</button>
  <button class="btn btn-sm" id="selSent">Transmis</button>
  <button class="btn btn-sm" id="selOk">Vérifiées</button>
  <button class="btn btn-sm btn-del" id="selTrash">Corbeille</button>
  <button class="btn btn-sm" id="selCancel">Terminer</button>
</div>

<!-- Fiche d'une facture -->
<div class="sheet" id="sheet" hidden>
  <div class="sheet-bg" data-close></div>
  <div class="sheet-box">
    <button class="sheet-x" data-close aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <div class="sheet-view" id="sheetView"></div>
    <div class="sheet-tools admin-only" id="sheetTools">
      <button class="btn btn-sm" data-act="rotl" title="Tourner à gauche">↺</button>
      <button class="btn btn-sm" data-act="rotr" title="Tourner à droite">↻</button>
      <button class="btn btn-sm" data-act="addpage">+ Ajouter une page</button>
      <button class="btn btn-sm" data-act="replace">Remplacer le fichier</button>
      <button class="btn btn-sm" data-act="relire">Relire</button>
      <input type="file" id="replaceInput" accept="image/*,application/pdf,.heic,.heif" hidden>
      <input type="file" id="addPageInput" accept="image/*,application/pdf,.heic,.heif" multiple hidden>
    </div>
    <form class="sheet-form" id="sheetForm" autocomplete="off"></form>
  </div>
</div>

<!-- Visionneuse plein écran -->
<div class="viewer" id="viewer" hidden>
  <div class="v-top">
    <span id="vInfo"></span>
    <div><button class="v-btn" id="vZoomOut" aria-label="Dézoomer">−</button><button class="v-btn" id="vZoomIn" aria-label="Zoomer">+</button>
    <a class="v-btn" id="vOpen" target="_blank" aria-label="Ouvrir l’original">↗</a>
    <button class="v-btn" id="vClose" aria-label="Fermer">✕</button></div>
  </div>
  <div class="v-stage" id="vStage"><img id="vImg" alt=""><iframe id="vPdf" title="PDF" hidden></iframe></div>
  <button class="v-nav prev" id="vPrev" aria-label="Précédente">‹</button>
  <button class="v-nav next" id="vNext" aria-label="Suivante">›</button>
  <form class="v-form" id="vForm" hidden autocomplete="off"></form>
</div>

<!-- Menu -->
<div class="menu" id="menu" hidden>
  <div class="menu-bg" data-mclose></div>
  <div class="menu-box">
    <?php if ($admin): ?><button class="menu-i" data-m="km"><svg viewBox="0 0 24 24"><path d="M5 17h14M7 17V9l2-4h6l2 4v8M7 13h10"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg>Frais kilométriques</button><?php endif; ?>
    <button class="menu-i" data-m="export"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>Exporter pour le comptable</button>
    <?php if ($admin): ?><button class="menu-i" data-m="trash"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"/></svg>Corbeille <em id="trashN"></em></button>
    <button class="menu-i" data-m="settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>Réglages<em id="updDot"></em></button><?php endif; ?>
    <button class="menu-i" data-m="theme"><svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span id="themeLabel">Thème clair</span></button>
    <button class="menu-i" data-m="logout"><svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>Se déconnecter</button>
  </div>
</div>

<div class="toasts" id="toasts"></div>
<script>window.FLP = { base: <?= json_encode($base) ?>, t: <?= json_encode(flp_csrf()) ?>, admin: <?= $admin ? 'true' : 'false' ?> };</script>
<script src="<?= flp_asset('assets/common.js') ?>"></script>
<script src="<?= flp_asset('assets/extract.js') ?>"></script>
<script src="<?= flp_asset('assets/app.js') ?>"></script>
</body>
</html>
