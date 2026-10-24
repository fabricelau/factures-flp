<?php
/* Manifeste de l'application installable (servi sous le nom manifest.webmanifest). */
require_once __DIR__ . '/lib.php';
header('Content-Type: application/manifest+json; charset=utf-8');
$base = flp_base_path();
echo json_encode([
  'id' => $base,
  'name' => 'Factures ' . FLP_SITE,
  'short_name' => FLP_SHORT,
  'description' => 'Scanner et classer les factures de ' . FLP_SITE,
  'lang' => 'fr',
  'start_url' => $base . 'accueil',
  'scope' => $base,
  'display' => 'standalone',
  'orientation' => 'portrait',
  'background_color' => '#0d1114',
  'theme_color' => '#0d1114',
  'icons' => [
    ['src' => $base . 'assets/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
    ['src' => $base . 'assets/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
    ['src' => $base . 'assets/icons/maskable-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
  ],
  'shortcuts' => [
    ['name' => 'Photo d’une facture', 'url' => $base . 'scan', 'icons' => [['src' => $base . 'assets/icons/icon-96.png', 'sizes' => '96x96']]],
    ['name' => 'Toutes les factures', 'url' => $base, 'icons' => [['src' => $base . 'assets/icons/icon-96.png', 'sizes' => '96x96']]],
  ],
  /* « Partager → Factures FLP » depuis la galerie ou un e-mail (Android) */
  'share_target' => [
    'action' => $base . 'share.php',
    'method' => 'POST',
    'enctype' => 'multipart/form-data',
    'params' => ['title' => 'title', 'text' => 'text', 'files' => [['name' => 'files[]', 'accept' => ['image/*', 'application/pdf', '.pdf', '.jpg', '.jpeg', '.png', '.heic']]]],
  ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
