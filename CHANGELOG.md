# Changelog

Toutes les évolutions notables de groovothèque.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage [SemVer](https://semver.org/lang/fr/). Le projet est en alpha (`0.x`) :
l'API et les formats peuvent changer d'une version à l'autre.

## [0.0.3] - 2026-09-11

### Documentation

- Le pipeline audio exige désormais Audacity 3.x — prérequis explicité dans la documentation (`abab014`)

## [0.0.2] - 2026-09-04

### Ajouté

- Téléchargement du mix stéréo complet depuis le player, via un menu de téléchargement (`fe5dbe4`)
- Export du mix en WAV, FLAC et MP3, l'encodage se faisant en arrière-plan sans figer l'interface (`fe5dbe4`, `1b7c3f9`, `d3bd818`)

### Corrigé

- Le rendu, la mise en cache et le téléchargement du mix sont fiabilisés (`aa33f03`)
- Deux formats téléchargés à la suite portent bien le même mix (`dacc7a1`)
- Les fichiers FLAC produits ne sont plus corrompus par la réécriture de leur en-tête (`7bb9a6a`)
- Le menu de téléchargement est utilisable au clavier (`50adbeb`)

## [0.0.1] - 2026-07-11

Première version taguée. Elle récapitule l'ensemble du travail depuis le début du
projet (epics 1 à 37), le dépôt n'ayant pas été versionné jusque-là.

### Ajouté

- **Lecteur multipiste** — lecture synchronisée des pistes d'une session, transport,
  contrôle du tempo, panoramique par piste, formes d'onde mises en cache
- **Catalogue de grooves** — listing, sous-dossiers, navigation d'un groove à l'autre,
  recherche combinant tags et texte libre, chips de tags sur les cartes
- **Tags** — édition depuis le player, stockage par groove, validation côté serveur
- **Commentaires** — fil de discussion, panneau latéral sur l'index, réponses,
  suivi des messages vus, nom de rédacteur pour distinguer les membres du groupe,
  lien profond vers un commentaire précis
- **Marqueurs et structure** — bande de marqueurs, timeline détachée, export de la
  structure en Markdown et feuille de style d'impression
- **Tablatures** — affichage via AlphaTab
- **Import de répétitions** — découpage automatique des enregistrements, détection
  du tempo, normalisation du volume, chaîne d'effets et compression via Audacity
- **Mix** — sauvegarde du mix d'une session, mix de secours quand la session n'en a pas
- **Téléchargement** des pistes d'un groove
- **Interface responsive** et déploiement

### Corrigé

- Désynchronisation entre pistes lors du découpage d'une répétition (`e459da0`)
- Grooves supprimés du disque encore présents dans le fil de commentaires (`5168a66`)
- Accessibilité du tiroir de commentaires et fermeture des modales au clavier (`e6dce10`, `6c49749`)
- Divers correctifs d'affichage sur l'index et le player
