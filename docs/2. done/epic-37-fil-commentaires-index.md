# Epic 37 — Fil de commentaires sur l'index

## Objectif

Les commentaires ne sont visibles aujourd'hui qu'en descendant jusqu'au player du morceau concerné (badge par carte au niveau de dossier courant). Les commentaires non lus passent donc inaperçus tant qu'on ne navigue pas jusqu'au bon titre. Cette epic fait remonter toute l'activité de commentaires dès l'index, dans un panneau latéral en fil de discussion, avec mise en évidence des non-lus et lien direct vers le passage audio concerné. Elle ajoute aussi un nom de rédacteur pour distinguer les membres du groupe qui partagent le compte `musicien`.

## Dépendances

- Epic 22 complet (commentaires ancrés sur timestamp)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Forme | Tiroir latéral droit en overlay, ouvert par un bouton 💬 dans l'en-tête de l'index |
| Compteur | Le bouton 💬 porte le nombre de discussions non lues (visible sans ouvrir le panneau) |
| Portée | Index uniquement (pas de fil sur la page player dans cette itération) |
| Contenu | Fil d'activité de toute la bibliothèque (pas seulement les non-lus) |
| Entrée du fil | Une entrée = une discussion (commentaire racine + ses réponses), repliée par défaut |
| Tri | Par dernière activité (`updatedAt`) — une nouvelle réponse remonte la discussion en tête |
| Non-lu | Une discussion est non lue si le commentaire racine **ou** une réponse n'est pas dans les IDs vus ; mise en évidence visuelle (gras / marqueur) |
| État « lu » | localStorage (`groovotheque:seen_comments`), étendu pour tracer aussi les IDs des réponses — pas d'état de lecture côté serveur (compte partagé : un état serveur par compte marquerait « lu » pour tout le groupe) |
| Dépliage | Clic sur l'entrée → déplie le fil sur place et marque toute la discussion lue |
| Navigation | Clic sur le nom du morceau / bouton ▶ → lien profond `player.html?groove=...&comment=<id>` : seek sur la position du commentaire + popover ouvert |
| Actions | Bouton « Tout marquer comme lu » en tête de panneau ; pas de réponse depuis le panneau (on répond dans le player, le passage sous les oreilles) |
| Nom de rédacteur | Clé localStorage (`groovotheque:author_name`), demandée à la première rédaction (commentaire ou réponse), envoyée au serveur comme `authorName` |
| Affichage du nom | `authorName` en priorité partout (panneau, popover, initiales), repli sur `author` (nom de compte) pour l'existant |
| Modification du nom | Depuis le modal de rédaction (« signé Alain · modifier ») |
| Permissions Éditer/Supprimer | Boutons affichés seulement si `authorName` correspond au nom local (garde-fou d'ergonomie, pas de sécurité serveur) ; l'admin garde tous les droits |
| Admin | Inclus dans le mécanisme de nom de rédacteur (mêmes règles) |
| Reporté | Badges agrégés de non-lus sur les dossiers, fil sur la page player, réponse depuis le panneau |

---

## Stories

### 37.1 — Endpoint de fil enrichi

Le résumé actuel (`GET /api/comments-summary`) ne renvoie que compteurs et IDs. Le panneau a besoin du contenu complet.

- Nouvelle route `GET /api/comments-feed` : toutes les discussions de la bibliothèque avec `groovePath`, nom d'affichage du morceau, commentaire racine complet et réponses
- Tri serveur par dernière activité descendante (`updatedAt`)
- Réutiliser le store existant (`cache/comments.json`), lecture seule

### 37.2 — Suivi « vu » étendu aux réponses

Aujourd'hui seuls les IDs des commentaires racines sont tracés : une réponse postée après lecture du commentaire est invisible.

- Les IDs des réponses entrent dans le set `groovotheque:seen_comments`
- Dans le player, l'ouverture du popover marque aussi comme vues les réponses affichées
- Le badge de carte de l'index et le badge du player intègrent les réponses non vues dans leur état `--unseen`
- La création d'un commentaire ou d'une réponse marque immédiatement son propre ID comme vu

### 37.3 — Panneau latéral et fil de discussions

- Bouton 💬 dans l'en-tête de l'index avec compteur de discussions non lues (masqué à zéro)
- Clic → tiroir en overlay depuis la droite (pleine hauteur, adapté mobile) ; fermeture par bouton ✕, clic hors panneau ou Échap
- Chaque entrée repliée affiche : nom du rédacteur, extrait du texte, nom du morceau, position (mm:ss), date relative, nombre de réponses
- Les discussions non lues sont mises en évidence (graisse + point de couleur)
- Clic sur l'entrée → déplie le fil complet (racine + réponses) sur place et marque la discussion lue
- Bouton « Tout marquer comme lu » en tête de panneau

### 37.4 — Lien profond vers le player

- Dans chaque entrée du fil, le nom du morceau (ou un bouton ▶) ouvre `player.html?groove=<path>&comment=<id>`
- Au chargement, le player interprète le paramètre `comment` : seek à la position du commentaire et ouverture de son popover (ce qui le marque lu)
- Paramètre `comment` inconnu ou supprimé entre-temps : le player s'ouvre normalement, sans erreur

### 37.5 — Nom de rédacteur

- À la première rédaction (commentaire ou réponse), si `groovotheque:author_name` est absent, le modal demande le prénom avant l'envoi, puis le stocke
- Le nom courant s'affiche dans le modal (« signé Alain · modifier ») et reste modifiable
- `POST /api/comments/*` et `POST .../replies` acceptent et stockent un champ `authorName`
- Affichage partout (panneau, popover, initiales) : `authorName` en priorité, repli sur `author`
- Boutons Éditer/Supprimer du popover : affichés si le `authorName` du commentaire correspond au nom local (et compte identique) ; l'admin voit toujours tout

---

## Critères d'acceptance

- Un bouton 💬 dans l'en-tête de l'index affiche le nombre de discussions non lues de toute la bibliothèque, sans avoir à naviguer dans les dossiers
- Le clic sur le bouton ouvre un tiroir latéral droit listant toutes les discussions, triées par dernière activité descendante
- Une réponse postée sur une vieille discussion fait remonter celle-ci en tête du fil et la marque non lue
- Les discussions non lues sont visuellement distinctes des discussions lues
- Cliquer sur une entrée déplie la discussion (racine + réponses) sur place et la marque lue ; le compteur du bouton 💬 décroît
- « Tout marquer comme lu » remet le compteur à zéro et retire toutes les mises en évidence
- Cliquer sur le nom du morceau d'une entrée ouvre le player positionné sur le timestamp du commentaire, popover ouvert
- Une réponse ajoutée après lecture du commentaire racine rend la discussion non lue à nouveau (index et player)
- À la première rédaction d'un commentaire ou d'une réponse, le prénom est demandé puis mémorisé ; il n'est plus jamais demandé ensuite mais reste modifiable depuis le modal
- Les commentaires s'affichent partout avec le nom de rédacteur ; les commentaires antérieurs à l'epic affichent le nom de compte
- Les boutons Éditer/Supprimer n'apparaissent que sur ses propres commentaires (même nom de rédacteur) ; l'admin les voit sur tous
- L'état « lu » reste propre à chaque navigateur (deux membres sur le même compte ont chacun leurs non-lus)
- Le comportement est identique sur desktop et mobile

---

*Conception issue de la session grill-me du 2026-07-06.*
