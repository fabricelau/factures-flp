<?php
/* =====================================================================
   Factures FLP — mise à jour en un clic depuis le dépôt GitHub privé.
   Le dépôt contient un dossier « factures/ » : c'est lui qui est copié ici.
   Avant chaque mise à jour, le code actuel est sauvegardé (retour arrière).
   Les données (factures, réglages) ne sont jamais touchées : elles sont
   dans /home/<compte>/.flp-factures, hors de ce dossier.
   ===================================================================== */
require_once __DIR__ . '/lib.php';

function flp_gh(): array {
  $g = flp_settings()['github'];
  $repo = ($g['repo'] ?? '') !== '' ? $g['repo'] : (defined('FLP_GITHUB_REPO') ? FLP_GITHUB_REPO : '');
  return [$repo, ($g['branch'] ?? '') ?: 'main', $g['token'] ?? ''];
}
function flp_gh_headers(string $token): array {
  $h = ['Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28'];
  if ($token !== '') $h[] = 'Authorization: Bearer ' . $token;
  return $h;
}
function flp_version(): string {
  return is_file(__DIR__ . '/VERSION') ? trim((string)file_get_contents(__DIR__ . '/VERSION')) : '';
}

function flp_update_check(): array {
  [$repo, $branch, $token] = flp_gh();
  if ($repo === '') return ['ok' => false, 'msg' => 'Indiquez le dépôt GitHub dans Réglages.'];
  $r = flp_http("https://api.github.com/repos/$repo/commits/" . rawurlencode($branch), flp_gh_headers($token), null, 15);
  if ($token === '' && in_array($r['code'], [403, 429], true)) {
    // limite de l'API GitHub atteinte (serveur partagé) : on lit la branche par le protocole git, sans limite
    $g = flp_http("https://github.com/$repo.git/info/refs?service=git-upload-pack", ['User-Agent: git/2.40'], null, 15);
    if ($g['code'] === 200 && preg_match('~([0-9a-f]{40}) refs/heads/' . preg_quote($branch, '~') . '\b~', $g['body'], $m)) {
      $cur = flp_version();
      return ['ok' => true, 'current' => $cur, 'latest' => $m[1], 'up_to_date' => $cur !== '' && strncmp($m[1], $cur, strlen($cur)) === 0, 'message' => '', 'date' => ''];
    }
  }
  if ($r['code'] === 401 || $r['code'] === 403) return ['ok' => false, 'msg' => 'GitHub refuse l’accès : vérifiez le jeton dans Réglages.'];
  if ($r['code'] === 404) return ['ok' => false, 'msg' => 'Dépôt introuvable (ou jeton sans accès à ce dépôt).'];
  if ($r['code'] !== 200) return ['ok' => false, 'msg' => 'GitHub ne répond pas (' . ($r['code'] ?: $r['err']) . ').'];
  $j = json_decode($r['body'], true);
  $sha = $j['sha'] ?? '';
  $cur = flp_version();
  return ['ok' => true, 'current' => $cur, 'latest' => $sha, 'up_to_date' => $cur !== '' && strncmp($sha, $cur, strlen($cur)) === 0,
          'message' => strtok((string)($j['commit']['message'] ?? ''), "\n"), 'date' => $j['commit']['committer']['date'] ?? ''];
}

function flp_rrmdir(string $d): void {
  if (!is_dir($d)) return;
  foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f)
    $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
  @rmdir($d);
}
function flp_list_files(string $root): array {
  $out = [];
  foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f)
    if ($f->isFile()) $out[] = substr($f->getPathname(), strlen($root) + 1);
  return $out;
}

function flp_update_run(): array {
  @set_time_limit(180);
  if (!class_exists('ZipArchive')) return ['ok' => false, 'msg' => 'ZIP indisponible sur le serveur.'];
  $chk = flp_update_check();
  if (!$chk['ok']) return $chk;
  [$repo, , $token] = flp_gh();
  $sha = $chk['latest'];

  $work = flp_tmp_dir() . '/maj-' . date('His') . '-' . bin2hex(random_bytes(3));
  @mkdir($work, 0700, true);
  $zip = $work . '/code.zip';
  $r = flp_http("https://api.github.com/repos/$repo/zipball/$sha", flp_gh_headers($token), null, 120, $zip);
  if ($token === '' && ($r['code'] !== 200 || filesize($zip) < 1000))   // dépôt public : téléchargement direct, hors API
    $r = flp_http("https://codeload.github.com/$repo/zip/$sha", [], null, 120, $zip);
  if ($r['code'] !== 200 || !is_file($zip) || filesize($zip) < 1000) { flp_rrmdir($work); return ['ok' => false, 'msg' => 'Téléchargement impossible (' . ($r['code'] ?: $r['err']) . ').']; }

  $z = new ZipArchive();
  if ($z->open($zip) !== true) { flp_rrmdir($work); return ['ok' => false, 'msg' => 'Archive illisible.']; }
  $z->extractTo($work . '/x'); $z->close();
  $top = glob($work . '/x/*', GLOB_ONLYDIR);
  $src = $top ? $top[0] . '/factures' : '';
  if (!$src || !is_file("$src/index.php") || !is_file("$src/lib.php") || !is_file("$src/api.php") || !is_file("$src/updater.php")) {
    flp_rrmdir($work); return ['ok' => false, 'msg' => 'Le dépôt ne contient pas d’appli valide (dossier factures/).'];
  }

  /* 1. Sauvegarde du code actuel : si elle échoue, on n'installe rien */
  $before = flp_list_files(__DIR__);
  $bk = flp_backups_dir() . '/code-' . date('Y-m-d-His') . '-' . (flp_version() ?: 'v1') . '.zip';
  $b = new ZipArchive();
  $okB = $b->open($bk, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true;
  if ($okB) { foreach ($before as $rel) $okB = $okB && $b->addFile(__DIR__ . '/' . $rel, $rel); $okB = $b->close() && $okB; }
  if (!$okB || !is_file($bk)) { @unlink($bk); flp_rrmdir($work); return ['ok' => false, 'msg' => 'Sauvegarde de la version actuelle impossible (espace disque ?) : rien n’a été installé.']; }
  $old = glob(flp_backups_dir() . '/code-*.zip') ?: []; sort($old);
  while (count($old) > 5) @unlink(array_shift($old));

  /* 2. Copie des nouveaux fichiers (fichier temporaire puis renommage : jamais de fichier à moitié écrit).
        Au moindre échec, l'ancienne version est remise entièrement. */
  $copied = 0;
  $incoming = flp_list_files($src);
  foreach ($incoming as $rel) {
    if (strpos($rel, '..') !== false) continue;
    $dst = __DIR__ . '/' . $rel;
    if (!is_dir(dirname($dst))) @mkdir(dirname($dst), 0755, true);
    $tmp = $dst . '.maj';
    if (!@copy("$src/$rel", $tmp) || !@rename($tmp, $dst)) {
      @unlink($tmp);
      flp_restore_code($bk, $before);
      flp_rrmdir($work);
      return ['ok' => false, 'msg' => "Copie impossible ($rel) : l’ancienne version a été remise."];
    }
    @chmod($dst, 0644);
    $copied++;
  }
  /* 3. Fichiers retirés du dépôt : supprimés aussi */
  $keep = array_flip($incoming);
  foreach ($before as $rel) {
    if (!isset($keep[$rel]) && $rel !== 'VERSION' && preg_match('~\.(php|js|css|png|svg|webmanifest|json|txt)$|^\.htaccess$~', $rel)) @unlink(__DIR__ . '/' . $rel);
  }
  file_put_contents(__DIR__ . '/VERSION', substr($sha, 0, 12));
  flp_rrmdir($work);
  if (function_exists('opcache_reset')) @opcache_reset();
  return ['ok' => true, 'msg' => "Mise à jour installée ($copied fichiers). La page va se recharger.", 'version' => substr($sha, 0, 12), 'note' => $chk['message']];
}

/* Remet la sauvegarde de code : fichiers d'avant restaurés, fichiers ajoutés et temporaires retirés */
function flp_restore_code(string $bk, array $before): void {
  $z = new ZipArchive();
  if ($z->open($bk) === true) { $z->extractTo(__DIR__); $z->close(); }
  $was = array_flip($before);
  foreach (flp_list_files(__DIR__) as $rel) {
    if (substr($rel, -4) === '.maj' || !isset($was[$rel])) @unlink(__DIR__ . '/' . $rel);
  }
}

/* Mise à jour automatique : vérifiée au plus toutes les 15 minutes, quand l'appli est ouverte
   (après l'envoi de la page, donc sans jamais ralentir l'affichage). */
function flp_auto_update(): void {
  $S = flp_settings();
  if (($S['github']['auto'] ?? true) === false) return;
  [$repo] = flp_gh(); if ($repo === '') return;
  $e = flp_json_read('etat.json', []);
  if (time() - (int)($e['maj_vu'] ?? 0) < 900) return;
  $lock = @fopen(flp_data_dir() . '/maj.lock', 'c');
  if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return;      // une autre page s'en occupe déjà
  $e = flp_json_read('etat.json', []); $e['maj_vu'] = time(); flp_json_write('etat.json', $e);
  @ignore_user_abort(true);
  $chk = flp_update_check();
  if ($chk['ok'] && !$chk['up_to_date']) {
    $r = flp_update_run();
    $e = flp_json_read('etat.json', []);
    $e['maj_auto'] = ['quand' => date('c'), 'ok' => $r['ok'], 'msg' => $r['msg'], 'version' => $r['version'] ?? ''];
    flp_json_write('etat.json', $e);
  }
  flock($lock, LOCK_UN); fclose($lock);
}
