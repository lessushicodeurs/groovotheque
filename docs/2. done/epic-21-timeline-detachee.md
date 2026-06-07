# Epic 21 — Timeline et bande de marqueurs détachées de la piste 0

## Objectif

La timeline (graduations temporelles) et la bande de marqueurs sont actuellement imbriquées dans la `track-row` de la première piste, ce qui les rend visuellement solidaires d'une piste audio particulière. Les extraire dans une rangée dédiée au-dessus de toutes les pistes audio pour qu'elles soient perçues comme des éléments globaux du groove.

## Dépendances

- Epic 17 complet (bande de marqueurs)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Emplacement | Rangée `.timeline-row` insérée avant les `.track-row` dans `#tracks-container` |
| Sidebar placeholder | `.timeline-sidebar` de 176px (même largeur que `.track-sidebar`) pour aligner la zone timeline avec les zones waveform |
| Piste 0 | Redevient une `.track-row` normale (plus de `.track-wave-col`) |
| `TimelinePlugin` | `container: timelineExtEl` inchangé — l'élément peut être n'importe où dans le DOM |
| Logique marqueurs | Inchangée — `getBoundingClientRect()` sur `markerLaneEl` reste valide |
| Compatibilité zoom | La `.timeline-row` doit être dans le même conteneur scrollable que les pistes (Epic 18) |

---

## Structure cible

```
#tracks-container
├── .timeline-row               ← NOUVELLE rangée
│   ├── .timeline-sidebar       ← placeholder 176px
│   └── .timeline-wave-col      ← flex:1, même layout que .track-wave-col
│       ├── .track-timeline-ext ← TimelinePlugin (inchangé)
│       └── .marker-lane        ← bande de marqueurs (inchangée)
├── .track-row (piste 0)        ← redevient normale : sidebar + waveEl
├── .track-row (piste 1)
└── …
```

---

## Stories

### 21.1 — Rangée timeline dédiée

Avant la boucle de création des pistes dans `buildTrackRow`, créer la `.timeline-row` et l'insérer dans `#tracks-container` :

- Créer `.timeline-sidebar` (176px, `flex-shrink: 0`, sans contenu)
- Créer `.timeline-wave-col` (`flex: 1`)
- Y placer `timelineExtEl` et `markerLaneEl` (creation inchangée)
- Appendre `.timeline-sidebar + .timeline-wave-col` dans `.timeline-row`, puis dans `#tracks-container`

### 21.2 — Piste 0 normalisée

Supprimer le bloc `if (idx === 0)` qui crée le `.track-wave-col` dans `buildTrackRow` :

- La piste 0 utilise désormais `row.append(sidebar, waveEl)` comme toutes les autres
- `timelinePluginRef` est toujours créé et attaché au WaveSurfer de la piste 0 (le `container` pointe vers `timelineExtEl` déplacé dans la `.timeline-row`)

### 21.3 — CSS

- `.timeline-row` : même `display: flex`, `align-items: stretch`, `border-bottom` que `.track-row`
- `.timeline-sidebar` : même largeur (176px), fond `#141414`, `border-right` identique à `.track-sidebar` — sans contenu
- Ajuster `.track-row:first-child` si la border-top doit rester sur la première piste audio (pas sur la `.timeline-row`)

---

## Critères d'acceptance

- La timeline s'aligne pixel-perfect avec les zones waveform de toutes les pistes
- La bande de marqueurs fonctionne identiquement (clic pour créer, drag, resize des bords, sélection, loop-in/out)
- La piste 0 a la même apparence et comportement que toutes les autres pistes
- Pas de régression sur la synchronisation des pistes
- Compatible avec le futur scroll horizontal (Epic 18) : la `.timeline-row` fait partie du même conteneur scrollable
