# Changelog

Toutes les évolutions notables de groovothèque.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage [SemVer](https://semver.org/lang/fr/). Le projet est en alpha (`0.x`) :
l'API et les formats peuvent changer d'une version à l'autre.

## [0.0.4] - 2026-09-12

### Ajouté

**Tablature Guitar Pro**

- Ouverture d'un groove ne contenant qu'un fichier Guitar Pro, dont le backing track embarqué se joue comme une piste du player (`3ee5cb4`, `bcb46cd`)
- Les pistes MIDI du fichier Guitar Pro s'affichent dans le player, distinctes des pistes audio à l'œil (`33399bc`, `3acb788`)
- La tablature mène désormais le transport : c'est elle l'horloge maître, synchronisée par l'API média d'AlphaTab (`1886f00`, `9aeabbb`)
- Défilement continu et amorti de la tablature pendant la lecture (`7372e42`)
- Cliquer une note place la tête de lecture à cet endroit (`6828c2e`)
- La barre d'espace lance et arrête la lecture (`74b2de5`)
- Plus de surface utile en mode page, hauteur du tiroir plafonnée en mode strip (`74b56e0`, `f3e95ba`)
- Le fichier Guitar Pro est inclus dans le zip téléchargé du groove (`9fa0bdf`)

**Rendu audio des pistes MIDI**

- Les pistes MIDI deviennent des pistes audio du player, rendues d'office à l'ouverture du groove (`19ca15f`, `0612bfe`)
- Les grooves sans aucune piste audio voient eux aussi leurs pistes MIDI rendues (`1e70e76`)
- Les rendus sont conservés dans le cache et écrits dans le dossier du groove (`7b5f160`, `c041a09`)
- Le soundfont est paramétrable, `MuseScore_General` par défaut (`c737e14`)

**Zoom horizontal de la zone waveform**

- Zoom jusqu'au palier 32×, piloté par des boutons loupe avec indicateur de niveau (`9ae13c3`, `00bd26c`, `0a727e4`, `8207093`)
- Le zoom s'ancre sur la tête de lecture et la vue suit automatiquement pendant la lecture (`e2b4338`, `eeb39c1`)
- Scrollbar horizontale sous la waveform et repositionnement précis au clic en vue zoomée (`a05ba87`, `71e21c8`)
- La règle temporelle s'adapte au niveau de grossissement (`47fd380`)

**Repères musicaux**

- Timecode et timeline exprimés en mesures et temps (BBT) (`b8ba738`)
- Boucles définies en coordonnées musicales plutôt qu'en secondes (`b3517e1`)
- Le BPM détecté est écrit dans la fiche `notes.md` du groove (`c162c5a`)

**Outillage**

- Runner de migrations de données pour faire évoluer les fichiers des grooves (`6adc24c`)

### Corrigé

- Le calage des pistes au déplacement de la tête de lecture devient fiable : une copie recalable des pistes MP3 et du backing est gardée en cache (`5ccc763`, `8bc1f6a`)
- Une piste MIDI partageant son canal avec une autre est correctement isolée, et le métronome ne fuit plus dans son rendu (`22f133f`, `9767420`)
- Le rendu MIDI n'écrête plus : il sort à −6 dB et les samples stéréo du soundfont sont convertis en mono à l'installation (`ab1325d`, `39a9d1d`, `809e6b1`)
- Le menu d'export est utilisable sur mobile (`53bea47`)
- Le zip du groove ne contient plus de doublons de nom (`2bab464`)
- La barre de transport reste ferrée en bas de la fenêtre, sa première ligne se replie au lieu de déborder (`9e7fc2b`, `32e606d`)
- Le solo se comporte pareil sur les pistes MIDI et les pistes audio ; les pistes MIDI sont alignées et le backing a sa propre couleur (`6ed7c11`, `7c35166`)
- Le player sort de l'état « chargement » même quand la tablature échoue à s'ouvrir (`03a291b`)
- Le mix sauvegardé tient compte des pistes rendues (`43580b7`)
- Les rendus périmés sont purgés et un rendu muet n'est plus mis en cache (`1db05a5`, `1cce433`)
- Une boucle en mesures inutilisable est signalée au lieu d'échouer en silence (`1924033`)
- Les migrations ne s'arrêtent plus sur un renommage en échec et s'appuient sur les données réelles (`e030420`, `8a3064a`)
- Mise à jour des dépendances : quatre vulnérabilités corrigées (`5ce71fb`)

### Documentation

- Le cache et les copies recalables des pistes sont décrits dans le README (`36e3d37`)
- Décision d'architecture consignée sur le calage des pistes au seek et ses mesures (`7c8bb74`)
- Les valeurs possibles de `soundFont` sont documentées dans le fichier de configuration d'exemple (`04f3a77`)
- La fuite du métronome dans le rendu MIDI est documentée, faute de contournement (`49db327`)

### Divers

- `process-rehearsal.yaml` devient une configuration locale, non versionnée (`0455481`)
- Les scripts de déploiement portant un hôte SSH personnel sont tous ignorés par git (`0145da0`)

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
