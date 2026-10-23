<?php
/* =====================================================================
   Factures FLP — API. Toutes les actions passent par ?a=…
   Rôles : « admin » (Fabrice, tout) et « compta » (lecture + exports).
   ===================================================================== */
require_once __DIR__ . '/lib.php';

$role = flp_role();
if (!$role) flp_json(['ok' => false, 'msg' => 'Non connecté.'], 401);
$a = $_GET['a'] ?? '';
$POST = $_SERVER['REQUEST_METHOD'] === 'POST';

/* Actions qui modifient : réservées à l'admin, avec le jeton anti-falsification */
$WRITE = ['upload','lu','save','km','bulk','trash','restore','delete','rotate','replace','settings','password','update_run','dropbox_sync','partage'];
if (in_array($a, $WRITE, true) || $a === 'logout') {
  if (!$POST) flp_json(['ok' => false, 'msg' => 'Méthode refusée.'], 405);
  if ($a !== 'logout' && $role !== 'admin') flp_json(['ok' => false, 'msg' => 'Accès en lecture seule.'], 403);
  if (!flp_csrf_ok()) flp_json(['ok' => false, 'msg' => 'Session expirée, rechargez la page.'], 419);
}
/* Taux de change récupéré AVANT de verrouiller l'index (jamais d'appel réseau pendant l'écriture) */
$RATE_FAIL = false;
if ($POST && in_array($a, ['upload', 'lu', 'save'], true)) {
  $dv = strtoupper(trim((string)($_POST['devise'] ?? 'EUR')));
  if (preg_match('/^[A-Z]{3}$/', $dv) && $dv !== 'EUR' && trim((string)($_POST['montant'] ?? '')) !== '') {
    $RATE_FAIL = flp_rate($dv, (string)($_POST['date'] ?? '')) === null;
    if ($RATE_FAIL && $a === 'save') flp_json(['ok' => false, 'msg' => "Taux de change $dv indisponible pour l’instant : réessayez, ou saisissez le montant en euros."], 422);
  }
}
const FLP_DOUBT_KEYS = ['societe', 'date', 'montant', 'categorie', 'devise', 'tva', 'lecture'];
$in  = fn($k, $def = '') => trim((string)($_POST[$k] ?? $def));
$find = function (array $items, int $id) { foreach ($items as $x) if ((int)$x['id'] === $id) return $x; return null; };

/* Champs communs à l'envoi et à l'enregistrement */
function flp_apply_fields(array &$x, callable $in, bool $partial): void {
  $has = fn($k) => !$partial || array_key_exists($k, $_POST);
  if ($has('sens'))      $x['sens'] = $in('sens') === 'vente' ? 'vente' : 'achat';
  if ($has('societe'))   $x['societe'] = mb_substr($in('societe'), 0, 120);
  if ($has('date'))      $x['date'] = preg_match('/^\d{4}-\d{2}-\d{2}$/', $in('date')) ? $in('date') : '';
  if ($has('numero'))    $x['numero'] = mb_substr($in('numero'), 0, 60);
  if ($has('note'))      $x['note'] = mb_substr($in('note'), 0, 2000);
  if ($has('paiement'))  $x['paiement'] = in_array($in('paiement'), ['CB','Espèces','Virement','Chèque','Prélèvement','PayPal',''], true) ? $in('paiement') : '';
  if ($has('categorie')) {
    $cats = $x['sens'] === 'vente' ? FLP_CATEGORIES_VENTES : FLP_CATEGORIES;
    $x['categorie'] = in_array($in('categorie'), $cats, true) ? $in('categorie') : '';
  }
  if ($has('devise'))    $x['devise'] = preg_match('/^[A-Z]{3}$/', $in('devise')) ? $in('devise') : FLP_DEVISE;
  if ($has('ht'))        $x['ht'] = flp_num($in('ht'));
  if ($has('tva'))       $x['tva'] = flp_num($in('tva'));
  if ($has('taux_tva'))  $x['taux_tva'] = flp_num($in('taux_tva'));
  /* Montant : saisi dans la devise de la facture, converti en euros au taux du jour de la facture */
  if ($has('montant')) {
    $m = flp_num($in('montant'));
    if ($x['devise'] !== 'EUR' && $m !== null) {
      $rate = flp_rate($x['devise'], $x['date']);   // déjà en cache (récupéré avant l'écriture)
      $x['montant_orig'] = $m;
      $x['taux_change'] = $rate;
      $x['montant'] = $rate ? round($m / $rate, 2) : null;
      if (!$rate) { $x['doutes'][] = 'montant'; $x['check'] = true; }
    } else {
      $x['montant'] = $m; $x['montant_orig'] = null; $x['taux_change'] = null;
    }
  }
  $x['year'] = $x['date'] ? substr($x['date'], 0, 4) : ($x['year'] ?: date('Y'));
}

/* ===================================================================
   LISTE
   =================================================================== */
if ($a === 'list') {
  $d = flp_read();
  $items = array_values(array_filter($d['items'], fn($x) => empty($x['trashed'])));
  $trash = count($d['items']) - count($items);
  $soc = [];
  foreach ($items as $x) { $s = trim($x['societe']); if ($s !== '') $soc[$s] = ($soc[$s] ?? 0) + 1; }
  arsort($soc);
  $L = flp_json_read('apprentissage.json', ['f' => []]);
  $learn = [];
  foreach ($L['f'] as $name => $e) $learn[] = ['n' => $name, 'cat' => $e['cat'] ?? '', 'w' => array_slice(array_keys($e['w'] ?? []), 0, 25)];
  $S = flp_settings();
  flp_json([
    'ok' => true, 'role' => $role, 't' => flp_csrf(),
    'items' => $items, 'trash' => $trash,
    'societes' => array_keys($soc), 'learn' => $learn,
    'doublons' => flp_find_duplicates($items),
    'cfg' => [
      'site' => FLP_SITE, 'accent' => FLP_ACCENT, 'base' => flp_base_path(),
      'categories' => FLP_CATEGORIES, 'categories_ventes' => FLP_CATEGORIES_VENTES,
      'bareme' => FLP_BAREME_KM, 'keepYears' => FLP_KEEP_YEARS, 'trashDays' => FLP_TRASH_DAYS,
      'dropbox' => $role === 'admin' && !empty($S['dropbox']['refresh']),
    ],
  ], 200, $role === 'admin');
  if ($role === 'admin') flp_maintenance();   // après l'envoi de la réponse : l'affichage n'attend jamais
  exit;
}

/* Factures arrivées par « Partager » : liste gardée sur le serveur, rendue une seule fois */
if ($a === 'partage') {
  $e = flp_json_read('etat.json', []);
  $ids = array_values(array_unique(array_map('intval', $e['partage'] ?? [])));
  unset($e['partage']); flp_json_write('etat.json', $e);
  flp_json(['ok' => true, 'ids' => $ids]);
}

/* Infos légères pour l'appli photo (sans la liste complète) */
if ($a === 'meta') {
  $L = flp_json_read('apprentissage.json', ['f' => []]);
  $learn = [];
  foreach ($L['f'] as $name => $e) $learn[] = ['n' => $name, 'cat' => $e['cat'] ?? '', 'w' => array_slice(array_keys($e['w'] ?? []), 0, 25)];
  flp_json(['ok' => true, 'role' => $role, 't' => flp_csrf(), 'learn' => $learn,
    'cfg' => ['categories' => FLP_CATEGORIES, 'categories_ventes' => FLP_CATEGORIES_VENTES]]);
}

/* ===================================================================
   ENVOI d'une pièce (photo, PDF, scan multi-pages)
   =================================================================== */
if ($a === 'upload') {
  $err = $_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE;
  if ($err !== UPLOAD_ERR_OK) {
    $why = [UPLOAD_ERR_INI_SIZE => 'Fichier trop volumineux pour le serveur.', UPLOAD_ERR_FORM_SIZE => 'Fichier trop volumineux.',
            UPLOAD_ERR_PARTIAL => 'Envoi interrompu, réessayez.', UPLOAD_ERR_NO_FILE => 'Aucun fichier reçu (photo vide).'][$err] ?? 'Envoi refusé par le serveur (code ' . (int)$err . ').';
    // un envoi coupé n'est pas définitif : 503 pour que l'appli réessaie
    flp_json(['ok' => false, 'msg' => $why], $err === UPLOAD_ERR_PARTIAL ? 503 : 422);
  }
  if (!filesize($_FILES['file']['tmp_name'])) flp_json(['ok' => false, 'msg' => 'Aucun fichier reçu (photo vide).'], 422);
  $tmp = $_FILES['file']['tmp_name'];
  if (filesize($tmp) > FLP_MAX_UPLOAD) flp_json(['ok' => false, 'msg' => 'Fichier trop volumineux (40 Mo maximum).'], 422);
  $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: '';
  $ext = flp_ext_ok($mime);
  if (!$ext) flp_json(['ok' => false, 'msg' => 'Format non accepté (photo ou PDF).'], 422);
  $hash = sha1_file($tmp);

  $item = flp_write(function (&$d) use ($ext, $tmp, $hash, $in) {
    $id = ++$d['seq'];
    $x = flp_normalize(['id' => $id, 'v' => 2]);
    flp_apply_fields($x, $in, false);
    $x['texte']  = mb_substr($in('texte'), 0, 20000);
    $x['doutes'] = array_values(array_unique(array_merge($x['doutes'], array_intersect(array_map('trim', explode(',', $in('doutes'))), FLP_DOUBT_KEYS))));
    $x['source'] = in_array($in('source'), ['scan', 'import', 'partage'], true) ? $in('source') : 'import';
    $x['pages']  = max(1, min(200, (int)$in('pages', '1')));
    $x['ext'] = $ext; $x['hash'] = $hash; $x['added'] = date('c');
    move_uploaded_file($tmp, flp_file_path($x)); @chmod(flp_file_path($x), 0600);
    $x['thumb'] = flp_save_client_thumb($id) || flp_make_thumb(flp_file_path($x), flp_thumb_path($id), $ext);
    $x['check'] = $x['societe'] === '' || $x['montant'] === null || $x['date'] === '' || !empty($x['doutes']);
    $x['filename'] = flp_nice_name($x);
    $d['items'][] = $x;
    return $x;
  });
  $dupe = in_array((int)$item['id'], flp_find_duplicates(flp_read()['items']), true);
  if (is_file(__DIR__ . '/dropbox.php')) { require_once __DIR__ . '/dropbox.php'; if (flp_dbx_ready()) flp_dbx_sync_item($item); }
  flp_json(['ok' => true, 'item' => $item, 'doublon' => $dupe]);
}

/* Lecture faite APRÈS l'envoi (l'appli photo envoie d'abord, lit ensuite) :
   on ne remplit que les champs encore vides, sans écraser une saisie. */
if ($a === 'lu') {
  $id = (int)$in('id');
  $res = flp_write(function (&$d) use ($id, $in) {
    foreach ($d['items'] as &$x) {
      if ((int)$x['id'] !== $id) continue;
      $empty = ['societe' => $x['societe'] === '', 'date' => $x['date'] === '', 'numero' => ($x['numero'] ?? '') === '',
                'categorie' => $x['categorie'] === '', 'montant' => $x['montant'] === null,
                'ht' => ($x['ht'] ?? null) === null, 'tva' => ($x['tva'] ?? null) === null, 'taux_tva' => ($x['taux_tva'] ?? null) === null];
      $empty['devise'] = $empty['montant'];
      $saved = $_POST;
      foreach ($empty as $k => $e) if (!$e || !array_key_exists($k, $_POST) || trim((string)$_POST[$k]) === '') unset($_POST[$k]);
      foreach (['sens', 'note', 'paiement'] as $k) unset($_POST[$k]);
      $filled = array_keys(array_intersect_key($_POST, $empty));
      flp_apply_fields($x, $in, true);
      $_POST = $saved;
      if (($x['texte'] ?? '') === '') $x['texte'] = mb_substr($in('texte'), 0, 20000);
      $dt = array_intersect(array_map('trim', explode(',', $in('doutes'))), FLP_DOUBT_KEYS);
      $x['doutes'] = array_values(array_unique(array_merge(array_diff($x['doutes'] ?? [], ['lecture']), array_intersect($dt, $filled), $x['texte'] === '' ? ['lecture'] : [])));
      $x['check'] = $x['check'] || $x['societe'] === '' || $x['montant'] === null || $x['date'] === '' || !empty($x['doutes']);
      $x['filename'] = flp_nice_name($x);
      return $x;
    }
    return null;
  });
  if (!$res) flp_json(['ok' => false, 'msg' => 'Facture introuvable.'], 404);
  flp_json(['ok' => true, 'item' => $res]);
}

/* ===================================================================
   FRAIS KILOMÉTRIQUES (sans pièce)
   =================================================================== */
if ($a === 'km') {
  $dist = flp_num($in('distance'));
  $cv = preg_replace('/\D/', '', $in('cv', '5')) ?: '5';
  if (!$dist || $dist <= 0) flp_json(['ok' => false, 'msg' => 'Indiquez la distance.'], 422);
  $id0 = (int)$in('id', '0');
  $res = flp_write(function (&$d) use ($dist, $cv, $in, $id0) {
    if ($id0) { foreach ($d['items'] as &$x) if ((int)$x['id'] === $id0) { $ref = &$x; break; } }
    if (empty($ref)) { $id = ++$d['seq']; $d['items'][] = flp_normalize(['id' => $id, 'v' => 2, 'type' => 'km', 'added' => date('c'), 'source' => 'saisie']); $ref = &$d['items'][count($d['items']) - 1]; }
    $ref['type'] = 'km'; $ref['sens'] = 'achat';
    $ref['date'] = preg_match('/^\d{4}-\d{2}-\d{2}$/', $in('date')) ? $in('date') : date('Y-m-d');
    $ref['year'] = substr($ref['date'], 0, 4);
    $ref['km'] = ['distance' => $dist, 'cv' => $cv, 'trajet' => mb_substr($in('trajet'), 0, 200), 'ar' => $in('ar') === '1'];
    $total = $ref['km']['ar'] ? $dist * 2 : $dist;
    $ref['montant'] = flp_km_amount($total, $cv);
    $ref['societe'] = 'Frais kilométriques';
    $ref['categorie'] = 'Frais kilométriques';
    $ref['note'] = mb_substr($in('note'), 0, 2000);
    $ref['check'] = false; $ref['ext'] = ''; $ref['thumb'] = false;
    return $ref;
  });
  flp_json(['ok' => true, 'item' => $res]);
}

/* ===================================================================
   ENREGISTRER une fiche
   =================================================================== */
if ($a === 'save') {
  $id = (int)$in('id');
  $res = flp_write(function (&$d) use ($id, $in) {
    foreach ($d['items'] as &$x) {
      if ((int)$x['id'] !== $id) continue;
      flp_apply_fields($x, $in, true);
      if (array_key_exists('transmis', $_POST)) $x['transmis'] = $in('transmis') === '1' ? ($x['transmis'] ?: date('c')) : '';
      $x['check'] = array_key_exists('check', $_POST) ? $in('check') === '1' : ($x['societe'] === '' || $x['montant'] === null || $x['date'] === '');
      $x['doutes'] = [];
      $x['filename'] = flp_nice_name($x);
      return $x;
    }
    return null;
  });
  if (!$res) flp_json(['ok' => false, 'msg' => 'Facture introuvable.'], 404);
  if ($res['type'] === 'piece') flp_learn($res['societe'], $res['categorie'], $res['texte']);
  flp_json(['ok' => true, 'item' => $res]);
}

/* ===================================================================
   ACTIONS GROUPÉES (sélection multiple)
   =================================================================== */
if ($a === 'bulk') {
  $ids = array_map('intval', array_filter(explode(',', $in('ids'))));
  $op = $in('op'); $val = $in('val');
  if (!$ids) flp_json(['ok' => false, 'msg' => 'Rien de sélectionné.'], 422);
  $n = flp_write(function (&$d) use ($ids, $op, $val) {
    $n = 0;
    foreach ($d['items'] as &$x) {
      if (!in_array((int)$x['id'], $ids, true)) continue;
      if ($op === 'categorie') { $cats = $x['sens'] === 'vente' ? FLP_CATEGORIES_VENTES : FLP_CATEGORIES; if (!in_array($val, $cats, true)) continue; $x['categorie'] = $val; }
      elseif ($op === 'trash')    { $x['trashed'] = true; $x['trashed_at'] = date('c'); }
      elseif ($op === 'transmis') { $x['transmis'] = $val === '1' ? date('c') : ''; }
      elseif ($op === 'check')    { $x['check'] = $val === '1'; }
      elseif ($op === 'sens')     { $x['sens'] = $val === 'vente' ? 'vente' : 'achat'; $x['categorie'] = ''; }
      else continue;
      $n++;
    }
    return $n;
  });
  flp_json(['ok' => true, 'n' => $n]);
}

/* ===================================================================
   CORBEILLE
   =================================================================== */
if ($a === 'trash' || $a === 'restore') {
  $id = (int)$in('id');
  $ok = flp_write(function (&$d) use ($id, $a) {
    foreach ($d['items'] as &$x) if ((int)$x['id'] === $id) {
      if ($a === 'trash') { $x['trashed'] = true; $x['trashed_at'] = date('c'); }
      else { $x['trashed'] = false; unset($x['trashed_at']); }
      return true;
    }
    return false;
  });
  flp_json(['ok' => (bool)$ok]);
}
if ($a === 'trashlist') {
  $items = array_values(array_filter(flp_read()['items'], fn($x) => !empty($x['trashed'])));
  flp_json(['ok' => true, 'items' => $items]);
}
if ($a === 'delete') {
  $id = (int)$in('id');
  $gone = flp_write(function (&$d) use ($id) {
    $gone = null;
    $d['items'] = array_values(array_filter($d['items'], function ($x) use ($id, &$gone) {
      if ((int)$x['id'] === $id && !empty($x['trashed'])) { $gone = $x; return false; }
      return true;
    }));
    return $gone;
  });
  if ($gone) { if ($gone['ext']) @unlink(flp_file_path($gone)); @unlink(flp_thumb_path($id)); }
  flp_json(['ok' => (bool)$gone]);
}

/* ===================================================================
   ROTATION et REMPLACEMENT du fichier
   =================================================================== */
if ($a === 'rotate') {
  $id = (int)$in('id'); $deg = (int)$in('deg') === -90 ? -90 : ((int)$in('deg') === 180 ? 180 : 90);
  $x = $find(flp_read()['items'], $id);
  if (!$x || !in_array($x['ext'], ['jpg', 'png', 'webp'], true)) flp_json(['ok' => false, 'msg' => 'Rotation possible seulement sur une photo.'], 422);
  if (!flp_rotate($x, $deg)) flp_json(['ok' => false, 'msg' => 'Rotation impossible.'], 500);
  $x = flp_write(function (&$d) use ($id) { foreach ($d['items'] as &$y) if ((int)$y['id'] === $id) { $y['thumb'] = true; $y['hash'] = sha1_file(flp_file_path($y)); $y['rot'] = time(); return $y; } });
  flp_json(['ok' => true, 'item' => $x]);
}
if ($a === 'replace') {
  $id = (int)$in('id');
  if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) flp_json(['ok' => false, 'msg' => 'Fichier manquant.'], 422);
  $tmp = $_FILES['file']['tmp_name'];
  $ext = flp_ext_ok((new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: '');
  if (!$ext) flp_json(['ok' => false, 'msg' => 'Format non accepté.'], 422);
  $res = flp_write(function (&$d) use ($id, $ext, $tmp, $in) {
    foreach ($d['items'] as &$x) if ((int)$x['id'] === $id) {
      if ($x['ext'] && is_file(flp_file_path($x))) @unlink(flp_file_path($x));
      $x['ext'] = $ext; $x['type'] = 'piece';
      move_uploaded_file($tmp, flp_file_path($x)); @chmod(flp_file_path($x), 0600);
      @unlink(flp_thumb_path($id));
      $x['thumb'] = flp_save_client_thumb($id) || flp_make_thumb(flp_file_path($x), flp_thumb_path($id), $ext);
      $x['hash'] = sha1_file(flp_file_path($x));
      $x['pages'] = max(1, (int)$in('pages', '1'));
      if ($in('texte') !== '') $x['texte'] = mb_substr($in('texte'), 0, 20000);
      $x['rot'] = time();
      $x['filename'] = flp_nice_name($x);
      return $x;
    }
    return null;
  });
  if (!$res) flp_json(['ok' => false, 'msg' => 'Facture introuvable.'], 404);
  if (is_file(__DIR__ . '/dropbox.php')) { require_once __DIR__ . '/dropbox.php'; if (flp_dbx_ready()) flp_dbx_sync_item($res, true); }
  flp_json(['ok' => true, 'item' => $res]);
}

/* ===================================================================
   FICHIER / MINIATURE (jamais accessibles directement par une URL)
   =================================================================== */
if ($a === 'file' || $a === 'thumb') {
  $x = $find(flp_read()['items'], (int)($_GET['id'] ?? 0));
  if (!$x || !$x['ext']) { http_response_code(404); exit; }
  $id = (int)$x['id'];
  if ($a === 'thumb' && $x['thumb'] && is_file(flp_thumb_path($id))) { $p = flp_thumb_path($id); $type = 'image/jpeg'; }
  else { $p = flp_file_path($x); $type = flp_mime($x['ext']); }
  if (!is_file($p)) { http_response_code(404); exit; }
  header('Content-Type: ' . $type);
  header('Cache-Control: private, max-age=86400');
  header('Content-Length: ' . filesize($p));
  header('X-Content-Type-Options: nosniff');
  $name = flp_nice_name($x);
  header('Content-Disposition: ' . (($_GET['dl'] ?? '') === '1' ? 'attachment' : 'inline') . '; filename="' . $name . '"');
  readfile($p);
  exit;
}

/* ===================================================================
   EXPORT ZIP (pièces renommées + tableau CSV) pour le comptable
   =================================================================== */
if ($a === 'zip') {
  if (!class_exists('ZipArchive')) flp_json(['ok' => false, 'msg' => 'ZIP indisponible sur le serveur.'], 500);
  $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : '0000-00-00';
  $to   = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['to'] ?? '') ? $_GET['to'] : '9999-12-31';
  $sens = in_array($_GET['sens'] ?? '', ['achat', 'vente'], true) ? $_GET['sens'] : '';
  $items = array_values(array_filter(flp_read()['items'], fn($x) => empty($x['trashed'])
    && ($x['date'] ?: substr($x['added'], 0, 10)) >= $from && ($x['date'] ?: substr($x['added'], 0, 10)) <= $to
    && ($sens === '' || $x['sens'] === $sens)));
  usort($items, fn($p, $q) => strcmp($p['date'], $q['date']));
  $zipPath = flp_tmp_dir() . '/export-' . bin2hex(random_bytes(4)) . '.zip';
  $z = new ZipArchive(); $z->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
  $csv = "\xEF\xBB\xBF" . implode(';', ['Sens','Date','Fournisseur / client','N°','Catégorie','HT','TVA','Taux TVA','TTC (EUR)','Devise','Montant devise','Paiement','Note','Fichier']) . "\r\n";
  $q = fn($v) => '"' . str_replace('"', '""', (string)$v) . '"';
  $fr = fn($v) => $v === null ? '' : number_format((float)$v, 2, ',', '');
  foreach ($items as $x) {
    $file = '';
    if ($x['type'] === 'piece' && $x['ext'] && is_file(flp_file_path($x))) {
      $file = ($x['sens'] === 'vente' ? 'emises/' : 'recues/') . flp_nice_name($x);
      $z->addFile(flp_file_path($x), $file);
    }
    $csv .= implode(';', [$q($x['sens'] === 'vente' ? 'Émise' : 'Reçue'), $q($x['date']), $q($x['societe']), $q($x['numero']), $q($x['categorie']),
      $q($fr($x['ht'])), $q($fr($x['tva'])), $q($x['taux_tva'] === null ? '' : $fr($x['taux_tva']) . ' %'), $q($fr($x['montant'])),
      $q($x['devise']), $q($fr($x['montant_orig'])), $q($x['paiement']), $q(str_replace(["\r", "\n"], ' ', $x['note'] . ($x['km'] ? ' — ' . $x['km']['trajet'] . ' (' . $x['km']['distance'] . ' km' . ($x['km']['ar'] ? ' A/R' : '') . ', ' . $x['km']['cv'] . ' CV)' : ''))), $q($file)]) . "\r\n";
  }
  $z->addFromString('factures.csv', $csv);
  $z->close();
  $label = ($from === '0000-00-00' ? 'tout' : $from) . ($to === '9999-12-31' ? '' : '_au_' . $to);
  header('Content-Type: application/zip');
  header('Content-Disposition: attachment; filename="factures-flp_' . $label . '.zip"');
  header('Content-Length: ' . filesize($zipPath));
  readfile($zipPath); @unlink($zipPath);
  exit;
}

/* ===================================================================
   SAUVEGARDE COMPLÈTE à télécharger
   =================================================================== */
if ($a === 'backup') {
  if ($role !== 'admin') flp_json(['ok' => false, 'msg' => 'Réservé.'], 403);
  @set_time_limit(300);
  $p = flp_backup_full();
  if (!$p) flp_json(['ok' => false, 'msg' => 'Sauvegarde impossible.'], 500);
  header('Content-Type: application/zip');
  header('Content-Disposition: attachment; filename="' . basename($p) . '"');
  header('Content-Length: ' . filesize($p));
  readfile($p); @unlink($p);
  exit;
}

/* ===================================================================
   RÉGLAGES
   =================================================================== */
if ($a === 'settings_get') {
  if ($role !== 'admin') flp_json(['ok' => false], 403);
  $S = flp_settings();
  $b = glob(flp_backups_dir() . '/donnees-*.zip') ?: []; sort($b);
  $e = flp_json_read('etat.json', []);
  flp_json(['ok' => true, 's' => [
    'email' => $S['email'],
    'compta' => $S['compta_hash'] !== '',
    'github_repo' => $S['github']['repo'], 'github_branch' => $S['github']['branch'] ?: 'main', 'github_token' => $S['github']['token'] !== '',
    'dropbox_key' => $S['dropbox']['app_key'], 'dropbox_secret' => $S['dropbox']['app_secret'] !== '',
    'dropbox_on' => $S['dropbox']['refresh'] !== '', 'dropbox_account' => $S['dropbox']['account'] ?? '', 'dropbox_folder' => $S['dropbox']['folder'] ?: '/Factures FLP',
    'last_backup' => $b ? basename(end($b)) : '', 'backups' => count($b),
    'version' => is_file(__DIR__ . '/VERSION') ? trim((string)file_get_contents(__DIR__ . '/VERSION')) : '',
    'last_sync' => $e['dbx_sync'] ?? 0,
  ]]);
}
if ($a === 'settings') {
  $S = flp_settings();
  if (array_key_exists('email', $_POST)) { $m = $in('email'); if ($m !== '' && !filter_var($m, FILTER_VALIDATE_EMAIL)) flp_json(['ok' => false, 'msg' => 'Adresse e-mail invalide.'], 422); $S['email'] = $m ?: FLP_OWNER_EMAIL; }
  if (array_key_exists('compta', $_POST)) {
    $p = (string)$_POST['compta'];
    if ($p === '') $S['compta_hash'] = '';
    else { if (mb_strlen($p) < 8) flp_json(['ok' => false, 'msg' => 'Mot de passe comptable : 8 caractères minimum.'], 422);
           if (flp_pass_check($p)) flp_json(['ok' => false, 'msg' => 'Choisissez un mot de passe différent du vôtre.'], 422);
           $S['compta_hash'] = password_hash($p, PASSWORD_DEFAULT); }
  }
  if (array_key_exists('github_repo', $_POST)) { $r = $in('github_repo'); if ($r !== '' && !preg_match('~^[\w.-]+/[\w.-]+$~', $r)) flp_json(['ok' => false, 'msg' => 'Dépôt : format « compte/nom ».'], 422); $S['github']['repo'] = $r; }
  if (array_key_exists('github_branch', $_POST)) $S['github']['branch'] = preg_replace('~[^\w./-]~', '', $in('github_branch')) ?: 'main';
  if (array_key_exists('github_token', $_POST) && $in('github_token') !== '') $S['github']['token'] = $in('github_token');
  if (($_POST['github_token_clear'] ?? '') === '1') $S['github']['token'] = '';
  if (array_key_exists('dropbox_key', $_POST)) $S['dropbox']['app_key'] = preg_replace('/[^\w]/', '', $in('dropbox_key'));
  if (array_key_exists('dropbox_secret', $_POST) && $in('dropbox_secret') !== '') $S['dropbox']['app_secret'] = preg_replace('/[^\w]/', '', $in('dropbox_secret'));
  if (array_key_exists('dropbox_folder', $_POST)) { $f = '/' . trim(preg_replace('~[^\w À-ÿ./-]~u', '', $in('dropbox_folder')), '/'); $S['dropbox']['folder'] = $f === '/' ? '/Factures FLP' : $f; }
  if (($_POST['dropbox_off'] ?? '') === '1') { $S['dropbox']['refresh'] = ''; $S['dropbox']['account'] = ''; }
  flp_settings_save($S);
  flp_json(['ok' => true, 'msg' => 'Réglages enregistrés.']);
}
if ($a === 'password') {
  if (!flp_pass_check((string)($_POST['old'] ?? ''))) flp_json(['ok' => false, 'msg' => 'Mot de passe actuel incorrect.'], 422);
  $new = (string)($_POST['new'] ?? '');
  if (mb_strlen($new) < 8) flp_json(['ok' => false, 'msg' => '8 caractères minimum.'], 422);
  flp_pass_save($new); flp_login('admin');
  flp_json(['ok' => true, 'msg' => 'Mot de passe modifié. Vos autres appareils sont déconnectés.', 't' => flp_csrf()]);
}

/* ===================================================================
   MISE À JOUR EN UN CLIC (depuis GitHub)
   =================================================================== */
if ($a === 'update_check' || $a === 'update_run') {
  if ($role !== 'admin') flp_json(['ok' => false], 403);
  require_once __DIR__ . '/updater.php';
  if ($a === 'update_check') flp_json(flp_update_check());
  flp_json(flp_update_run());
}

/* ===================================================================
   DROPBOX : envoyer maintenant ce qui manque
   =================================================================== */
if ($a === 'dropbox_sync') {
  if ($role !== 'admin') flp_json(['ok' => false], 403);
  require_once __DIR__ . '/dropbox.php';
  if (!flp_dbx_ready()) flp_json(['ok' => false, 'msg' => 'Dropbox n’est pas connecté.'], 422);
  @set_time_limit(300);
  $n = flp_dbx_sync_pending(200);
  flp_json(['ok' => true, 'n' => $n, 'msg' => $n ? "$n fichier(s) copié(s) dans Dropbox." : 'Tout est déjà dans Dropbox.']);
}

if ($a === 'logout') { flp_logout(); flp_json(['ok' => true]); }

flp_json(['ok' => false, 'msg' => 'Action inconnue.'], 400);
