# Epic 31 — Effets audio par piste

## Objectif

Permettre d'appliquer des effets audio (EQ, compression, reverb, délai) par piste directement dans le player, sans aucune dépendance externe. Les effets s'insèrent dans la chaîne Web Audio API existante, sont réglables via un panneau dédié dans la sidebar, et persistent dans le mix.json de chaque groove.

## Dépendances

- *(aucune)*

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Bibliothèque audio | Web Audio API native uniquement — pas de dépendance npm |
| Point d'insertion | Entre `GainNode` et `StereoPannerNode` dans `buildTrackRow` (player.js:838-856) |
| Chaîne d'effets | `GainNode → EQ → Compressor → Reverb → Delay → StereoPannerNode → destination` |
| EQ | 3 bandes : low shelf (80 Hz), mid peak (1 kHz), high shelf (10 kHz) via `BiquadFilterNode` |
| Reverb | Algorithmique via `ConvolverNode` avec impulse response synthétique (pas de fichier IR externe) |
| Bypass | Chaque effet a un toggle on/off — off = nœud shunté, chaîne reconnectée sans lui |
| Persistence | Extension du mix.json existant via `/api/mix/:groove` — clé `effects` par piste |
| UI | Panneau collapsible par piste dans la sidebar, sur le modèle des knobs volume/pan |

---

## Stories

### 31.1 — Infrastructure de la chaîne d'effets

Créer la plomberie générique pour insérer, bypass et détruire une chaîne d'effets par piste.

- Ajouter `effectChains[]` dans les structures de données du player (à côté de `gainNodes[]`, `panNodes[]`)
- Chaque `effectChain` est un objet `{ eq, compressor, reverb, delay, input, output }` où `input` et `output` sont des `GainNode` passthrough servant de points de connexion stables
- Fonction `buildEffectChain(audioCtx)` : crée tous les nœuds, les connecte en série, retourne l'objet chain
- Fonction `bypassEffect(chain, effectKey, bypassed)` : reconnecte la chaîne en sautant le nœud concerné
- Modifier `buildTrackRow` (player.js:838-856) pour insérer `chain.input → … → chain.output` entre `GainNode` et `StereoPannerNode`
- Fonction `destroyEffectChain(chain)` : déconnecte tous les nœuds (appelée sur suppression de piste)

### 31.2 — EQ 3 bandes

Implémenter l'égaliseur via trois `BiquadFilterNode` en série.

- Low shelf : `type = "lowshelf"`, `frequency = 80`, gain ∈ [-12, +12] dB
- Mid peak : `type = "peaking"`, `frequency = 1000`, `Q = 1`, gain ∈ [-12, +12] dB
- High shelf : `type = "highshelf"`, `frequency = 10000`, gain ∈ [-12, +12] dB
- Valeur 0 dB = neutre (nœud toujours présent, bypass inutile à ce stade)
- Les trois nœuds sont créés dans `buildEffectChain` et connectés `eq.low → eq.mid → eq.high`

### 31.3 — Compresseur dynamique

Implémenter la compression via `DynamicsCompressorNode`.

- Paramètres exposés : threshold (dB), ratio, attack (ms), release (ms)
- Valeurs par défaut : threshold -24 dB, ratio 4:1, attack 10 ms, release 200 ms
- Toggle bypass : lorsque bypassed, le nœud est shunté via `bypassEffect`
- État par défaut : bypassed (pas de compression silencieuse à l'insu de l'utilisateur)

### 31.4 — Reverb algorithmique

Implémenter la reverb via `ConvolverNode` avec impulse response synthétique.

- Générer l'IR par code au démarrage : bruit blanc exponentiel décroissant (fonction `buildImpulseResponse(audioCtx, duration, decay)`)
- Paramètres exposés : duration (0.1 – 4 s), decay (0.1 – 10), mix wet/dry (0 – 1) via un `GainNode` wet + `GainNode` dry en parallèle
- Toggle bypass
- État par défaut : bypassed

### 31.5 — Délai / écho

Implémenter le délai via `DelayNode` avec feedback.

- Architecture : `input → delay → feedbackGain → delay` (boucle) + `dryGain` en parallèle → `output`
- Paramètres exposés : time (0 – 2 s), feedback (0 – 0.9), mix wet/dry (0 – 1)
- Toggle bypass
- État par défaut : bypassed

### 31.6 — UI panneau d'effets par piste

Ajouter un panneau collapsible dans la sidebar de chaque piste pour contrôler les effets.

- Bouton "FX" dans l'en-tête de piste (à côté des knobs volume/pan) pour ouvrir/fermer le panneau
- Panneau structuré en sections : EQ | COMP | REVERB | DELAY
- Chaque section a un toggle on/off et ses knobs paramétriques (réutiliser le composant knob SVG existant, player.js:277-420)
- Affichage compact : panneau en overlay ou expansion en-dessous de la piste, selon rendu
- Mise à jour temps réel : chaque knob modifie directement le nœud Web Audio correspondant (`AudioParam.setTargetAtTime`)

### 31.7 — Persistence dans mix.json

Étendre la sauvegarde/restauration du mix pour inclure les paramètres d'effets.

- Étendre le format mix.json par piste :
  ```json
  {
    "volume": 80,
    "pan": 0,
    "effects": {
      "eq": { "low": 0, "mid": 0, "high": 0 },
      "compressor": { "enabled": false, "threshold": -24, "ratio": 4, "attack": 10, "release": 200 },
      "reverb": { "enabled": false, "duration": 1.5, "decay": 2, "wet": 0.3 },
      "delay": { "enabled": false, "time": 0.3, "feedback": 0.4, "wet": 0.3 }
    }
  }
  ```
- `GET /api/mix/:groove` : restaurer l'état des effets après `buildEffectChain`
- `POST /api/mix/:groove` : inclure `effects` dans le payload de sauvegarde
- Rétrocompatibilité : si `effects` absent du mix.json, appliquer les valeurs par défaut (tout bypassed, gains neutres)

---

## Critères d'acceptance

- [ ] Une piste sans effets activés sonne identiquement à avant l'epic (chaîne neutre transparente)
- [ ] Le bouton "FX" ouvre/ferme le panneau d'effets de la piste concernée
- [ ] Modifier un gain EQ sur une piste en lecture modifie le son en temps réel sans coupure
- [ ] Activer le compresseur sur une piste réduit audiblement la dynamique (test avec piste percussive)
- [ ] La reverb produit une queue sonore perceptible avec duration = 2 s, wet = 0.5
- [ ] Le délai produit un écho rythmé perceptible avec time = 0.5 s, feedback = 0.5, wet = 0.5
- [ ] Bypass d'un effet : le son redevient identique à l'état bypassed précédent immédiatement
- [ ] Sauvegarder le mix, recharger la page : tous les réglages d'effets sont restaurés fidèlement
- [ ] Un mix.json sans clé `effects` charge sans erreur (valeurs par défaut appliquées)
- [ ] Aucune régression sur volume, pan, mute, solo, sync des pistes existantes
