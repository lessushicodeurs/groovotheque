# Epic 16 — Navigation entre grooves (‹ ›)

## Objectif

Ajouter des boutons ‹ et › dans le header du player pour passer d'un groove au précédent/suivant par ordre alphabétique, sans repasser par la liste.

## Dépendances

- Epic 03 complet (player multipiste)

## Contexte

Le player s'ouvre via `/player.html?groove=<slug>`. L'endpoint `GET /api/grooves` retourne déjà la liste complète triée alphabétiquement (locale `fr`) avec les dossiers `~` exclus. Aucun nouvel endpoint serveur n'est nécessaire.

La navigation déclenche un rechargement de page vers la nouvelle URL — le state du player (tempo, boucle, mix) repart de zéro, comme si on ouvrait le groove depuis la liste.

## Layout cible du header

```
← [Titre du groove] ‹ ›                [Sauvegarder le mix] [↓ Tout télécharger]
```

Les boutons d'action sont ferrés à droite (`margin-left: auto` sur le premier).

## Stories

### 16.1 — Fetch de la liste et calcul des voisins

Au démarrage du player (après avoir vérifié que `grooveSlug` est valide), appeler `GET /api/grooves`. Identifier dans la réponse l'index du groove courant par correspondance sur le `slug`. Calculer :

- `prevSlug` = `grooves[index - 1].slug` si `index > 0`, sinon `null`
- `nextSlug` = `grooves[index + 1].slug` si `index < grooves.length - 1`, sinon `null`

Stocker ces deux valeurs dans des variables du module. Si le fetch échoue, les deux restent `null` (les boutons resteront désactivés sans bloquer le player).

### 16.2 — Boutons ‹ et › dans le header

Dans `player.html`, ajouter deux boutons immédiatement après `#groove-title` :

```html
<button id="btn-prev" class="nav-btn" aria-label="Groove précédent" disabled>‹</button>
<button id="btn-next" class="nav-btn" aria-label="Groove suivant" disabled>›</button>
```

Déplacer `#btn-save-mix` et `#btn-download-all` en fin de header et ajouter `margin-left: auto` sur `#btn-save-mix` pour les ferrer à droite.

### 16.3 — Activation et comportement des boutons

Dans `player.js`, une fois `prevSlug`/`nextSlug` calculés :

- `#btn-prev` : `disabled = prevSlug === null`
- `#btn-next` : `disabled = nextSlug === null`
- Clic `#btn-prev` → `location.href = '/player.html?groove=' + encodeURIComponent(prevSlug)`
- Clic `#btn-next` → `location.href = '/player.html?groove=' + encodeURIComponent(nextSlug)`

Les boutons restent `disabled` pendant le fetch initial de la liste.

### 16.4 — Style `.nav-btn`

Ajouter dans `style.css` :

- `.nav-btn` : style cohérent avec les autres boutons du header (même hauteur, fond transparent, couleur texte, padding symétrique)
- `.nav-btn:disabled` : opacité réduite (`0.35`), `cursor: default`

## Critères d'acceptance

- Sur le premier groove alphabétique, `‹` est grisé et non cliquable ; `›` est actif
- Sur le dernier groove, `›` est grisé ; `‹` est actif
- Sur un groove intermédiaire, les deux boutons sont actifs
- Clic sur `›` charge le groove suivant (page rechargée, player repart de zéro)
- Clic sur `‹` charge le groove précédent
- Les dossiers `~` ne font jamais partie de la séquence
- `[Sauvegarder le mix]` et `[↓ Tout télécharger]` restent ferrés à droite
- Si `GET /api/grooves` échoue, les deux boutons restent grisés sans erreur visible
