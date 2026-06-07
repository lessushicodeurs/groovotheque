# ADR — Sync audio / tablature AlphaTab

## Situation validée (juin 2026)

La sync entre l'audio WaveSurfer et le curseur AlphaTab est correcte dans tous les cas testés :
- Lecture depuis le début → sync parfaite du début à la fin
- Seek à une position arbitraire → sync correcte immédiatement
- Loop sur un point quelconque → sync correcte à chaque tour

---

## Comment ça marche

### Architecture

WaveSurfer joue l'audio. AlphaTab affiche la partition et le curseur, mais n'est **jamais mis en lecture** (`playPause()` n'est jamais appelé). AlphaTab est piloté exclusivement via `alphaTabApi.timePosition` (en ms, dans l'horloge synth du score).

### Boucle de sync (RAF)

`startTabSync()` lance une boucle `requestAnimationFrame` qui tourne en continu quand la tab est visible :

```javascript
const audioMs = wavesurfers[0].getCurrentTime() * 1000
alphaTabApi.timePosition = audioTimeToSynthTime(audioMs)
```

Cette boucle est la source de vérité pendant la lecture. Elle tourne à ~60fps et maintient le curseur en sync permanente avec l'audio.

### Conversion audio ↔ synth (`audioTimeToSynthTime`)

L'horloge WaveSurfer (ms audio) et l'horloge AlphaTab (ms synth au tempo du score) ne sont pas identiques. La conversion utilise des **BackingTrackSyncPoints** extraits du fichier GP par `MidiFileGenerator.generateSyncPoints(score)` : interpolation linéaire par morceaux entre des ancres `{syncTime (ms audio) → synthTime (ms synth)}`.

Si le fichier GP ne contient pas de sync points, le fallback est `audioMs = synthMs` (ratio 1:1, valide si le tempo de l'enregistrement correspond à celui du score).

### Sync au seek

Avant ce fix, après un seek WaveSurfer (clic sur la waveform ou loop), la boucle RAF lisait `getCurrentTime()` qui peut retourner 0 quand le player est pausé dans certaines implémentations WaveSurfer/WebAudio — le curseur ne bougeait pas.

Fix : `seekAllTo(time)` et le handler `interaction` mettent à jour `alphaTabApi.timePosition` **directement** au moment du seek, sans attendre le prochain tick RAF :

```javascript
function seekAllTo(time) {
  wavesurfers.forEach(ws => ws.setTime(time))
  if (alphaTabApi && tabState !== 'collapsed') {
    alphaTabApi.timePosition = audioTimeToSynthTime(time * 1000)  // immédiat
  }
}
```

---

## Cas particulier : intro longue à tempo libre

Pour "The Clark Sisters - Ha Ya", la première mesure est une intro de ~17 secondes sans tempo fixe, notée comme une unique mesure lente plutôt que plusieurs mesures à un tempo approché (choix musical délibéré).

Les sync points reflètent cela fidèlement : `audioMs=17970 → synthMs=2998` (ratio local ~0.167). Ce n'est pas un bug. L'intro audio dure ~17s pour ~3s de synth time.

**Conséquence pratique pour les loop points :**
Placer un loop in à l'oreille sur une waveform introduit une erreur systématique de ~400-500ms (latence audio ≈ 150ms + temps de réaction humain ≈ 300ms). Le curseur montre le bon endroit dans la partition, mais ce n'est pas forcément le temps musical que l'utilisateur visait.

→ Pour un loop précis sur un temps de mesure, utiliser les **beat-clicks sur la tablature** (feature 13.6) : un clic sur une note snap exactement sur le tick MIDI correspondant, sans latence ni imprécision humaine.

---

## Comment tester que la sync ne régresse pas

### Test automatisé (Playwright)

`tests/tab-scroll.spec.js` vérifie que `scrollLeft` augmente proportionnellement à `timePosition` — ce qui implique indirectement que le cursor suit la progression audio. Lancer avec :

```bash
./scripts/test-scroll.sh
# ou
npx playwright test tests/tab-scroll.spec.js
```

### Test manuel (protocole)

1. **Depuis le début** : lancer la lecture depuis t=0, observer que le curseur reste sur la note jouée pendant toute la durée de la pièce
2. **Seek arbitraire** : cliquer à un endroit quelconque de la waveform pendant la lecture, vérifier que le curseur saute à la bonne position immédiatement
3. **Loop** : créer un loop via beat-click sur une note dans la tab, activer le loop, vérifier que le curseur revient bien au bon endroit à chaque cycle
4. **Régression scroll** : vérifier que le curseur reste toujours visible (ne sort pas du drawer) en mode strip et fullscreen pendant une lecture longue

### Signaux d'alerte

Si la sync se dégrade, chercher en priorité :
- Un changement dans le comportement de `wavesurfers[0].getCurrentTime()` après un seek (bug WaveSurfer)
- La suppression ou la corruption du `seekAllTo` → `alphaTabApi.timePosition` immédiat
- Un re-render AlphaTab qui remet `scrollLeft` à 0 mais pas `timePosition` (le curseur est au bon endroit mais pas visible)
- Un changement dans le format des sync points retournés par `MidiFileGenerator.generateSyncPoints`

---

## Fichiers clés

| Fichier | Rôle |
|---|---|
| `public/js/player.js` | `startTabSync()`, `seekAllTo()`, `audioTimeToSynthTime()`, `enforceTabCursorVisible()` |
| `tests/tab-scroll.spec.js` | Tests Playwright (scroll + sync indirecte) |
| `scripts/test-scroll.sh` | Lancer les tests |
