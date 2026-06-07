# ADR — AlphaTab : scroll automatique pendant la lecture

## Contexte

Dans le player Groovotheque, la tablature est rendue par AlphaTab (v1.8.3). La lecture audio est assurée par WaveSurfer v7. AlphaTab est piloté en positionnant `alphaTabApi.timePosition` depuis un RAF loop synchronisé sur `wavesurfer.getCurrentTime()`.

Le problème initial : pendant la lecture, le curseur de lecture AlphaTab sort du drawer/conteneur visible sans que le scroll suive — aussi bien en mode **strip** (layout horizontal) qu'en mode **fullscreen** (layout page vertical).

---

## Piste 1 — Scroll natif AlphaTab (`scrollMode`)

### Idée
AlphaTab expose un paramètre `settings.player.scrollMode` (0=Off, 1=Continuous, 2=OffScreen, 3=Smooth) censé gérer l'autoscroll nativement, comme dans [le playground officiel](https://alphatab.net/docs/playground/).

### Pourquoi ça ne fonctionne pas dans notre architecture

Le scroll natif AlphaTab est conditionné à l'état interne du player : dans `alphaTab.core.mjs`, la fonction `shouldScroll` retourne `true` uniquement quand `this._player.state === PlayerState.Playing`.

Or, dans notre architecture, le son vient de WaveSurfer — AlphaTab n'est jamais mis en lecture via `playPause()`. Son player interne reste donc en état `Paused` en permanence. `shouldScroll` est toujours `false`, `onBeatCursorUpdating` n'est jamais appelé pour déclencher le scroll.

Cette piste est **architecturalement impossible** sans changer le mode de pilotage d'AlphaTab.

**Effet secondaire identifié :** avec `scrollMode: 3` (Smooth), AlphaTab instancie un `HorizontalSmoothScrollHandler` qui modifie le layout en ajoutant du `paddingRight` au canvas à chaque redimensionnement — source de bugs visuels.

---

## Piste 2 — `enforceTabCursorVisible()` — première version (getBoundingClientRect)

### Idée
Puisque le scroll natif est impossible, gérer le scroll manuellement dans le RAF loop : lire la position *écran* du curseur `.at-cursor-beat` via `getBoundingClientRect()`, et ajuster `scrollLeft`/`scrollTop` si le curseur s'approche d'un bord.

### Résultat
Fonctionnait techniquement, mais l'expérience était **très désagréable** : le scroll avançait par sauts brusques de ~75% du conteneur à chaque fois que le curseur touchait le bord. Le musicien devait constamment chercher où se trouvait le curseur après chaque saut. Validé par l'utilisateur comme "ça marche mais c'est très désagréable".

---

## Piste 3 — `enforceTabCursorVisible()` — version téléprompteur (solution retenue ✅)

### Idée
AlphaTab positionne son curseur via un `transform: translate(Xpx, Ypx) scale(w, h) translateX(-50%)` en coordonnées *contenu* (non affectées par `scrollLeft`). Lire `X` directement depuis ce transform permet de savoir où se trouve le curseur dans la partition, indépendamment du scroll courant.

Avec cette coordonnée contenu, maintenir le curseur à une position fixe dans le viewport (35% du bord gauche) — le contenu défile *sous* le curseur, comme un téléprompteur. Le scroll devient :

```
scrollLeft = max(0, cursorContentX − viewportWidth × 0.35)
```

Pour les seeks (déplacement large) : ease à 15%/frame pour éviter le saut brutal.

### Mode fullscreen (layout Page, vertical)
Même logique sur l'axe Y : scroll seulement quand le curseur sort de la zone 0–80% du viewport, avec cible à 25% depuis le haut.

### Résultat
Expérience fluide et agréable, validée par l'utilisateur. Le curseur reste toujours visible, la partition défile sous lui sans sauts.

---

## Piste 4 — Dual play (non explorée, recommandée pour le futur)

### Idée
Démarrer WaveSurfer ET AlphaTab simultanément au clic sur Play :
- WaveSurfer fournit le son
- AlphaTab joue avec volume 0 → son player entre en `PlayerState.Playing`
- Le scroll natif AlphaTab devient opérationnel
- Le RAF loop de sync timePosition est supprimé

Sync :
- Sur play : `wavesurfer.play()` + `alphaTabApi.playPause()` simultanément
- Sur seek : `wavesurfer.setTime(t)` + `alphaTabApi.timePosition = t` puis reprendre
- Re-sync périodique (~5s) pour corriger la dérive d'horloge

### Avantages
- Scroll natif AlphaTab, smooth et testé
- `enforceTabCursorVisible` supprimé
- Ouvre la voie à une architecture iframe : AlphaTab dans une iframe reçoit `{type:'play', atMs:X}` par postMessage et gère tout de son côté

### Risque
Dérive sur morceaux à tempo variable (tempo changes dans le fichier GP) — un re-sync plus agressif serait nécessaire.

---

## Piste 5 — AlphaTab en iframe (non explorée)

### Idée
Isoler AlphaTab dans une `<iframe>` : le parent gère WaveSurfer et envoie des messages (`play`, `pause`, `seek`, `timePosition`) à l'iframe via `postMessage`. L'iframe gère le rendu, le curseur, et le scroll nativement.

### Pré-requis
Mettre en place la piste 4 (dual play) d'abord — l'iframe ne peut fonctionner que si AlphaTab est capable de gérer son propre état de lecture.

---

## Solution en production

**Piste 3** — `enforceTabCursorVisible()` en mode téléprompteur, appelée chaque frame RAF.

Fichier concerné : `public/js/player.js`, fonction `enforceTabCursorVisible()` et `startTabSync()`.

Tests Playwright couvrant les deux modes : `tests/tab-scroll.spec.js`.

---

## Décision future recommandée

Si on revient sur ce sujet, commencer par la **piste 4** (dual play). Elle résout le problème proprement et rend la piste 5 (iframe) accessible. Le coût est faible : remplacer le RAF sync par des handlers d'événements WaveSurfer (`play`, `pause`, `seek`, `timeupdate`).
