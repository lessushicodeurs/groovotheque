# Epic 18 — Zoom horizontal des waveforms

## Objectif

Permettre à l'utilisateur d'agrandir horizontalement la zone waveform via deux boutons + / -, afin d'inspecter et positionner la tête de lecture avec plus de précision — notamment pour placer finement les bornes de marqueurs (epic 17).

## Dépendances

- Epic 04 complet (transport + tête de lecture)
- Epic 17 recommandé (les marqueurs sont le cas d'usage principal du zoom)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Interaction | Boutons + / - discrets (pas de molette ni pinch) |
| Ancrage du zoom | Tête de lecture (reste centrée à l'écran) |
| Niveaux | Discrets par doublement : 1×, 2×, 4×, 8×, 16× |
| Zoom maximum | 16× |
| Emplacement des boutons | Deuxième ligne du transport (où il y a de la place) |
| Indicateur de niveau | Affiché entre les boutons (ex. `2×`), cliquable pour reset à 1× |
| Navigation en mode zoomé | Auto-scroll pendant la lecture + scroll manuel (swipe/trackpad) |
| Retour à 1× | La tête de lecture reste visible (pas de saut au début) |
| Timeline + marker band | Scrollent solidairement avec les waveforms |
| Clic sur waveform zoomée | Positionne la tête à l'endroit exact (calcul px → s intègre zoom + offset) |
| Mobile | Disponible — boutons + / - + scroll par swipe |
| Persistance | Session uniquement — reset à 1× au changement de groove ou rechargement |
| Scrollbar horizontale | Affichée sous les pistes quand zoom > 1× |

---

## Stories

### 18.1 — État de zoom et calcul de la largeur

Introduire un état `zoomLevel` (valeur parmi `[1, 2, 4, 8, 16]`) dans le store du player.

- La largeur effective de la zone waveform = `containerWidth × zoomLevel`
- Le rendu de chaque piste (canvas ou SVG) utilise cette largeur effective
- La timeline (piste 0) et la marker band (epic 17) utilisent la même largeur effective
- À `zoomLevel = 1`, comportement identique à l'actuel

### 18.2 — Boutons + / - et indicateur de niveau

Ajouter dans la deuxième ligne du transport :

- Bouton **−** : diminue `zoomLevel` d'un palier (désactivé à 1×)
- Indicateur **`N×`** : affiche le niveau courant ; un clic reset à 1×
- Bouton **+** : augmente `zoomLevel` d'un palier (désactivé à 16×)

### 18.3 — Scroll solidaire

- La zone waveform devient scrollable horizontalement quand `zoomLevel > 1`
- Timeline, marker band et toutes les pistes audio partagent le même conteneur scrollable (scroll solidaire)
- Sur desktop : scroll via trackpad deux doigts ou molette + Shift
- Sur mobile : scroll par swipe horizontal

### 18.4 — Ancrage sur la tête de lecture

- Lors d'un changement de `zoomLevel`, la vue se réajuste pour que la tête de lecture reste centrée à l'écran
- Si la tête est proche du début ou de la fin, le scroll est contraint aux bornes (pas de zone vide)
- Au reset à 1× (clic sur l'indicateur), la tête de lecture reste visible sans saut brutal

### 18.5 — Auto-scroll pendant la lecture

- Pendant la lecture en mode zoomé, la vue défile automatiquement pour que la tête de lecture reste visible
- L'auto-scroll est interrompu si l'utilisateur scrolle manuellement (il reprend si l'utilisateur re-clique Play ou clique sur la tête)
- Comportement identique sur desktop et mobile

### 18.6 — Clic sur waveform pour repositionnement précis

- Le calcul de conversion `px → secondes` au clic intègre `zoomLevel` et l'offset de scroll courant
- Le repositionnement fonctionne sur toutes les pistes audio, la timeline et (quand implémentée) la marker band
- C'est le cas d'usage principal du zoom : placement précis de la tête de lecture

### 18.7 — Scrollbar horizontale

- Une scrollbar horizontale fine s'affiche sous la zone waveform quand `zoomLevel > 1`
- Elle indique la portion visible du morceau et permet le drag pour naviguer
- Elle disparaît à `zoomLevel = 1` (inutile et encombrante)
- Sur mobile, la scrollbar est visible mais non draggable (navigation par swipe uniquement)

---

## Critères d'acceptance

- Les boutons + / - sur la deuxième ligne du transport changent le niveau de zoom par paliers (1× → 2× → 4× → 8× → 16×)
- Le bouton − est désactivé à 1×, le bouton + est désactivé à 16×
- L'indicateur entre les boutons affiche le niveau courant ; un clic reset à 1×
- Au zoom, la tête de lecture reste centrée à l'écran (ou aussi proche que les bornes le permettent)
- Timeline, marker band et pistes audio scrollent ensemble (alignement pixel-perfect conservé)
- Pendant la lecture en mode zoomé, la vue suit automatiquement la tête de lecture
- Un clic sur une waveform zoomée positionne la tête à l'endroit exact cliqué
- Une scrollbar horizontale s'affiche sous les pistes quand `zoomLevel > 1`, disparaît à 1×
- Le comportement est identique sur desktop et mobile
- Le zoom se remet à 1× au changement de groove ou au rechargement de la page
