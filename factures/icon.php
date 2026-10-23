<?php
/* Icône de l'appli : sert le fichier PNG de la taille la plus proche (assets/icons). */
$s = (int)($_GET['s'] ?? 192);
$sizes = [32, 64, 96, 180, 192, 512];
$best = 512; foreach ($sizes as $z) if ($z >= $s) { $best = $z; break; }
$f = __DIR__ . '/assets/icons/' . (!empty($_GET['m']) ? 'maskable' : 'icon') . '-' . $best . '.png';
if (!is_file($f)) { http_response_code(404); exit; }
header('Content-Type: image/png');
header('Cache-Control: public, max-age=604800');
header('Content-Length: ' . filesize($f));
readfile($f);
