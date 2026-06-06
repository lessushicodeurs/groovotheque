# Epic 15 — Contrôle de pan par piste

## Objectif

Ajouter un knob de panoramique (gauche/droite) par piste dans la sidebar du player, sauvegardé et restauré avec le mix.

## Dépendances

- Epic 03 complet (player multipiste + sidebar par piste)
- Epic 11 complet (sauvegarde et restauration du mix)

## Contexte

Le player dispose déjà d'un contrôle de volume par piste. Le pan permet de positionner chaque instrument dans le champ stéréo, ce qui est essentiel pour un mix réaliste (ex. guitare légèrement à droite, basse centrée, clavier à gauche). Le pan est ajustable par tous les utilisateurs pour leur écoute, mais seul l'admin peut le sauvegarder via le bouton existant.

### Implémentation audio

Le pan utilise l'API Web Audio native : un `StereoPannerNode` est inséré dans la chaîne de chaque piste, entre WaveSurfer et la sortie AudioContext. La valeur va de `-1` (full gauche) à `+1` (full droite), `0` = centre.

### Format du fichier `mix.json` (nouveau)

```json
{
  "tracks": {
    "01 BASS.mp3": { "volume": 80, "pan": 0 },
    "02 GUIT.mp3": { "volume": 100, "pan": -0.4 },
    "03 LEAD.mp3": { "volume": 65, "pan": 0.3 }
  },
  "loop": {
    "in": 12.4,
    "out": 34.8
  }
}
```

Chaque entrée `tracks` passe d'un nombre (volume seul) à un objet `{ volume, pan }`. Les fichiers `mix.json` de test locaux sont supprimés — l'application n'a pas encore été déployée, aucune migration n'est nécessaire.

## Stories

### 15.1 — StereoPanner par piste

- Lors de l'initialisation de chaque piste WaveSurfer, créer un `StereoPannerNode` via l'AudioContext partagé
- Connecter la sortie WaveSurfer → StereoPannerNode → destination AudioContext
- Exposer une fonction `setPan(trackId, value)` (valeur `-1` à `+1`)
- Pan initial à `0` pour toutes les pistes

### 15.2 — Knob custom vanilla JS

Composant knob réutilisable implémenté en vanilla JS/SVG :

- **Visuel** : cercle SVG avec arc coloré indiquant la position, de 7h (full gauche) à 5h (full droite), 12h = centre
- **Interaction** :
  - Drag vertical : glisser vers le haut tourne vers la droite, vers le bas vers la gauche
  - Double-clic : reset immédiat à `0` (centre)
  - Sensibilité : 200px de drag = plage complète (-1 à +1)
- **Label** : texte sous le knob affichant `L`, `C` ou `R`
  - `L` si pan < -0.05
  - `C` si -0.05 ≤ pan ≤ 0.05
  - `R` si pan > 0.05
- Émet un événement `change` avec la valeur courante à chaque modification
- Taille : 36×36px (compact pour tenir sur la même ligne que le slider volume)

### 15.3 — Intégration dans la sidebar par piste

- Ligne "contrôles de mix" : slider volume + knob pan côte à côte (flexbox horizontal)
- Le knob est affiché pour toutes les pistes, actif pour tous les utilisateurs
- Brancher l'événement `change` du knob sur `setPan(trackId, value)`
- Conserver le slider volume existant sans modification

### 15.4 — Nouveau format mix.json

- Supprimer tous les fichiers `mix.json` présents localement dans `grooves/`
- Mettre à jour `POST /api/mix/:groove` : le corps reçu contient le nouveau format `{ volume, pan }` par piste
- Mettre à jour `GET /api/mix/:groove` : retourne le nouveau format

### 15.5 — Sauvegarde et restauration du pan

**Sauvegarde** (extension de la story 11.4) :
- Lors du clic sur "Sauvegarder le mix", collecter la valeur pan courante de chaque piste en plus du volume
- Construire le JSON avec le nouveau format et envoyer via `POST /api/mix/:groove`

**Restauration** (extension de la story 11.3) :
- Au chargement du player, après `GET /api/mix/:groove`, appliquer `setPan()` pour chaque piste dont le mix contient une valeur `pan`
- Mettre à jour la position visuelle du knob correspondant
- Piste absente du mix → pan à `0`, knob centré
- Piste du mix absente du groove → ignorée

## Critères d'acceptance

- Chaque piste affiche un knob pan à côté du slider volume
- Le drag vertical fait tourner le knob et déplace le son dans le champ stéréo en temps réel
- Le double-clic sur le knob recentre le pan à `0` et affiche `C`
- Le label L/C/R reflète la position courante du knob
- Le clic sur "Sauvegarder le mix" (admin) inclut les valeurs pan dans `mix.json`
- Au rechargement du player, les positions pan sont restaurées (knob + audio)
- Une piste sans pan dans le mix s'initialise à `0`
- Le son est audible correctement à toutes les positions, y compris les extrêmes (-1 et +1)
