# Factures — Fabrice Lau Production

Application privée de gestion des factures (PHP, sans WordPress), en ligne sur
https://fabricelauproduction.com/factures

- `factures/` : l'application. C'est **ce dossier** que la mise à jour en un clic copie sur le serveur.
- Les données (factures, réglages, sauvegardes) ne sont **jamais** dans ce dépôt :
  elles restent sur le serveur, dans `/home/<compte>/.flp-factures`, hors du site.
- `install/installer.php` : installation initiale de la v2 (usage unique, déposée via le cPanel).

Mise à jour : appli → menu ⋯ → Réglages → « Vérifier » puis « Mettre à jour ».
Une copie du code précédent est gardée à chaque mise à jour (retour arrière automatique en cas d'échec).
