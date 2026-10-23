<?php
/* =====================================================================
   Factures — Fabrice Lau Production · réglages fixes de l'application.
   Les réglages modifiables (e-mail, accès comptable, GitHub, Dropbox…)
   se font dans l'appli : menu ⋯ → Réglages. Ils sont enregistrés hors
   du dossier public, et ne sont jamais écrasés par une mise à jour.
   ===================================================================== */

const FLP_SITE   = 'Fabrice Lau Production';
const FLP_SHORT  = 'Factures FLP';
const FLP_ACCENT = '#e3a653';
const FLP_DEVISE = 'EUR';

/* Adresse publique de l'appli (liens envoyés par e-mail, retour Dropbox) */
const FLP_BASE_URL = 'https://fabricelauproduction.com/factures/';

/* Adresse qui reçoit le lien « mot de passe oublié » (modifiable dans Réglages) */
const FLP_OWNER_EMAIL = 'fabrice.ltl@gmail.com';
const FLP_MAIL_FROM   = 'no-reply@fabricelauproduction.com';

/* Dossier des données, HORS du dossier public : /home/<compte>/.flp-factures
   (l'appli est dans /home/<compte>/public_html/<site>/factures, d'où les 3 niveaux).
   La version 1 le rangeait par erreur dans public_html : il est déplacé une fois,
   et la clé de connexion est renouvelée par précaution. */
function flp_data_dir(): string {
  static $dir = null;
  if ($dir !== null) return $dir;
  $dir = dirname(__DIR__, 3) . '/.flp-factures';
  $old = dirname(__DIR__, 2) . '/.flp-factures';
  if (!is_dir($dir) && is_dir($old) && @rename($old, $dir)) {
    @unlink($dir . '/.cle-session');
  }
  if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
    $dir = $old;                       // repli si le dossier personnel n'est pas inscriptible
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
  }
  if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
  return $dir;
}

const FLP_MAX_UPLOAD  = 41943040;   // 40 Mo par fichier
const FLP_SESSION_TTL = 2592000;    // 30 jours de connexion
const FLP_TRASH_DAYS  = 30;         // la corbeille se vide après 30 jours
const FLP_BACKUP_KEEP = 30;         // nombre de sauvegardes quotidiennes gardées
const FLP_KEEP_YEARS  = 10;         // conservation légale des pièces

/* Catégories des factures REÇUES (achats) */
const FLP_CATEGORIES = [
  'Équipement & matériel vidéo',
  'Informatique & logiciels',
  'Déplacements & carburant',
  'Repas & réception',
  'Location & studio',
  'Sous-traitance & prestations',
  'Marketing & publicité',
  'Fournitures de bureau',
  'Assurance & banque',
  'Hébergement & web',
  'Charges & abonnements',
  'Frais kilométriques',
  'Autre',
];

/* Catégories des factures ÉMISES (ventes) */
const FLP_CATEGORIES_VENTES = [
  'Vidéo corporate',
  'Publicité',
  'Événementiel',
  'Clip musical',
  'Photo',
  'Mariage',
  'Montage & post-production',
  'Drone',
  'Autre prestation',
];

/* Barème kilométrique (voitures) — à vérifier chaque année sur impots.gouv.fr.
   Pour chaque puissance fiscale : [jusqu'à 5 000 km : d × a],
   [5 001 à 20 000 km : d × b + c], [au-delà de 20 000 km : d × e]. */
const FLP_BAREME_KM = [
  '3' => [0.529, 0.316, 1065, 0.370],
  '4' => [0.606, 0.340, 1330, 0.407],
  '5' => [0.636, 0.357, 1395, 0.427],
  '6' => [0.665, 0.374, 1457, 0.447],
  '7' => [0.697, 0.394, 1515, 0.470],
];
