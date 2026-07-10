# Epic 36 — Tags sur les grooves

## Objectif

Permettre de poser des tags libres sur les grooves pour combler l'absence de lien entre les enregistrements : rien ne relie aujourd'hui deux takes d'un même morceau à travers les sessions de répétition. Les premiers usages visés sont le nom de morceau (`Sexy Man`) et l'état d'une take (`version de référence`, `structure ok`, `recherche d'alternatives`), mais le système reste générique : des tags à plat, sans typologie — la sémantique reste à l'usage. Les tags s'affichent sur les cartes de l'index et deviennent des filtres de recherche cumulables (ex. `#Sexy Man` + `#version de référence` → la bonne take).

## Dépendances

- *(aucune)* — quand l'epic 33 (ACL dossiers) sera livrée, les routes tags devront passer par le même `checkAccess` que les autres routes à chemin groove

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Modèle | Tags génériques à plat : un groove porte une liste libre de chaînes, aucune typologie |
| Portée | Grooves (feuilles) uniquement — pas de tags sur les containers, pas d'héritage |
| Stockage | Un fichier `tags.json` par dossier de groove (`{ "tags": [...] }`), pattern `mix.json`/`markers.json` — les tags voyagent avec le dossier au renommage/déplacement, écritures concurrentes isolées par groove |
| Droits | Lecture, pose, retrait et création ouverts à tous les utilisateurs authentifiés (le scoping fin viendra avec l'epic 33) |
| Normalisation | Aucune — le tag est stocké tel que saisi (trim des extrémités seulement) ; l'autocomplétion matche en insensible à la casse pour rabattre les variantes vers les tags existants |
| Vocabulaire | Implicite : l'ensemble des tags portés par au moins un groove ; un tag plus porté par personne disparaît — pas de gestion globale des tags |
| Édition | Dans le player uniquement (pas d'édition depuis les cartes de l'index en v1) |
| Autocomplétion (player) | Directe à la frappe dans le champ d'ajout (contexte sans ambiguïté) ; création implicite si aucun match |
| Autocomplétion (recherche) | Déclenchée par `#` et uniquement par `#` ; tout le reste est du texte libre, aucune conversion implicite texte→tag |
| Champ de recherche | Hybride : chips de tags regroupés à gauche, texte libre en partie droite ; la requête distingue structurellement `tags[]` et texte libre |
| Sémantique du filtre | Tags combinés en **ET** ; le texte libre filtre nom + chemin (comme aujourd'hui) à l'intérieur de la sélection par tags ; s'applique sur la liste plate de tous les grooves, à travers les dossiers |
| Style des chips | Hashtag, coins légèrement arrondis, couleur de fond unique commune à tous les tags, croix de suppression — même langage visuel partout (recherche, cartes, player) |
| Cartes de l'index | Chips sous le nom, cliquables pour s'ajouter au filtre ; bouton `…` pour déplier la liste complète |
| Clic sur un tag dans le player | Ouvre l'index filtré sur ce tag |
| URL | L'état de recherche est porté dans l'URL de l'index (`?tags=...&q=...`) — partageable, compatible retour arrière |

---

## Stories

### 36.1 — Stockage et API par groove

Persister les tags d'un groove dans son dossier et exposer les routes de lecture/écriture.

- Fichier `tags.json` à la racine du dossier groove : `{ "tags": ["Sexy Man", "version de référence"] }`
- `GET /api/tags/*` : renvoie `{ tags: [...] }`, `{ tags: [] }` si le fichier est absent
- `POST /api/tags/*` : remplace la liste complète (`{ tags: [...] }`) — pas de gating admin, tout utilisateur authentifié peut écrire
- Validation à l'écriture : trim de chaque tag, rejet des chaînes vides, dédoublonnage exact
- Sécurisation par `resolveGrooveDir()` (path traversal) ; routes déclarées avant `/api/grooves/*`
- Le zip de téléchargement (`/api/grooves/*/download`) n'embarque pas `tags.json`

### 36.2 — Endpoint résumé pour l'index

Fournir en une requête les tags de tous les grooves, pour l'affichage des cartes, le filtrage et l'autocomplétion.

- `GET /api/tags-summary` : renvoie `{ "<groovePath>": ["tag1", "tag2"], ... }` (seuls les grooves ayant au moins un tag apparaissent)
- Construit en parcourant l'arborescence comme `collectGrooves()` et en lisant les `tags.json` rencontrés
- Le vocabulaire global (pour les autocomplétions) se dérive côté client : union des valeurs du résumé
- Calqué sur le pattern `GET /api/comments-summary`

### 36.3 — Édition des tags dans le player

Afficher et éditer les tags du groove courant dans l'en-tête du player.

- Chips sous le titre du groove, chacun avec sa croix de suppression (un clic retire le tag et sauvegarde)
- Champ discret « Ajouter un tag… » à côté des chips
- Autocomplétion à la frappe sur le vocabulaire global, matching insensible à la casse ; Entrée ou clic sur une suggestion valide ; un texte qui ne matche rien crée le tag tel que saisi (trim)
- Cliquer un tag (ailleurs que sur sa croix) ouvre `index.html?tags=<tag encodé>` — « toutes les versions de ce morceau »

### 36.4 — Chips sur les cartes de l'index

Rendre les tags visibles et actionnables depuis la grille de grooves.

- Sur chaque carte groove, chips sous le nom, alimentés par `GET /api/tags-summary` (pattern `applyCommentBadges()`)
- Couleur de fond unique commune à tous les tags, coins légèrement arrondis
- Cliquer un chip l'ajoute comme filtre actif dans la barre de recherche (sans naviguer)
- Au-delà de 3–4 tags, un bouton `…` déplie la liste complète des tags de la carte
- Les chips ne doivent pas déclencher la navigation vers le player (la carte reste un lien)

### 36.5 — Recherche hybride tags + texte libre

Transformer le champ de recherche de l'index en input hybride distinguant tags et texte libre.

- Taper `#` déclenche l'autocomplétion sur le vocabulaire global (matching insensible à la casse) ; sélectionner une suggestion transforme la saisie en chip
- Les chips sont regroupés à gauche du champ, le texte libre reste la partie droite en cours de frappe ; chaque chip a sa croix de retrait
- Filtrage côté client sur la liste plate (`GET /api/search` + `GET /api/tags-summary`) : intersection des tags (ET), puis texte libre sur `displayName` + `path` comme aujourd'hui
- Un texte tapé sans passer par `#` + sélection reste du texte libre — aucune conversion implicite
- État de recherche synchronisé dans l'URL (`index.html?tags=...&q=...`) : chargeable directement (lien partagé, clic depuis le player) et compatible retour arrière

---

## Critères d'acceptance

- [ ] Dans le player, tout utilisateur authentifié peut ajouter un tag via le champ « Ajouter un tag… » et le retirer via la croix du chip ; le fichier `tags.json` du dossier groove reflète l'état après chaque action
- [ ] L'autocomplétion du player propose les tags existants en insensible à la casse (« sexy » propose « Sexy Man ») ; valider un texte sans correspondance crée un nouveau tag tel que saisi, sans normalisation
- [ ] Renommer ou déplacer un dossier groove ne fait pas perdre ses tags
- [ ] Les cartes de l'index affichent les tags en chips (couleur de fond unique) ; au-delà de 3–4 tags, un bouton `…` déplie la liste complète
- [ ] Cliquer un chip sur une carte l'ajoute comme filtre actif dans la barre de recherche sans ouvrir le player
- [ ] Dans le champ de recherche, taper `#` déclenche l'autocomplétion des tags ; sélectionner une suggestion crée un chip regroupé à gauche, le texte libre restant à droite
- [ ] Un texte tapé sans `#` ni sélection de suggestion est traité comme texte libre, jamais converti en tag
- [ ] Avec les chips « Sexy Man » et « version de référence » actifs, seuls les grooves portant les deux tags s'affichent, tous dossiers confondus ; un texte libre ajouté affine sur nom + chemin
- [ ] Cliquer un tag dans le player ouvre l'index filtré sur ce tag
- [ ] L'URL de l'index reflète les filtres actifs (`?tags=...&q=...`) : elle est partageable et le retour arrière restaure l'état précédent
- [ ] Un tag retiré de son dernier groove disparaît des autocomplétions
- [ ] Aucune régression sur la navigation, la recherche texte existante et le player pour les grooves sans tags
