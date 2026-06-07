# Epic 22 — Commentaires sur les grooves

## Objectif

Permettre aux musiciens de laisser des commentaires horodatés sur un groove, visibles de tous les membres du groupe. Un commentaire est ancré à une position temporelle et s'affiche comme un marqueur (triangle + ligne pointillée) traversant toutes les pistes simultanément.

## Dépendances

- Epic 04 complet (transport + tête de lecture — la position du playhead sert de point d'ancrage)
- Epic 17 recommandé (marker band — partage la zone de timeline)
- Comptes individuels dans `.auth` (un login par musicien — géré hors implémentation)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Ancrage | Position temporelle unique (pas de région start/end) |
| Portée | Toutes les pistes simultanément |
| Stockage | `comments.json` à la racine du projet (hors `grooves/`, pour éviter l'écrasement FTP) |
| Format | JSON — pas de base de données, pas de SQLite |
| Concurrence | Pas de gestion transactionnelle (usage non transactionnel) |
| Auteur | `logon_user` (HTTP Basic Auth) — gestion des comptes hors scope |
| Partage | Commentaires partagés entre tous les membres, auteur affiché |
| Cycle de vie | Édition/suppression par l'auteur uniquement |
| Fils de réponse | Fil plat — n'importe quel membre peut répondre, pas de nested replies |
| Création | Bouton dédié dans le transport → modal → position = playhead courant |
| Affichage | Marqueur : triangle en haut + ligne pointillée verticale sur toutes les pistes |
| Masquage | Toggle dans le transport ; commentaires visibles par défaut |
| Popover | Clic sur marqueur → seek à la position + ouverture du popover |
| Contenu du popover | Initiales auteur, position musicale (mm:ss), texte, date, fil de réponses, modifier/supprimer (auteur) |
| "Déjà ouvert" | Animation discrète au chargement pour les commentaires déjà consultés (localStorage) |
| Badge transport | Icône bulle + compteur total ; couleur distincte si commentaires non vus |
| Badge index | Badge identique sur la liste des grooves ; couleur distincte pour non-vus |
| Non-vus | Suivi via localStorage (par utilisateur, par machine) |
| Mobile | Dégradé gracieux — pas d'optimisation spécifique |

---

## Structure des données

### `comments.json` (racine)

```json
{
  "nom-du-groove": [
    {
      "id": "uuid-v4",
      "position": 92.4,
      "author": "alain",
      "text": "La basse déraille à cet endroit",
      "createdAt": "2026-06-07T14:00:00Z",
      "updatedAt": "2026-06-07T14:00:00Z",
      "replies": [
        {
          "id": "uuid-v4",
          "author": "marc",
          "text": "Oui, à reprendre en session",
          "createdAt": "2026-06-07T15:30:00Z"
        }
      ]
    }
  ]
}
```

### localStorage (par navigateur)

```json
{
  "groovotheque:seen_comments": ["uuid-1", "uuid-2"]
}
```

---

## API REST

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/comments/:groove` | Liste des commentaires du groove |
| POST | `/api/comments/:groove` | Crée un commentaire (body : `{ position, text }`) |
| PUT | `/api/comments/:groove/:id` | Modifie le texte (auteur uniquement) |
| DELETE | `/api/comments/:groove/:id` | Supprime (auteur uniquement) |
| POST | `/api/comments/:groove/:id/replies` | Ajoute une réponse (body : `{ text }`) |

---

## Stories

### 22.1 — Persistance serveur

Créer et maintenir `comments.json` à la racine.

- Lecture/écriture via helpers `readComments()` / `writeComments()` (lecture du fichier complet, modification en mémoire, réécriture)
- Implémenter les 5 endpoints REST listés ci-dessus
- Vérification auteur côté serveur sur PUT / DELETE (compare `logon_user` avec `comment.author`)
- Générer les IDs côté serveur (`crypto.randomUUID()`)

### 22.2 — Affichage des marqueurs sur les waveforms

Afficher les commentaires comme marqueurs visuels traversant toutes les pistes.

- Un marqueur = triangle SVG en haut de la zone waveform + ligne pointillée verticale
- La position horizontale est calculée en fonction de `position` (secondes) et de la durée totale
- Les marqueurs scrollent solidairement avec les waveforms (compatible epic 18 zoom horizontal)
- Les marqueurs se mettent à jour à chaque changement de groove

### 22.3 — Toggle masquer/afficher

Ajouter un bouton icône dans le transport (bulle de commentaire).

- Clic → toggle `commentsVisible` (état local)
- Quand masqués : marqueurs et popovers cachés
- Visible par défaut au chargement

### 22.4 — Badge compteur (transport + index)

- **Transport** : badge numérique sur le bouton toggle indiquant le total de commentaires du groove
- **Index** : badge sur chaque titre dans la liste des grooves
- Couleur normale (ex. gris/blanc) si tous les commentaires ont été vus
- Couleur distincte (ex. jaune/orange) si au moins un commentaire non vu
- "Non vu" = ID absent de `groovotheque:seen_comments` dans localStorage

### 22.5 — Popover commentaire

Au clic sur un marqueur :

1. Le player seek à la position du commentaire
2. Un popover s'ouvre ancré au marqueur, contenant :
   - Initiales + nom de l'auteur
   - Position musicale (format `mm:ss`)
   - Texte du commentaire
   - Date de création
   - Fil de réponses flat (initiales, texte, date)
   - Champ "Répondre" avec bouton Envoyer
   - Boutons Modifier / Supprimer si `logon_user === comment.author`
3. L'ID du commentaire est ajouté à `groovotheque:seen_comments` dans localStorage
4. Le popover se ferme au clic en dehors

### 22.6 — Modal de création

Ajouter un bouton "+" (ou icône bulle+) dans le transport.

- Clic → capture la position courante du playhead
- Ouvre une modal avec :
  - Affichage de la position capturée (lecture seule, format `mm:ss`)
  - Champ texte pour le commentaire (obligatoire)
  - Bouton Annuler / Envoyer
- Validation → POST `/api/comments/:groove` → marqueur ajouté sans rechargement

### 22.7 — Animation "déjà consulté"

Au chargement d'un groove :

- Comparer les IDs des commentaires avec `groovotheque:seen_comments`
- Les commentaires présents dans localStorage reçoivent une animation discrète (ex. pulse ou fade-in léger)
- Les commentaires non vus apparaissent sans animation (ou avec une animation plus visible)

---

## Non-inclus

- Résolution/archivage des commentaires
- Notifications push ou email
- Commentaires privés par utilisateur
- Gestion des comptes (hors scope, géré dans `.auth` manuellement)
- Pagination (nombre de commentaires faible attendu)
