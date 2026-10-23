<?php
/* =====================================================================
   Factures FLP — Dropbox.
   · Connexion (OAuth, jeton longue durée) : dropbox.php?start=1
   · Chaque pièce est copiée dans Dropbox, rangée par sens et par année.
   · La sauvegarde quotidienne y est aussi copiée (dossier Sauvegardes).
   Fichier appelé directement (connexion) ou inclus par lib.php / api.php.
   ===================================================================== */
require_once __DIR__ . '/lib.php';

function flp_dbx_cfg(): array { return flp_settings()['dropbox']; }
function flp_dbx_ready(): bool { $c = flp_dbx_cfg(); return !empty($c['refresh']) && !empty($c['app_key']) && !empty($c['app_secret']); }
function flp_dbx_redirect(): string { return flp_base_url() . 'dropbox.php'; }

/* Jeton d'accès (valable 4 h), renouvelé automatiquement */
function flp_dbx_token(): ?string {
  $e = flp_json_read('etat.json', []);
  if (!empty($e['dbx_at']) && time() < ($e['dbx_exp'] ?? 0) - 120) return $e['dbx_at'];
  $c = flp_dbx_cfg();
  $r = flp_http('https://api.dropboxapi.com/oauth2/token', ['Content-Type: application/x-www-form-urlencoded'],
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
  $r = flp_http('https://content.dropboxapi.com/2/files/upload',
    ['Authorization: Bearer ' . $t, 'Content-Type: application/octet-stream', 'Dropbox-API-Arg: ' . $arg],
    (string)file_get_contents($local), 120);
  return $r['code'] === 200;
}
function flp_dbx_delete(string $rel): void {
  $t = flp_dbx_token(); if (!$t) return;
  flp_http('https://api.dropboxapi.com/2/files/delete_v2', ['Authorization: Bearer ' . $t, 'Content-Type: application/json'],
    json_encode(['path' => flp_dbx_path($rel)]), 20);
}
function flp_dbx_rel(array $x): string {
  return ($x['sens'] === 'vente' ? 'Émises' : 'Reçues') . '/' . ($x['year'] ?: 'Sans année') . '/' . flp_nice_name($x);
}
/* Copie une pièce si elle n'y est pas encore (ou si elle a changé de nom ou de contenu) */
function flp_dbx_sync_item(array $x, bool $force = false): bool {
  if ($x['type'] !== 'piece' || !$x['ext'] || !empty($x['trashed'])) return false;
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
    $r = flp_http('https://api.dropboxapi.com/oauth2/token', ['Content-Type: application/x-www-form-urlencoded'],
      http_build_query(['grant_type' => 'authorization_code', 'code' => (string)$_GET['code'], 'redirect_uri' => flp_dbx_redirect(),
                        'client_id' => $c['app_key'], 'client_secret' => $c['app_secret']]), 20);
    $j = json_decode($r['body'], true);
    if (empty($j['refresh_token'])) { header('Location: ' . $back . '-dropbox-erreur'); exit; }
    $S = flp_settings();
    $S['dropbox']['refresh'] = $j['refresh_token'];
    $acc = flp_http('https://api.dropboxapi.com/2/users/get_current_account', ['Authorization: Bearer ' . $j['access_token'], 'Content-Type: application/json'], 'null', 15);
    $aj = json_decode($acc['body'], true);
    $S['dropbox']['account'] = $aj['email'] ?? ($aj['name']['display_name'] ?? 'compte Dropbox');
    flp_settings_save($S);
    $e = flp_json_read('etat.json', []); $e['dbx_at'] = $j['access_token']; $e['dbx_exp'] = time() + (int)($j['expires_in'] ?? 14400); flp_json_write('etat.json', $e);
    header('Location: ' . $back . '-dropbox-ok'); exit;
  }

  if (isset($_GET['error'])) { header('Location: ' . $back . '-dropbox-refus'); exit; }
  header('Location: ' . $back); exit;
}
