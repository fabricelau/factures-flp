<?php
/* =====================================================================
   Factures FLP — Dropbox.
   · Connexion (OAuth, jeton longue durée) : dropbox.php?start=1
   · Chaque pièce est copiée dans Dropbox, rangée par sens et par année.
   · La sauvegarde quotidienne y est aussi copiée (dossier Sauvegardes).
   Fichier appelé directement (connexion) ou inclus par lib.php / api.php.
   ===================================================================== */
require_once __DIR__ . '/lib.php';

/* Adresses de l'API Dropbox (remplaçables seulement par une variable d'environnement, pour les tests) */
define('FLP_DBX_API', getenv('FLP_DBX_API') ?: 'https://api.dropboxapi.com');
define('FLP_DBX_CONTENT', getenv('FLP_DBX_CONTENT') ?: 'https://content.dropboxapi.com');
function flp_dbx_cfg(): array { return flp_settings()['dropbox']; }
function flp_dbx_ready(): bool { $c = flp_dbx_cfg(); return !empty($c['refresh']) && !empty($c['app_key']) && !empty($c['app_secret']); }
function flp_dbx_redirect(): string { return flp_base_url() . 'dropbox.php'; }

/* Jeton d'accès (valable 4 h), renouvelé automatiquement */
function flp_dbx_token(): ?string {
  $e = flp_json_read('etat.json', []);
  if (!empty($e['dbx_at']) && time() < ($e['dbx_exp'] ?? 0) - 120) return $e['dbx_at'];
  $c = flp_dbx_cfg();
  $r = flp_http(FLP_DBX_API . '/oauth2/token', ['Content-Type: application/x-www-form-urlencoded'],
    http_build_query(['grant_type' => 'refresh_token', 'refresh_token' => $c['refresh'], 'client_id' => $c['app_key'], 'client_secret' => $c['app_secret']]), 20);
  $j = json_decode($r['body'], true);
  if (empty($j['access_token'])) return null;
  $e = flp_json_read('etat.json', []);
  $e['dbx_at'] = $j['access_token']; $e['dbx_exp'] = time() + (int)($j['expires_in'] ?? 14400);
  flp_json_write('etat.json', $e);
  return $j['access_token'];
}
function flp_dbx_path(string $rel): string {
  $base = rtrim(flp_dbx_cfg()['folder'] ?: '/Factures FLP', '/');
  return $base . '/' . ltrim($rel, '/');
}
/* Les en-têtes Dropbox-API-Arg doivent rester en ASCII : json_encode échappe les accents (é) */
function flp_dbx_upload(string $local, string $rel): bool {
  $t = flp_dbx_token(); if (!$t || !is_file($local)) return false;
  $arg = json_encode(['path' => flp_dbx_path($rel), 'mode' => 'overwrite', 'mute' => true, 'autorename' => false]);
  $r = flp_http(FLP_DBX_CONTENT . '/2/files/upload',
    ['Authorization: Bearer ' . $t, 'Content-Type: application/octet-stream', 'Dropbox-API-Arg: ' . $arg],
    (string)file_get_contents($local), 120);
  return $r['code'] === 200;
}
function flp_dbx_delete(string $rel): void {
  $t = flp_dbx_token(); if (!$t) return;
  flp_http(FLP_DBX_API . '/2/files/delete_v2', ['Authorization: Bearer ' . $t, 'Content-Type: application/json'],
    json_encode(['path' => flp_dbx_path($rel)]), 20);
}
function flp_dbx_rel(array $x): string {
  return ($x['sens'] === 'vente' ? 'Émises' : 'Reçues') . '/' . ($x['year'] ?: 'Sans année') . '/' . flp_nice_name($x);
}
/* Copie une pièce si elle n'y est pas encore (ou si elle a changé de nom ou de contenu) */
/* ---------- Import depuis Dropbox : parcourir les dossiers, récupérer un fichier ---------- */
const FLP_DBX_IMPORT_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'];
function flp_dbx_list(string $path): array {
  $t = flp_dbx_token(); if (!$t) return ['ok' => false, 'msg' => 'Dropbox n’est pas connecté.'];
  $path = $path === '/' ? '' : rtrim($path, '/');
  $h = ['Authorization: Bearer ' . $t, 'Content-Type: application/json'];
  $r = flp_http(FLP_DBX_API . '/2/files/list_folder', $h, json_encode(['path' => $path, 'limit' => 500]), 25);
  $j = json_decode($r['body'], true);
  if ($r['code'] !== 200 || !is_array($j)) {
    $why = is_array($j) && strpos((string)($j['error_summary'] ?? ''), 'not_found') !== false ? 'Dossier introuvable.' : 'Dropbox ne répond pas (' . ($r['code'] ?: $r['err']) . ').';
    return ['ok' => false, 'msg' => $why];
  }
  $entries = $j['entries'] ?? [];
  for ($n = 0; !empty($j['has_more']) && $n < 4; $n++) {      // dossiers très remplis : 2 500 éléments maximum
    $r = flp_http(FLP_DBX_API . '/2/files/list_folder/continue', $h, json_encode(['cursor' => $j['cursor']]), 25);
    $j = json_decode($r['body'], true); if (!is_array($j)) break;
    $entries = array_merge($entries, $j['entries'] ?? []);
  }
  $out = [];
  foreach ($entries as $e) {
    if (($e['.tag'] ?? '') === 'folder') $out[] = ['t' => 'd', 'n' => $e['name'], 'p' => $e['path_display']];
    elseif (($e['.tag'] ?? '') === 'file') {
      $ext = strtolower(pathinfo($e['name'], PATHINFO_EXTENSION));
      if (!in_array($ext, FLP_DBX_IMPORT_EXT, true)) continue;
      $out[] = ['t' => 'f', 'n' => $e['name'], 'p' => $e['path_display'], 's' => (int)($e['size'] ?? 0), 'd' => substr((string)($e['client_modified'] ?? $e['server_modified'] ?? ''), 0, 10)];
    }
  }
  usort($out, fn($a, $b) => $a['t'] !== $b['t'] ? ($a['t'] === 'd' ? -1 : 1) : ($a['t'] === 'd' ? strcasecmp($a['n'], $b['n']) : strcmp($b['d'], $a['d'])));
  return ['ok' => true, 'path' => $path, 'items' => $out];
}
/* Envoie au téléphone le contenu d'un fichier Dropbox (il est ensuite importé comme un fichier normal) */
function flp_dbx_stream(string $path): void {
  $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
  if (!in_array($ext, FLP_DBX_IMPORT_EXT, true)) flp_json(['ok' => false, 'msg' => 'Format non accepté.'], 422);
  $t = flp_dbx_token(); if (!$t) flp_json(['ok' => false, 'msg' => 'Dropbox n’est pas connecté.'], 422);
  $tmp = flp_tmp_dir() . '/dbx-' . bin2hex(random_bytes(6));
  $r = flp_http(FLP_DBX_CONTENT . '/2/files/download', ['Authorization: Bearer ' . $t, 'Dropbox-API-Arg: ' . json_encode(['path' => $path]), 'Content-Type:'], '', 120, $tmp);   // « Content-Type: » vide : Dropbox refuse le type par défaut de curl
  if ($r['code'] !== 200 || !is_file($tmp) || !filesize($tmp)) { @unlink($tmp); flp_json(['ok' => false, 'msg' => 'Téléchargement depuis Dropbox impossible (' . ($r['code'] ?: $r['err']) . ').'], 502); }
  if (filesize($tmp) > FLP_MAX_UPLOAD) { @unlink($tmp); flp_json(['ok' => false, 'msg' => 'Fichier trop volumineux (40 Mo maximum).'], 422); }
  $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: 'application/octet-stream';
  if (!preg_match('~^(image/|application/pdf)~', $mime) && !in_array($ext, ['heic', 'heif'], true)) { @unlink($tmp); flp_json(['ok' => false, 'msg' => 'Ce fichier n’est ni une photo ni un PDF.'], 422); }
  header('Content-Type: ' . $mime);
  header('Content-Length: ' . filesize($tmp));
  header('Cache-Control: no-store');
  header('X-Content-Type-Options: nosniff');
  readfile($tmp); @unlink($tmp);
  exit;
}

/* Réglage « quand copier » : 'verifie' (par défaut) = seulement les factures vérifiées ; 'tout' = dès l'envoi */
function flp_dbx_wanted(array $x): bool {
  if ($x['type'] !== 'piece' || !$x['ext'] || !empty($x['trashed'])) return false;
  return (flp_dbx_cfg()['when'] ?? 'verifie') === 'tout' || empty($x['check']);
}
/* Retire de Dropbox une pièce mise à la corbeille */
function flp_dbx_unsync(array $x): void {
  if (empty($x['dbx'])) return;
  flp_dbx_delete($x['dbx']);
  $id = (int)$x['id'];
  flp_write(function (&$d) use ($id) { foreach ($d['items'] as &$y) if ((int)$y['id'] === $id) { $y['dbx'] = ''; $y['dbx_h'] = ''; } });
}
/* Après une modification : copie (ou renomme) si la pièce doit y être */
function flp_dbx_after(array $x): void {
  if (!flp_dbx_ready()) return;
  if (!empty($x['trashed'])) { flp_dbx_unsync($x); return; }
  if (flp_dbx_wanted($x)) flp_dbx_sync_item($x);
}
function flp_dbx_sync_item(array $x, bool $force = false): bool {
  if (!flp_dbx_wanted($x)) return false;
  $rel = flp_dbx_rel($x);
  if (!$force && ($x['dbx'] ?? '') === $rel && ($x['dbx_h'] ?? '') === $x['hash']) return false;
  if (!flp_dbx_upload(flp_file_path($x), $rel)) return false;
  if (!empty($x['dbx']) && $x['dbx'] !== $rel) flp_dbx_delete($x['dbx']);
  $id = (int)$x['id'];
  flp_write(function (&$d) use ($id, $rel, $x) { foreach ($d['items'] as &$y) if ((int)$y['id'] === $id) { $y['dbx'] = $rel; $y['dbx_h'] = $x['hash']; } });
  return true;
}
function flp_dbx_sync_pending(int $max = 40): int {
  $n = 0;
  foreach (flp_read()['items'] as $x) {
    if ($n >= $max) break;
    if (flp_dbx_sync_item($x)) $n++;
  }
  $e = flp_json_read('etat.json', []); $e['dbx_sync'] = time(); flp_json_write('etat.json', $e);
  return $n;
}

/* ---------- Appel direct : connexion OAuth ---------- */
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
  if (!flp_is_admin()) { header('Location: ' . flp_base_path()); exit; }
  $c = flp_dbx_cfg();
  $back = flp_base_path() . '#reglages';

  if (isset($_GET['start'])) {
    if (empty($c['app_key']) || empty($c['app_secret'])) { header('Location: ' . $back . '-dropbox-cle'); exit; }
    $state = bin2hex(random_bytes(16));
    $e = flp_json_read('etat.json', []); $e['dbx_state'] = $state; flp_json_write('etat.json', $e);
    header('Location: https://www.dropbox.com/oauth2/authorize?' . http_build_query([
      'client_id' => $c['app_key'], 'response_type' => 'code', 'token_access_type' => 'offline',
      'redirect_uri' => flp_dbx_redirect(), 'state' => $state,
    ]));
    exit;
  }

  if (isset($_GET['code'])) {
    $e = flp_json_read('etat.json', []);
    if (empty($e['dbx_state']) || !hash_equals($e['dbx_state'], (string)($_GET['state'] ?? ''))) { header('Location: ' . $back . '-dropbox-erreur'); exit; }
    unset($e['dbx_state']); flp_json_write('etat.json', $e);
    $r = flp_http(FLP_DBX_API . '/oauth2/token', ['Content-Type: application/x-www-form-urlencoded'],
      http_build_query(['grant_type' => 'authorization_code', 'code' => (string)$_GET['code'], 'redirect_uri' => flp_dbx_redirect(),
                        'client_id' => $c['app_key'], 'client_secret' => $c['app_secret']]), 20);
    $j = json_decode($r['body'], true);
    if (empty($j['refresh_token'])) { header('Location: ' . $back . '-dropbox-erreur'); exit; }
    $S = flp_settings();
    $S['dropbox']['refresh'] = $j['refresh_token'];
    $acc = flp_http(FLP_DBX_API . '/2/users/get_current_account', ['Authorization: Bearer ' . $j['access_token'], 'Content-Type: application/json'], 'null', 15);
    $aj = json_decode($acc['body'], true);
    $S['dropbox']['account'] = $aj['email'] ?? ($aj['name']['display_name'] ?? 'compte Dropbox');
    flp_settings_save($S);
    $e = flp_json_read('etat.json', []); $e['dbx_at'] = $j['access_token']; $e['dbx_exp'] = time() + (int)($j['expires_in'] ?? 14400); flp_json_write('etat.json', $e);
    header('Location: ' . $back . '-dropbox-ok'); exit;
  }

  if (isset($_GET['error'])) { header('Location: ' . $back . '-dropbox-refus'); exit; }
  header('Location: ' . $back); exit;
}
