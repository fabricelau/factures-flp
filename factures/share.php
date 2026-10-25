<?php
/* Réception d'un « Partager → Factures FLP » : les fichiers sont ajoutés,
   puis l'appli s'ouvre et les lit automatiquement. */
require_once __DIR__ . '/lib.php';
if (!flp_is_admin() || $_SERVER['REQUEST_METHOD'] !== 'POST') { header('Location: ' . flp_base_path()); exit; }
/* Seul le partage du téléphone (ou l'appli elle-même) peut envoyer ici */
$sfs = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
if ($sfs !== '' && !in_array($sfs, ['same-origin', 'none'], true)) { http_response_code(403); exit('Refusé.'); }
$ids = [];
$files = $_FILES['files'] ?? null;
/* Un seul fichier (« files ») ou plusieurs (« files[] ») : même forme */
if ($files && !is_array($files['name'])) $files = array_map(fn($v) => [$v], $files);
if ($files && is_array($files['name'])) {
  $n = count($files['name']);
  for ($i = 0; $i < $n && $i < 20; $i++) {
    if ($files['error'][$i] !== UPLOAD_ERR_OK || $files['size'][$i] > FLP_MAX_UPLOAD) continue;
    $tmp = $files['tmp_name'][$i];
    $ext = flp_ext_ok((new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: '');
    if (!$ext) continue;
    $hash = sha1_file($tmp);
    $ids[] = flp_write(function (&$d) use ($tmp, $ext, $hash) {
      $id = ++$d['seq'];
      $x = flp_normalize(['id' => $id, 'v' => 2, 'ext' => $ext, 'hash' => $hash, 'added' => date('c'), 'source' => 'partage', 'check' => true, 'year' => date('Y')]);
      move_uploaded_file($tmp, flp_file_path($x)); @chmod(flp_file_path($x), 0600);
      $x['thumb'] = flp_make_thumb(flp_file_path($x), flp_thumb_path($id), $ext);
      $x['filename'] = flp_nice_name($x, $d['items']);
      $d['items'][] = $x;
      return $id;
    });
  }
}
/* Les numéros à relire restent sur le serveur (l'adresse ne transporte rien) */
if ($ids) { $e = flp_json_read('etat.json', []); $e['partage'] = array_merge($e['partage'] ?? [], $ids); flp_json_write('etat.json', $e); }
header('Location: ' . flp_base_path() . ($ids ? '#partage' : ''));
