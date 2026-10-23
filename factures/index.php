<?php
require_once __DIR__ . '/lib.php';

$err = ''; $info = '';
$mode = $_GET['m'] ?? '';          // '' | oubli | reset
$token = (string)($_GET['t'] ?? '');

/* Vérifie un jeton de réinitialisation (valable 1 h, usage unique) */
function flp_reset_valid(string $token): bool {
  $e = flp_json_read('etat.json', []);
  $r = $e['reset'] ?? null;
  return $r && $token !== '' && time() < ($r['exp'] ?? 0) && hash_equals($r['hash'] ?? '', hash('sha256', $token));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $do = $_POST['do'] ?? '';

  if ($do === 'setpass' && !flp_pass_set()) {
    $p1 = (string)($_POST['p1'] ?? ''); $p2 = (string)($_POST['p2'] ?? '');
    if (mb_strlen($p1) < 8)  $err = 'Choisissez un mot de passe d’au moins 8 caractères.';
    elseif ($p1 !== $p2)     $err = 'Les deux mots de passe ne sont pas identiques.';
    else { flp_pass_save($p1); flp_login('admin'); header('Location: ' . flp_base_path()); exit; }
  }

  elseif ($do === 'login' && flp_pass_set()) {
    if ($wait = flp_throttle_attempt()) {
      $err = 'Trop d’essais. Réessayez dans ' . ceil($wait / 60) . ' min.';
    } else {
      usleep(300000);
      $p = (string)($_POST['p'] ?? '');
      if (flp_pass_check($p))       { flp_throttle_ok(); flp_login('admin');  header('Location: ' . flp_base_path()); exit; }
      if (flp_compta_check($p))     { flp_throttle_ok(); flp_login('compta'); header('Location: ' . flp_base_path()); exit; }
      $err = 'Mot de passe incorrect.';
    }
  }

  elseif ($do === 'oubli' && !flp_throttle_attempt()) {
    // Toujours le même message, pour ne rien révéler
    $info = 'Si l’adresse est la bonne, un lien vient de partir. Il est valable 1 heure. Pensez à regarder dans les indésirables.';
    $mail = mb_strtolower(trim((string)($_POST['email'] ?? '')));
    $owner = mb_strtolower(trim(flp_settings()['email'] ?? FLP_OWNER_EMAIL));
    $e = flp_json_read('etat.json', []);
    $recent = time() - (int)($e['reset']['sent'] ?? 0) < 120;
    if ($mail !== '' && hash_equals($owner, $mail) && !$recent) {
      $tok = bin2hex(random_bytes(24));
      $e['reset'] = ['hash' => hash('sha256', $tok), 'exp' => time() + 3600, 'sent' => time()];
      flp_json_write('etat.json', $e);
      $link = flp_base_url() . '?m=reset&t=' . $tok;
      flp_mail($owner, 'Factures FLP — nouveau mot de passe',
        "Bonjour,\n\nPour choisir un nouveau mot de passe pour vos factures, ouvrez ce lien (valable 1 heure) :\n\n$link\n\nSi vous n'avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable.\n\n— Factures Fabrice Lau Production");
    }
    $mode = 'oubli';
  }

  elseif ($do === 'reset') {
    $token = (string)($_POST['t'] ?? '');
    $mode = 'reset';
    $p1 = (string)($_POST['p1'] ?? ''); $p2 = (string)($_POST['p2'] ?? '');
    if (!flp_reset_valid($token)) $err = 'Ce lien n’est plus valable. Redemandez-en un.';
    elseif (mb_strlen($p1) < 8)   $err = 'Choisissez un mot de passe d’au moins 8 caractères.';
    elseif ($p1 !== $p2)          $err = 'Les deux mots de passe ne sont pas identiques.';
    else {
      $e = flp_json_read('etat.json', []); unset($e['reset']); flp_json_write('etat.json', $e);
      flp_pass_save($p1); flp_throttle_ok(); flp_login('admin');
      header('Location: ' . flp_base_path()); exit;
    }
  }
}

/* Déjà connecté : l'application */
if ($mode === '' && flp_is_logged()) { require __DIR__ . '/app.php'; exit; }

$first = !flp_pass_set();
if ($mode === 'reset' && !$err && !flp_reset_valid($token)) { $err = 'Ce lien n’est plus valable. Redemandez-en un.'; }
$titles = ['oubli' => 'Mot de passe oublié', 'reset' => 'Nouveau mot de passe'];
$title = $first ? 'Créer le mot de passe' : ($titles[$mode] ?? 'Connexion');
$base = flp_base_path();
?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title><?= htmlspecialchars($title) ?> · Factures <?= htmlspecialchars(FLP_SITE) ?></title>
<meta name="theme-color" content="#0d1114">
<link rel="icon" href="<?= $base ?>icon.php?s=64">
<link rel="manifest" href="<?= $base ?>manifest.webmanifest">
<link rel="apple-touch-icon" href="<?= $base ?>icon.php?s=180">
<style>
  :root{--ink:#0d1114;--ink2:#151b20;--line:#26303a;--bone:#ece7df;--mute:#8f9aa3;--acc:<?= FLP_ACCENT ?>}
  *{box-sizing:border-box}
  body{margin:0;min-height:100svh;display:grid;place-items:center;background:var(--ink);color:var(--bone);
    font:400 16px/1.6 "Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:24px}
  .card{width:min(420px,100%);background:var(--ink2);border:1px solid var(--line);border-radius:12px;padding:34px 28px}
  .logo{display:flex;align-items:center;gap:12px;margin-bottom:26px}
  .logo img{width:42px;height:42px;border-radius:10px}
  .logo b{display:block;font:800 22px/1 "Arial Narrow",Arial,sans-serif;text-transform:uppercase;letter-spacing:.03em}
  .logo span{display:block;font:600 10px/1.4 ui-monospace,monospace;letter-spacing:.2em;color:var(--acc);text-transform:uppercase}
  h1{font:800 22px/1.1 "Arial Narrow",Arial,sans-serif;text-transform:uppercase;margin:0 0 6px}
  p.sub{color:var(--mute);margin:0 0 20px;font-size:14.5px}
  label{display:block;font:600 11px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:16px 0 7px}
  input{width:100%;background:#0b0f12;border:1px solid var(--line);border-radius:8px;color:var(--bone);padding:13px 14px;font-size:16px}
  input:focus{outline:none;border-color:var(--acc)}
  button{width:100%;margin-top:22px;background:var(--acc);color:#0d1114;border:0;border-radius:8px;padding:14px;font-weight:700;font-size:15px;cursor:pointer}
  .err{margin:16px 0 0;color:#ff8a7a;font-size:14px}
  .info{margin:16px 0 0;color:#8fd6ad;font-size:14px}
  .links{margin-top:18px;display:flex;justify-content:space-between;font-size:13px}
  a{color:var(--mute)} a:hover{color:var(--bone)}
</style>
</head>
<body>
  <form class="card" method="post" autocomplete="off" action="<?= $base ?>">
    <div class="logo"><img src="<?= $base ?>icon.php?s=96" alt=""><div><b>Factures</b><span>Fabrice Lau Production</span></div></div>
    <h1><?= htmlspecialchars($title) ?></h1>
    <?php if ($first): ?>
      <p class="sub">Première visite. Choisissez le mot de passe qui protégera vos factures.</p>
      <input type="hidden" name="do" value="setpass">
      <label>Mot de passe</label><input name="p1" type="password" required minlength="8" autofocus autocomplete="new-password">
      <label>Confirmez</label><input name="p2" type="password" required minlength="8" autocomplete="new-password">
      <button type="submit">Créer et entrer</button>
    <?php elseif ($mode === 'oubli'): ?>
      <p class="sub">Entrez votre adresse e-mail : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <input type="hidden" name="do" value="oubli">
      <label>Adresse e-mail</label><input name="email" type="email" required autofocus autocomplete="email">
      <button type="submit">Recevoir le lien</button>
      <div class="links"><a href="<?= $base ?>">← Retour à la connexion</a></div>
    <?php elseif ($mode === 'reset'): ?>
      <p class="sub">Choisissez votre nouveau mot de passe. Vos autres appareils seront déconnectés.</p>
      <input type="hidden" name="do" value="reset">
      <input type="hidden" name="t" value="<?= htmlspecialchars($token) ?>">
      <label>Nouveau mot de passe</label><input name="p1" type="password" required minlength="8" autofocus autocomplete="new-password">
      <label>Confirmez</label><input name="p2" type="password" required minlength="8" autocomplete="new-password">
      <button type="submit">Enregistrer et entrer</button>
      <div class="links"><a href="<?= $base ?>?m=oubli">Redemander un lien</a></div>
    <?php else: ?>
      <p class="sub">Espace privé. Entrez votre mot de passe.</p>
      <input type="hidden" name="do" value="login">
      <label>Mot de passe</label><input name="p" type="password" required autofocus autocomplete="current-password">
      <button type="submit">Entrer</button>
      <div class="links"><a href="<?= $base ?>?m=oubli">Mot de passe oublié ?</a></div>
    <?php endif; ?>
    <?php if ($err): ?><p class="err"><?= htmlspecialchars($err) ?></p><?php endif; ?>
    <?php if ($info): ?><p class="info"><?= htmlspecialchars($info) ?></p><?php endif; ?>
  </form>
</body>
</html>
