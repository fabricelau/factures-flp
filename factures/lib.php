<?php
/* =====================================================================
   Factures FLP — fonctions communes : connexion, stockage, réglages,
   miniatures, e-mail, sauvegardes, entretien automatique.
   ===================================================================== */
require_once __DIR__ . '/config.php';

mb_internal_encoding('UTF-8');
date_default_timezone_set('Indian/Reunion');

/* ---------- Dossiers et fichiers de données ---------- */
function flp_sub(string $name): string { $d = flp_data_dir() . '/' . $name; if (!is_dir($d)) @mkdir($d, 0700, true); return $d; }
function flp_files_dir(): string   { return flp_sub('fichiers'); }
function flp_thumbs_dir(): string  { return flp_sub('miniatures'); }
function flp_backups_dir(): string { return flp_sub('sauvegardes'); }
function flp_tmp_dir(): string     { return flp_sub('tmp'); }
function flp_index_file(): string  { return flp_data_dir() . '/factures.json'; }
function flp_pass_file(): string   { return flp_data_dir() . '/.motdepasse'; }
function flp_secret_file(): string { return flp_data_dir() . '/.cle-session'; }

/* ---------- Petits fichiers JSON (réglages, apprentissage, état) ---------- */
function flp_json_read(string $name, array $def = []): array {
  $f = flp_data_dir() . '/' . $name;
  if (!is_file($f)) return $def;
  $d = json_decode((string)@file_get_contents($f), true);
  return is_array($d) ? $d + $def : $def;
}
function flp_json_write(string $name, array $data): void {
  $f = flp_data_dir() . '/' . $name;
  $tmp = $f . '.tmp' . bin2hex(random_bytes(3));
  file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
  @chmod($tmp, 0600);
  rename($tmp, $f);
}
function flp_settings(): array {
  return flp_json_read('reglages.json', [
    'email' => FLP_OWNER_EMAIL,
    'compta_hash' => '',
    'github' => ['repo' => '', 'branch' => 'main', 'token' => ''],
    'dropbox' => ['app_key' => '', 'app_secret' => '', 'refresh' => '', 'folder' => '/Factures FLP', 'account' => ''],
  ]);
}
function flp_settings_save(array $s): void { flp_json_write('reglages.json', $s); }

/* ---------- Secret de signature ---------- */
function flp_secret(): string {
  $f = flp_secret_file();
  if (!is_file($f)) { @file_put_contents($f, bin2hex(random_bytes(32))); @chmod($f, 0600); }
  $s = trim((string)@file_get_contents($f));
  return $s !== '' ? $s : hash('sha256', __FILE__ . php_uname());
}

/* ---------- Mots de passe (admin + comptable) ---------- */
function flp_pass_set(): bool { return is_file(flp_pass_file()); }
function flp_pass_save(string $plain): void {
  file_put_contents(flp_pass_file(), password_hash($plain, PASSWORD_DEFAULT));
  @chmod(flp_pass_file(), 0600);
  flp_bump_sessions(); // un nouveau mot de passe déconnecte les autres appareils
}
function flp_pass_check(string $plain): bool {
  $h = trim((string)@file_get_contents(flp_pass_file()));
  return $h !== '' && password_verify($plain, $h);
}
function flp_compta_check(string $plain): bool {
  $h = flp_settings()['compta_hash'] ?? '';
  return $h !== '' && password_verify($plain, $h);
}

/* ---------- Anti force brute : 5 essais ratés par adresse (30 au total) → 15 min d'attente ----------
   Verrou exclusif sur tout le contrôle : des essais envoyés en parallèle sont comptés un par un.
   L'essai est compté AVANT la vérification du mot de passe, puis effacé s'il réussit. */
function flp_throttle_key(): string { return 'ip-' . substr(hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'x'), 0, 16); }
function flp_throttle_attempt(): int {
  $fp = fopen(flp_data_dir() . '/connexions.lock', 'c'); if ($fp) flock($fp, LOCK_EX);
  $st = flp_json_read('connexions.json', []);
  $now = time(); $k = flp_throttle_key();
  foreach ($st as $kk => $e) if ($now - ($e['t'] ?? 0) > 900) unset($st[$kk]);
  $mine = $st[$k] ?? ['n' => 0, 't' => $now];
  $all = array_sum(array_map(fn($e) => (int)($e['n'] ?? 0), $st));
  $wait = 0;
  if ($mine['n'] >= 5) $wait = 900 - ($now - $mine['t']);
  elseif ($all >= 30) $wait = 300;
  if (!$wait) { $mine['n']++; $mine['t'] = $now; $st[$k] = $mine; flp_json_write('connexions.json', $st); }
  if ($fp) { flock($fp, LOCK_UN); fclose($fp); }
  return max(0, $wait);
}
function flp_throttle_ok(): void {
  $fp = fopen(flp_data_dir() . '/connexions.lock', 'c'); if ($fp) flock($fp, LOCK_EX);
  $st = flp_json_read('connexions.json', []);
  unset($st[flp_throttle_key()]);
  flp_json_write('connexions.json', $st);
  if ($fp) { flock($fp, LOCK_UN); fclose($fp); }
}

/* ---------- Session : cookie signé « expiration.rôle.génération.signature » ---------- */
function flp_cookie_name(): string { return 'flp_fact'; }
function flp_generation(): int { return (int)(flp_json_read('etat.json', ['gen' => 1])['gen'] ?? 1); }
function flp_bump_sessions(): void { $e = flp_json_read('etat.json', []); $e['gen'] = ($e['gen'] ?? 1) + 1; flp_json_write('etat.json', $e); }
function flp_login(string $role = 'admin'): void {
  $exp = time() + FLP_SESSION_TTL;
  $gen = flp_generation();
  $payload = $exp . '.' . $role . '.' . $gen . '.' . flp_fp($role);
  $sig = hash_hmac('sha256', $payload, flp_secret());
  setcookie(flp_cookie_name(), $payload . '.' . $sig, [
    'expires' => $exp, 'path' => flp_base_path(),
    'secure' => flp_is_https(), 'httponly' => true, 'samesite' => 'Lax',
  ]);
  $_COOKIE[flp_cookie_name()] = $payload . '.' . $sig;
}
function flp_logout(): void {
  setcookie(flp_cookie_name(), '', ['expires' => time() - 3600, 'path' => flp_base_path()]);
}
/* Empreinte du mot de passe du rôle : changer le mot de passe comptable déconnecte le comptable */
function flp_fp(string $role): string {
  if ($role !== 'compta') return 'a';
  $h = flp_settings()['compta_hash'] ?? '';
  return $h === '' ? 'x' : substr(hash('sha256', $h), 0, 10);
}
function flp_role(): ?string {
  static $memo = null;
  $c = (string)($_COOKIE[flp_cookie_name()] ?? '');
  if ($memo !== null && $memo[0] === $c) return $memo[1];
  $p = explode('.', $c);
  $r = null;
  if (count($p) === 5) {
    [$exp, $role, $gen, $fp, $sig] = $p;
    if (ctype_digit($exp) && (int)$exp >= time() && in_array($role, ['admin', 'compta'], true)
        && (int)$gen === flp_generation()
        && hash_equals(hash_hmac('sha256', "$exp.$role.$gen.$fp", flp_secret()), $sig)
        && hash_equals(flp_fp($role), $fp) && $fp !== 'x') $r = $role;
  }
  $memo = [$c, $r];
  return $r;
}
function flp_is_logged(): bool { return flp_role() !== null; }
function flp_is_admin(): bool { return flp_role() === 'admin'; }
function flp_require_login(): void {
  if (!flp_is_logged()) { header('Location: ' . flp_base_path()); exit; }
}

/* ---------- Jeton anti-falsification pour les actions qui modifient ---------- */
function flp_csrf(): string {
  $c = (string)($_COOKIE[flp_cookie_name()] ?? '');
  return substr(hash_hmac('sha256', 'csrf|' . $c, flp_secret()), 0, 32);
}
function flp_csrf_ok(): bool {
  $t = (string)($_SERVER['HTTP_X_FLP'] ?? ($_POST['_t'] ?? ''));
  return $t !== '' && hash_equals(flp_csrf(), $t);
}

/* ---------- URL ---------- */
function flp_is_https(): bool {
  return (($_SERVER['HTTPS'] ?? '') && $_SERVER['HTTPS'] !== 'off')
      || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
      || (($_SERVER['SERVER_PORT'] ?? '') == 443);
}
function flp_base_path(): string {
  $d = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/factures/index.php'));
  return rtrim($d, '/') . '/';
}
/* Adresse complète de l'appli : fixée dans config.php (jamais tirée de l'en-tête Host,
   qui peut être falsifié — important pour le lien « mot de passe oublié »). */
function flp_base_url(): string {
  return defined('FLP_BASE_URL') && FLP_BASE_URL !== '' ? FLP_BASE_URL
    : (flp_is_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . flp_base_path();
}
/* Lien d'un fichier statique avec sa date de modification : le cache ne bloque plus jamais */
function flp_asset(string $rel): string {
  $f = __DIR__ . '/' . $rel;
  return flp_base_path() . $rel . '?v=' . (is_file($f) ? filemtime($f) : '0');
}

/* ---------- Index des factures (verrouillé) ---------- */
function flp_blank(): array { return ['items' => [], 'seq' => 0]; }
function flp_read(): array {
  $f = flp_index_file();
  if (!is_file($f)) return flp_blank();
  $fp = fopen($f, 'r');
  if (!$fp) return flp_blank();
  flock($fp, LOCK_SH);
  $raw = stream_get_contents($fp);
  flock($fp, LOCK_UN); fclose($fp);
  $d = json_decode((string)$raw, true);
  if (!is_array($d)) $d = flp_blank();
  $d['items'] = array_map('flp_normalize', $d['items'] ?? []);
  $d['seq'] = $d['seq'] ?? 0;
  return $d;
}
/* Écriture sûre : verrou sur un fichier à part, nouvelle version écrite dans un fichier
   temporaire puis renommée d'un coup. Si l'encodage échoue, rien n'est touché.
   Le compteur d'identifiants ne recule jamais (il ne peut pas réutiliser un numéro). */
function flp_write(callable $mutator) {
  $f = flp_index_file();
  $lk = fopen($f . '.lock', 'c');
  if (!$lk) throw new RuntimeException('Index verrouillé.');
  flock($lk, LOCK_EX);
  try {
    $raw = is_file($f) ? (string)file_get_contents($f) : '';
    $d = json_decode($raw, true);
    if (!is_array($d)) {
      if (trim($raw) !== '') { @copy($f, $f . '.illisible-' . date('YmdHis')); }
      $d = flp_blank();
    }
    $d['items'] = array_map('flp_normalize', $d['items'] ?? []);
    $maxId = 0; foreach ($d['items'] as $x) $maxId = max($maxId, (int)($x['id'] ?? 0));
    $d['seq'] = max((int)($d['seq'] ?? 0), $maxId, flp_seq_floor());
    $ret = $mutator($d);
    $json = json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) throw new RuntimeException('Données invalides : rien n’a été modifié.');
    $tmp = $f . '.tmp' . bin2hex(random_bytes(3));
    if (file_put_contents($tmp, $json) !== strlen($json)) { @unlink($tmp); throw new RuntimeException('Écriture impossible (disque plein ?).'); }
    @chmod($tmp, 0600);
    if (!rename($tmp, $f)) { @unlink($tmp); throw new RuntimeException('Écriture impossible.'); }
    flp_seq_floor((int)$d['seq']);
    return $ret;
  } finally { flock($lk, LOCK_UN); fclose($lk); }
}
/* Plancher du compteur, gardé à part : même si l'index était perdu, un numéro n'est jamais réutilisé */
function flp_seq_floor(?int $set = null): int {
  $f = flp_data_dir() . '/.seq';
  if ($set !== null) { if ($set > (int)@file_get_contents($f)) @file_put_contents($f, (string)$set); return $set; }
  if (is_file($f)) return (int)@file_get_contents($f);
  $n = 0; // première fois : les fichiers déjà présents comptent
  foreach (glob(flp_data_dir() . '/fichiers/*') ?: [] as $p) $n = max($n, (int)basename($p));
  return $n;
}
/* Complète les champs manquants (factures créées par la version 1) */
function flp_normalize(array $x): array {
  return $x + [
    'sens' => 'achat', 'type' => 'piece', 'date' => '', 'year' => date('Y'),
    'societe' => '', 'montant' => null, 'devise' => FLP_DEVISE, 'montant_orig' => null, 'taux_change' => null,
    'ht' => null, 'tva' => null, 'taux_tva' => null, 'categorie' => '', 'numero' => '', 'note' => '',
    'paiement' => '', 'texte' => '', 'doutes' => [], 'check' => false, 'ext' => '', 'thumb' => false,
    'pages' => 1, 'filename' => '', 'source' => 'import', 'added' => '', 'trashed' => false,
    'transmis' => '', 'hash' => '', 'km' => null, 'v' => 1,
  ];
}

/* ---------- Réponses ---------- */
/* Réponse JSON. $continue = true : la réponse part tout de suite, et le script
   continue ensuite (entretien quotidien) sans faire attendre l'écran. */
function flp_json($data, int $code = 200, bool $continue = false): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  $out = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
  if (!$continue) { echo $out; exit; }
  ignore_user_abort(true);
  @set_time_limit(180);
  header('Content-Length: ' . strlen($out));
  header('Connection: close');
  echo $out;
  if (function_exists('litespeed_finish_request')) litespeed_finish_request();
  elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
  else { while (ob_get_level()) ob_end_flush(); flush(); }
}
function flp_slug(string $s): string {
  $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
  $s = preg_replace('/[^A-Za-z0-9]+/', '-', $t !== false ? $t : $s);
  return trim((string)$s, '-') ?: 'facture';
}
function flp_ext_ok(string $mime): ?string {
  return [
    'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
    'image/heic' => 'heic', 'image/heif' => 'heic', 'application/pdf' => 'pdf',
  ][$mime] ?? null;
}
function flp_mime(string $ext): string {
  return ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'heic' => 'image/heic', 'pdf' => 'application/pdf'][$ext] ?? 'application/octet-stream';
}
function flp_num($v): ?float {
  $v = str_replace([' ', "\u{00a0}", "\u{202f}", ','], ['', '', '', '.'], trim((string)$v));
  if (!is_numeric($v)) return null;
  $f = (float)$v;
  return is_finite($f) && abs($f) < 1e9 ? round($f, 2) : null;
}
function flp_file_path(array $x): string { return flp_files_dir() . '/' . $x['id'] . '.' . $x['ext']; }
function flp_thumb_path(int $id): string { return flp_thumbs_dir() . '/' . $id . '.jpg'; }
function flp_nice_name(array $x): string {
  $m = $x['montant'] !== null ? '_' . number_format((float)$x['montant'], 2, ',', '') : '';
  return ($x['date'] ?: 'sans-date') . '_' . flp_slug($x['societe'] ?: 'facture') . $m . '_' . $x['id'] . ($x['ext'] ? '.' . $x['ext'] : '');
}

/* ---------- Images (GD) ---------- */
function flp_gd_open(string $src, string $ext) {
  if (!function_exists('imagecreatetruecolor')) return null;
  if ($ext === 'jpg')  return @imagecreatefromjpeg($src) ?: null;
  if ($ext === 'png')  return @imagecreatefrompng($src) ?: null;
  if ($ext === 'webp' && function_exists('imagecreatefromwebp')) return @imagecreatefromwebp($src) ?: null;
  return null;
}
function flp_make_thumb(string $src, string $dst, string $ext, int $max = 600): bool {
  $img = flp_gd_open($src, $ext);
  if (!$img) return false;
  $w = imagesx($img); $h = imagesy($img);
  $k = min(1, $max / max($w, $h));
  $nw = max(1, (int)round($w * $k)); $nh = max(1, (int)round($h * $k));
  $out = imagecreatetruecolor($nw, $nh);
  imagecopyresampled($out, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
  $ok = imagejpeg($out, $dst, 82);
  imagedestroy($img); imagedestroy($out);
  if ($ok) @chmod($dst, 0600);
  return $ok;
}
/* Miniature envoyée par le navigateur (1re page d'un PDF, photo HEIC…) */
function flp_save_client_thumb(int $id): bool {
  if (empty($_FILES['thumb']) || $_FILES['thumb']['error'] !== UPLOAD_ERR_OK) return false;
  $tmp = $_FILES['thumb']['tmp_name'];
  if (filesize($tmp) > 3_000_000) return false;
  $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: '';
  $ext = flp_ext_ok($mime);
  if (!in_array($ext, ['jpg', 'png', 'webp'], true)) return false;
  return flp_make_thumb($tmp, flp_thumb_path($id), $ext);
}
/* Rotation d'une photo (90° à droite ou à gauche) */
function flp_rotate(array $x, int $deg): bool {
  $p = flp_file_path($x);
  $img = flp_gd_open($p, $x['ext']);
  if (!$img) return false;
  $r = imagerotate($img, -$deg, 0); // GD tourne dans le sens inverse des aiguilles
  $ok = $x['ext'] === 'png' ? imagepng($r, $p) : ($x['ext'] === 'webp' ? imagewebp($r, $p, 90) : imagejpeg($r, $p, 92));
  imagedestroy($img); imagedestroy($r);
  if ($ok) flp_make_thumb($p, flp_thumb_path((int)$x['id']), $x['ext']);
  return $ok;
}

/* ---------- Apprentissage : fournisseur → catégorie + mots typiques ---------- */
function flp_learn_words(string $text): array {
  $t = mb_strtolower($text);
  preg_match_all('/[a-zà-ÿ]{4,}/u', $t, $m);
  $stop = array_flip(['facture','total','date','montant','merci','client','ticket','article','articles','prix','quantite','quantité','paiement','carte','bancaire','euros','avec','pour','dans','votre','vente','reçu','recu','caisse','numero','numéro','page','siret','adresse','telephone','téléphone','sans','contact','montant','net','payer','remise','taux','code','total']);
  $w = [];
  foreach (array_slice($m[0], 0, 120) as $x) if (!isset($stop[$x])) $w[$x] = 1;
  return array_keys($w);
}
function flp_learn(string $societe, string $categorie, string $texte): void {
  $societe = trim($societe);
  if ($societe === '') return;
  $L = flp_json_read('apprentissage.json', ['f' => []]);
  $e = $L['f'][$societe] ?? ['cat' => '', 'n' => 0, 'w' => []];
  if ($categorie !== '') $e['cat'] = $categorie;
  $e['n'] = ($e['n'] ?? 0) + 1;
  foreach (flp_learn_words($texte) as $w) $e['w'][$w] = ($e['w'][$w] ?? 0) + 1;
  arsort($e['w']);
  $e['w'] = array_slice($e['w'], 0, 60, true);
  $L['f'][$societe] = $e;
  flp_json_write('apprentissage.json', $L);
}

/* ---------- Taux de change (BCE, via frankfurter.app) ---------- */
function flp_http(string $url, array $headers = [], ?string $post = null, int $timeout = 20, ?string $saveTo = null) {
  $ch = curl_init($url);
  $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => $timeout,
           CURLOPT_HTTPHEADER => $headers, CURLOPT_USERAGENT => 'FacturesFLP/2'];
  if ($post !== null) { $opts[CURLOPT_POST] = true; $opts[CURLOPT_POSTFIELDS] = $post; }
  $fh = null;
  if ($saveTo) { $fh = fopen($saveTo, 'w'); $opts[CURLOPT_FILE] = $fh; unset($opts[CURLOPT_RETURNTRANSFER]); }
  curl_setopt_array($ch, $opts);
  $body = curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  if ($fh) fclose($fh);
  return ['code' => $code, 'body' => $saveTo ? '' : (string)$body, 'err' => $err];
}
function flp_rate(string $cur, string $date): ?float {
  $cur = strtoupper($cur);
  if ($cur === 'EUR') return 1.0;
  $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : date('Y-m-d');
  $cache = flp_json_read('taux.json', []);
  $k = "$cur|$date";
  if (isset($cache[$k])) return (float)$cache[$k];
  $r = flp_http("https://api.frankfurter.app/$date?from=EUR&to=$cur", [], null, 10);
  $j = json_decode($r['body'], true);
  $rate = $j['rates'][$cur] ?? null;
  if (!$rate) return null;
  $cache[$k] = (float)$rate;   // 1 EUR = rate CUR
  flp_json_write('taux.json', $cache);
  return (float)$rate;
}

/* ---------- E-mail (même méthode que le formulaire de contact) ---------- */
function flp_mail(string $to, string $subject, string $text): bool {
  $headers = [
    'From: ' . FLP_SHORT . ' <' . FLP_MAIL_FROM . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  $subj = '=?UTF-8?B?' . base64_encode($subject) . '?=';
  return @mail($to, $subj, $text, implode("\r\n", $headers), '-f' . FLP_MAIL_FROM);
}

/* ---------- Sauvegardes ---------- */
/* Sauvegarde quotidienne : les fichiers de données (index, réglages, apprentissage).
   Les pièces elles-mêmes ne changent pas : elles sont dans la sauvegarde complète
   (bouton « Télécharger toute ma sauvegarde ») et copiées dans Dropbox. */
function flp_backup_daily(): ?string {
  if (!class_exists('ZipArchive')) return null;
  $dst = flp_backups_dir() . '/donnees-' . date('Y-m-d') . '.zip';
  $z = new ZipArchive();
  if ($z->open($dst, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) return null;
  foreach (['factures.json', 'apprentissage.json', 'taux.json'] as $f) {
    $p = flp_data_dir() . '/' . $f;
    if (is_file($p)) $z->addFile($p, $f);
  }
  $z->close();
  @chmod($dst, 0600);
  $all = glob(flp_backups_dir() . '/donnees-*.zip') ?: [];
  sort($all);
  while (count($all) > FLP_BACKUP_KEEP) @unlink(array_shift($all));
  return $dst;
}
/* Sauvegarde complète à télécharger : index + toutes les pièces, bien nommées */
function flp_backup_full(): ?string {
  if (!class_exists('ZipArchive')) return null;
  $dst = flp_tmp_dir() . '/sauvegarde-complete-' . date('Y-m-d-His') . '.zip';
  $z = new ZipArchive();
  if ($z->open($dst, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) return null;
  foreach (['factures.json', 'apprentissage.json'] as $f) {
    $p = flp_data_dir() . '/' . $f;
    if (is_file($p)) $z->addFile($p, 'donnees/' . $f);
  }
  foreach (flp_read()['items'] as $x) {
    if ($x['type'] !== 'piece' || !$x['ext']) continue;
    $p = flp_file_path($x);
    if (!is_file($p)) continue;
    $dir = ($x['sens'] === 'vente' ? 'emises' : 'recues') . '/' . ($x['year'] ?: 'sans-annee');
    $z->addFile($p, 'pieces/' . $dir . '/' . flp_nice_name($x));
    $z->setCompressionName('pieces/' . $dir . '/' . flp_nice_name($x), ZipArchive::CM_STORE);
  }
  $z->close();
  return $dst;
}
function flp_clean_tmp(): void {
  foreach (glob(flp_tmp_dir() . '/*') ?: [] as $f) if (is_file($f) && time() - filemtime($f) > 3600) @unlink($f);
}

/* ---------- Corbeille : suppression des factures jetées depuis plus de 30 jours ---------- */
function flp_purge_trash(): int {
  $limit = time() - FLP_TRASH_DAYS * 86400;
  $gone = flp_write(function (&$d) use ($limit) {
    $gone = [];
    $d['items'] = array_values(array_filter($d['items'], function ($x) use ($limit, &$gone) {
      if (!empty($x['trashed']) && strtotime($x['trashed_at'] ?? 'now') < $limit) { $gone[] = $x; return false; }
      return true;
    }));
    return $gone;
  });
  foreach ($gone as $x) { if ($x['ext']) @unlink(flp_file_path($x)); @unlink(flp_thumb_path((int)$x['id'])); }
  return count($gone);
}

/* ---------- Entretien automatique (au plus une fois toutes les 20 h) ---------- */
function flp_maintenance(): void {
  $e = flp_json_read('etat.json', []);
  if (time() - (int)($e['entretien'] ?? 0) < 72000) return;
  $e['entretien'] = time();
  flp_json_write('etat.json', $e);
  @ignore_user_abort(true);
  flp_purge_trash();
  $zip = flp_backup_daily();
  flp_clean_tmp();
  if ($zip && is_file(__DIR__ . '/dropbox.php')) {
    require_once __DIR__ . '/dropbox.php';
    if (flp_dbx_ready()) {
      flp_dbx_upload($zip, '/Sauvegardes/' . basename($zip));
      flp_dbx_sync_pending(15);
    }
  }
}

/* ---------- Doublons : même fournisseur, même date, même montant (ou même fichier) ---------- */
function flp_find_duplicates(array $items): array {
  $by = []; $hash = [];
  foreach ($items as $x) {
    if (!empty($x['trashed'])) continue;
    if ($x['societe'] !== '' && $x['date'] !== '' && $x['montant'] !== null) {
      $by[mb_strtolower($x['societe']) . '|' . $x['date'] . '|' . $x['montant']][] = (int)$x['id'];
    }
    if ($x['hash'] !== '') $hash[$x['hash']][] = (int)$x['id'];
  }
  $dup = [];
  foreach (array_merge(array_values($by), array_values($hash)) as $ids) {
    if (count($ids) > 1) foreach ($ids as $id) $dup[$id] = true;
  }
  return array_keys($dup);
}

/* ---------- Frais kilométriques ---------- */
function flp_km_amount(float $km, string $cv): float {
  $b = FLP_BAREME_KM[$cv] ?? FLP_BAREME_KM['5'];
  if ($km <= 5000) return round($km * $b[0], 2);
  if ($km <= 20000) return round($km * $b[1] + $b[2], 2);
  return round($km * $b[3], 2);
}

function flp_mois(int $m): string {
  return ['', 'janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][$m] ?? '';
}
