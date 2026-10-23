<?php
/* =====================================================================
   Factures FLP — installation de la version 2 depuis GitHub (usage unique).
   Déposé dans /factures/ sous un nom aléatoire, il :
   1. télécharge le dépôt GitHub privé (avec le jeton collé par Fabrice),
   2. sauvegarde la version 1, puis copie la version 2 à sa place,
   3. enregistre la liaison GitHub dans les réglages (pour les mises à jour en un clic),
   4. se supprime.
   ===================================================================== */
@set_time_limit(180);
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
$dir = __DIR__;
$msg = ''; $ok = false;

function inst_http(string $url, string $token, ?string $saveTo = null): array {
  $ch = curl_init($url);
  $h = ['Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28', 'User-Agent: FacturesFLP-install'];
  if ($token !== '') $h[] = 'Authorization: Bearer ' . $token;
  $o = [CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 120, CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => true];
  $fh = null; if ($saveTo) { $fh = fopen($saveTo, 'w'); $o[CURLOPT_FILE] = $fh; unset($o[CURLOPT_RETURNTRANSFER]); }
  curl_setopt_array($ch, $o);
  $body = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  if ($fh) fclose($fh);
  return [$code, $saveTo ? '' : (string)$body];
}
function inst_files(string $root): array {
  $out = [];
  foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f)
    if ($f->isFile()) $out[] = substr($f->getPathname(), strlen($root) + 1);
  return $out;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $repo = trim((string)($_POST['repo'] ?? ''));
  $token = trim((string)($_POST['token'] ?? ''));
  $branch = 'main';
  if (!preg_match('~^[\w.-]+/[\w.-]+$~', $repo)) $msg = 'Dépôt : format « compte/nom ».';
  elseif (!class_exists('ZipArchive') || !function_exists('curl_init')) $msg = 'Le serveur n’a pas ZIP ou cURL : installation impossible.';
  else {
    [$code, $body] = inst_http("https://api.github.com/repos/$repo/commits/$branch", $token);
    $sha = json_decode($body, true)['sha'] ?? '';
    if ($code !== 200 || !$sha) $msg = "GitHub refuse l’accès ($code). Vérifiez le nom du dépôt et le jeton.";
    else {
      $tmp = sys_get_temp_dir() . '/flp-inst-' . bin2hex(random_bytes(4));
      @mkdir($tmp, 0700, true);
      [$code] = inst_http("https://api.github.com/repos/$repo/zipball/$sha", $token, "$tmp/code.zip");
      $z = new ZipArchive();
      if ($code !== 200 || $z->open("$tmp/code.zip") !== true) $msg = "Téléchargement impossible ($code).";
      else {
        // contrôle anti « zip-slip » avant extraction
        for ($i = 0; $i < $z->numFiles; $i++) { $n = $z->getNameIndex($i); if (strpos($n, '..') !== false || $n[0] === '/') { $msg = 'Archive refusée.'; break; } }
        if (!$msg) {
          $z->extractTo("$tmp/x"); $z->close();
          $top = glob("$tmp/x/*", GLOB_ONLYDIR); $src = $top ? $top[0] . '/factures' : '';
          if (!$src || !is_file("$src/index.php") || !is_file("$src/updater.php")) $msg = 'Le dépôt ne contient pas l’appli (dossier factures/).';
          else {
            // 1. sauvegarde de la version 1 à côté de l'appli (hors du web : dossier temporaire puis données)
            $bk = new ZipArchive(); $bkPath = "$tmp/version1.zip";
            $bk->open($bkPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
            foreach (inst_files($dir) as $rel) $bk->addFile("$dir/$rel", $rel);
            $bk->close();
            // 2. copie de la version 2
            foreach (inst_files($src) as $rel) {
              $dst = "$dir/$rel"; if (!is_dir(dirname($dst))) @mkdir(dirname($dst), 0755, true);
              copy("$src/$rel", "$dst.maj"); @chmod("$dst.maj", 0644); rename("$dst.maj", $dst);
            }
            file_put_contents("$dir/VERSION", substr($sha, 0, 12));
            // 3. réglages : liaison GitHub (le dossier des données est déplacé par la v2 si besoin)
            require_once "$dir/lib.php";
            $S = flp_settings();
            $S['github'] = ['repo' => $repo, 'branch' => $branch, 'token' => $token];
            flp_settings_save($S);
            @copy($bkPath, flp_backups_dir() . '/code-' . date('Y-m-d-His') . '-v1.zip');
            // 4. ménage + suppression de cet installateur
            foreach (array_reverse(inst_files($tmp)) as $rel) @unlink("$tmp/$rel");
            @array_map('rmdir', array_reverse(glob("$tmp/{,*/,*/*/,*/*/*/,*/*/*/*/}", GLOB_BRACE | GLOB_ONLYDIR) ?: []));
            @unlink(__FILE__);
            if (function_exists('opcache_reset')) @opcache_reset();
            $ok = true;
          }
        }
      }
    }
  }
}
?><!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Installation — Factures FLP v2</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1114;color:#ece7df;font:16px/1.6 "Helvetica Neue",Arial,sans-serif;padding:20px}
.c{width:min(460px,100%);background:#151b20;border:1px solid #26303a;border-radius:12px;padding:28px}h1{margin:0 0 8px;font:800 22px "Arial Narrow",Arial;text-transform:uppercase}
p{color:#8f9aa3;font-size:14.5px}label{display:block;font:600 11px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#8f9aa3;margin:16px 0 6px}
input{width:100%;box-sizing:border-box;background:#0b0f12;border:1px solid #26303a;border-radius:8px;color:#ece7df;padding:12px;font-size:16px}
button,a.b{display:block;width:100%;box-sizing:border-box;text-align:center;margin-top:20px;background:#e3a653;color:#0d1114;border:0;border-radius:8px;padding:14px;font-weight:700;font-size:15px;text-decoration:none;cursor:pointer}
.e{color:#ff8a7a}.o{color:#8fd6ad}</style></head><body><div class="c">
<?php if ($ok): ?>
  <h1>Version 2 installée</h1>
  <p class="o">C’est fait. Cet installateur s’est supprimé. Par sécurité, reconnectez-vous avec votre mot de passe habituel.</p>
  <a class="b" href="./">Ouvrir mes factures</a>
<?php else: ?>
  <h1>Installer la version 2</h1>
  <p>Collez le nom du dépôt GitHub et le jeton d’accès en lecture. L’installation prend quelques secondes ; la version 1 est sauvegardée avant.</p>
  <form method="post" autocomplete="off">
    <label>Dépôt GitHub</label><input name="repo" placeholder="votre-compte/factures-flp" value="<?= htmlspecialchars($_POST['repo'] ?? '') ?>" required>
    <label>Jeton d’accès (lecture seule)</label><input name="token" type="password" placeholder="github_pat_…" required>
    <button type="submit">Installer</button>
  </form>
  <?php if ($msg): ?><p class="e"><?= htmlspecialchars($msg) ?></p><?php endif; ?>
<?php endif; ?>
</div></body></html>
