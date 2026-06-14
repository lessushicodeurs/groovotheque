# Epic 32 — Bus d'effets partagés avec sends par piste

## Objectif

Ajouter un système de sends vers des bus d'effets partagés (reverb, delay) dans le player. Chaque piste dispose d'un niveau de send indépendant vers chaque bus ; les effets tournent sur une seule instance partagée par l'AudioContext. Cela permet d'obtenir une reverb de salle cohérente sur plusieurs pistes sans multiplier les instances coûteuses, sur le modèle d'une table de mixage DAW.

## Dépendances

- Epic 31 complet (effets audio par piste) — les buses partagent la même infrastructure `AudioContext` et le même format `mix.json`

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Topologie | 2 buses fixes : **Reverb** et **Delay** — pas de buses libres configurables |
| Point de send | Post-`GainNode`, pré-`StereoPannerNode` — le send capte le signal à niveau volume mais avant le pan |
| Send level | `GainNode` dédié par piste par bus (`sendGain`, valeur 0–1) |
| Bus reverb | `ConvolverNode` avec IR synthétique (même approche qu'epic 31 story 31.4) |
| Bus delay | `DelayNode` + `GainNode` feedback, identique à la story 31.5 mais partagé |
| Return | Chaque bus a un `GainNode` return (niveau maître du bus) → `destination` |
| Wet/dry | 100 % wet sur le bus — le dry reste sur la piste ; pas de wet/dry interne au bus |
| Persistence | Extension du `mix.json` : clé `sends` par piste + clé `buses` au niveau groove |
| UI sends | Deux petits knobs "R" et "D" dans la bande de piste (à côté de volume/pan) |
| UI bus | Panneau global "Buses" en bas de sidebar : return level + paramètres reverb/delay |

---

## Stories

### 32.1 — Infrastructure des buses partagés

Créer les deux bus d'effets au démarrage du player, partagés entre toutes les pistes.

- Ajouter `buses` dans l'état global du player : `{ reverb: BusNode, delay: BusNode }`
- Chaque `BusNode` = `{ input: GainNode, effect: ConvolverNode|DelayNode, return: GainNode }` — `input` est le point d'entrée, `return` est connecté à `destination`
- Fonction `buildReverbBus(audioCtx)` : crée `input → ConvolverNode(IR synthétique) → return → destination`
- Fonction `buildDelayBus(audioCtx)` : crée `input → DelayNode → feedbackGain → (boucle) → return → destination`
- Les buses sont instanciés une seule fois à l'init du player, avant la création des pistes
- Paramètres par défaut : reverb duration = 1.5 s, decay = 2 ; delay time = 0.3 s, feedback = 0.4

### 32.2 — Send par piste

Relier chaque piste aux buses via un `GainNode` de send indépendant.

- Pour chaque piste, créer deux `SendGainNode` : `sendReverb` et `sendDelay` (valeur initiale 0 = silence)
- Connexion : `trackGainNode.connect(sendReverb)` + `sendReverb.connect(buses.reverb.input)` (idem delay)
- Stocker `{ sendReverb, sendDelay }` dans la structure de piste (à côté de `gainNode`, `panNode`)
- Modifier `buildTrackRow` pour créer et connecter les sends après le `GainNode`
- Fonction `setSend(trackId, busKey, value)` : met à jour `sendGainNode.gain.setTargetAtTime(value, …)`

### 32.3 — UI knobs de send dans la bande de piste

Ajouter deux petits knobs "R" (reverb) et "D" (delay) dans chaque bande de piste.

- Positionner les knobs à droite du knob pan, même style visuel que `PanKnob` (player.js:277-420) mais taille réduite
- Plage : 0–1, valeur 0 par défaut
- Mise à jour en temps réel via `setSend` à chaque mouvement du knob
- Libellé au survol : "Send Reverb" / "Send Delay"
- Le knob reste visible même si la piste est mutée (le send suit le gain de la piste, donc silence automatique)

### 32.4 — Panneau de contrôle des buses

Ajouter un panneau global "FX Buses" dans la sidebar pour ajuster les paramètres des buses.

- Section **Reverb Bus** : return level, duration (0.1–4 s), decay (0.1–10)
- Section **Delay Bus** : return level, time (0–2 s), feedback (0–0.9)
- Chaque paramètre : knob ou slider, mise à jour `AudioParam` en temps réel
- Panneau collapsible, positionné en bas de sidebar sous la liste des pistes
- Aucun toggle bypass global — réduire les sends à 0 suffit pour désactiver

### 32.5 — Persistence dans mix.json

Sauvegarder et restaurer les niveaux de send par piste et les paramètres des buses.

- Étendre le format `mix.json` par piste :
  ```json
  {
    "volume": 80,
    "pan": 0,
    "sends": { "reverb": 0.4, "delay": 0.0 }
  }
  ```
- Ajouter une clé `buses` au niveau racine du `mix.json` :
  ```json
  {
    "buses": {
      "reverb": { "return": 0.8, "duration": 1.5, "decay": 2.0 },
      "delay":  { "return": 0.7, "time": 0.3, "feedback": 0.4 }
    }
  }
  ```
- `GET /api/mix/:groove` : restaurer les sends et paramètres buses après init
- `POST /api/mix/:groove` : inclure `sends` et `buses` dans le payload
- Rétrocompatibilité : `sends` absent → sends à 0 ; `buses` absent → valeurs par défaut

---

## Critères d'acceptance

- [ ] Une piste avec send reverb à 0 et send delay à 0 sonne identiquement à avant l'epic
- [ ] Monter le send reverb d'une piste produit une queue de réverbération audible en temps réel
- [ ] Monter le send reverb de deux pistes différentes produit une reverb cohérente (même espace sonore)
- [ ] Monter le send delay d'une piste produit un écho rythmé avec feedback perceptible
- [ ] Modifier le return level du bus reverb affecte toutes les pistes qui y envoient simultanément
- [ ] Muter une piste coupe aussi sa contribution aux buses (le send suit le gain à 0)
- [ ] Sauvegarder le mix, recharger la page : tous les sends et paramètres buses sont restaurés
- [ ] Un mix.json sans clé `sends` / `buses` charge sans erreur (valeurs par défaut)
- [ ] Aucune régression sur volume, pan, mute, solo, effets par piste (epic 31)
- [ ] Deux instances AudioContext ne sont pas créées — les buses utilisent le contexte partagé existant
