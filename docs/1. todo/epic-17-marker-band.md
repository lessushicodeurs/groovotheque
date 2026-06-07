# Epic 17 — Bande de marqueurs structurels

## Objectif

Ajouter une bande de marqueurs au-dessus des pistes permettant d'annoter la structure d'un morceau (intro, couplet, refrain, bridge…). Chaque marqueur est une région nommée (début + fin + label). Cliquer sur une région définit le cycle (IN/OUT). Les boutons `|<<` et `>>|` deviennent des navigateurs de régions.

## Dépendances

- Epic 04 complet (transport + loop region IN/OUT)
- Epic 11 complet (sauvegarde du mix côté serveur)

---

## Stories

### 17.1 — Lane de marqueurs (visuel)

Ajouter une lane horizontale dédiée entre la timeline (piste 0) et la première piste audio.

- Hauteur fixe (ex. 28–32 px), fond neutre distinct des waveforms
- La lane s'étend sur toute la largeur de la zone waveform (alignée pixel-perfect avec les pistes)
- Chaque marqueur s'affiche comme un rectangle couvrant sa durée, sans couleur propre (fond neutre légèrement teinté), avec son label
- La région sélectionnée (= cycle actif) est mise en surbrillance (fond plus marqué, bordures visibles)
- La lane est scrollable horizontalement avec les pistes (pas de position fixe)

### 17.2 — Création d'une région par drag

- Cliquer-glisser sur la lane crée une nouvelle région
- Les régions sont **mutuellement exclusives** : si le drag chevauche une région existante, la création est bloquée ou tronquée à la borne de la région voisine
- La région est créée sans label par défaut
- Immédiatement après le drag, le champ label s'ouvre en édition (double-clic automatique)
- Sur mobile (touch) : **pas de création par drag** — la lane est en lecture seule

### 17.3 — Édition d'une région

- **Double-clic** sur une région ouvre un popover inline (ou édition in-place) avec :
  - Champ texte libre pour le label
  - Autosuggestion des labels déjà utilisés dans ce groove (liste filtrée en temps réel)
  - Bouton supprimer (×) la région
- **Drag du corps** de la région : déplace la région (maintien de sa durée, bloqué par les voisines)
- **Drag des bords** de la région : redimensionne début ou fin (bloqué par les voisines)
- Sur mobile : pas de drag ni de double-clic — tap uniquement pour set le cycle

### 17.4 — Label et affichage

- Le label est affiché centré horizontalement dans la région
- Si la région est trop étroite pour afficher le label complet : **troncature avec ellipsis** (`Couplet…`)
- **Tooltip au hover** affichant toujours le label complet, quelle que soit la largeur de la région
- Police petite (ex. 11px), texte en majuscules ou small-caps pour une lecture rapide

### 17.5 — Click sur une région = set du cycle

- Cliquer sur une région définit les valeurs IN et OUT du cycle aux bornes de la région
- La région cliquée passe en surbrillance (remplace la surbrillance précédente s'il y en avait une)
- Les champs IN / OUT du transport se mettent à jour
- Si la boucle est active, elle reboucle immédiatement sur la nouvelle région
- La surbrillance ne suit **pas** la tête de lecture pendant la lecture : seule la région explicitement cliquée est en surbrillance

### 17.6 — Navigation `|<<` et `>>|`

Les boutons de navigation changent de comportement en présence de marqueurs :

| Situation | `|<<` | `>>|` |
|---|---|---|
| Il existe une région précédente | Saute au début de la région précédente | — |
| Il existe une région suivante | — | Saute au début de la région suivante |
| Pas de région précédente | Comportement actuel : début du morceau (position 0) | — |
| Pas de région suivante | — | Comportement actuel : fin du morceau |
| Aucun marqueur présent | Comportement actuel inchangé | Comportement actuel inchangé |

- La navigation déplace uniquement la tête de lecture — elle **ne set pas le cycle**
- "Région précédente/suivante" est définie par rapport à la position courante de la tête de lecture

### 17.7 — Persistance côté serveur

- Les marqueurs sont sauvegardés avec le mix (même endpoint, même fichier JSON par groove)
- Structure de données : tableau de régions `{ id, start, end, label }` (temps en secondes, float)
- Les marqueurs sont chargés au démarrage du player avec le reste du mix
- La sauvegarde est déclenchée par le bouton "Sauvegarder le mix" existant (pas d'auto-save)

---

## Critères d'acceptance

- La lane de marqueurs s'affiche correctement au-dessus des pistes, alignée avec la timeline
- On peut créer une région par drag ; elle ne chevauche pas une région existante
- Double-clic ouvre l'édition du label ; l'autosuggestion propose les labels déjà utilisés dans le groove
- On peut déplacer et redimensionner une région par drag de son corps / de ses bords
- On peut supprimer une région depuis le popover d'édition
- Cliquer une région met à jour IN/OUT et la met en surbrillance
- `|<<` et `>>|` naviguent entre régions ; aux bornes, le comportement actuel est préservé
- Sur mobile, la lane est visible et le tap set le cycle ; aucune création ni édition possible
- Le label tronqué affiche un tooltip au hover avec le label complet
- Les marqueurs sont sauvegardés et rechargés avec le mix
