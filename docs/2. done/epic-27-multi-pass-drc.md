# Epic 27 — Multi-pass DRC ffmpeg : répétition de la chaîne compression → normalisation — WONT DO

> **Abandonnée.** L'epic 28 (`effects:` chain ordonnée via Audacity) adresse le même problème de façon plus générale et a été livrée à la place. Cette piste ffmpeg multi-pass n'a pas été retenue.

## Objectif

Alternative à l'epic 26 (remplacement par Audacity) : plutôt que de changer d'outil, on améliore la qualité DRC en répétant la chaîne **acompressor → normalize** N fois via ffmpeg. Une première passe dompte les transitoires les plus forts, la normalisation rééquilibre le niveau, puis une seconde passe affine la densité sonore — ce qui compense partiellement les limitations du compresseur ffmpeg (absence de lookahead). L'attribut `multi_pass: N` au niveau piste contrôle le nombre de passes ; les pistes sans cet attribut sont traitées comme avant.

## Dépendances

- Epic 12 complet (rehearsal-import — pipeline `process-rehearsal.sh`)
- *(incompatible avec epic 26)* — les deux epics adressent le même problème via des approches différentes ; une seule doit être implémentée

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Outil | ffmpeg uniquement — `acompressor` + `volume=` / `loudnorm` selon config |
| Placement YAML | `multi_pass` est au niveau de la piste (pas dans le bloc `compression`) |
| Comportement absent / `multi_pass: 1` | Identique à l'existant — aucune régression |
| Ordre des opérations | `(acompressor → normalize) × N → gain` — le gain reste unique, appliqué après toutes les passes |
| Implémentation | Boucle dans `process-rehearsal.sh` : N appels ffmpeg enchaînés sur le fichier FLAC intermédiaire |

---

## Stories

### 27.1 — Boucle multi-pass dans `scripts/process-rehearsal.sh`

Répéter les étapes compression + normalisation N fois pour les pistes ayant `multi_pass: N`.

- Lire `multi_pass` depuis le bloc piste du YAML (défaut : `1`)
- Si `multi_pass > 1` : boucler N fois sur les étapes compression ffmpeg (`acompressor`) et normalisation (`volumedetect` + `volume=`)
- Chaque passe écrit dans un fichier FLAC temporaire intermédiaire ; la passe suivante le reprend en entrée
- Le gain (`gain_db`) reste appliqué une seule fois, après la dernière passe
- Les pistes sans `multi_pass` (ou `multi_pass: 1`) suivent exactement le chemin actuel — aucune régression

Pistes configurées avec `multi_pass: 2` dans le YAML actuel : 01 BASS, 09 BACKING VOC, 10 LEAD VOCAL, 11 DR KICK, 12 DR HH SD.

---

## Critères d'acceptance

- [ ] Les pistes avec `multi_pass: 2` passent deux fois par la chaîne `acompressor → normalize` avant le gain final (vérifiable via les logs ffmpeg dans la sortie du script)
- [ ] Les pistes sans `multi_pass` (02 GUIT MIX, 04 KEYS MIX) produisent un résultat identique à avant
- [ ] `multi_pass: 1` produit un résultat identique à l'absence du champ
- [ ] Le gain final (`gain_db`) est appliqué une seule fois, après toutes les passes
- [ ] Le pipeline complet `process-rehearsal.sh` produit des fichiers MP3 sans erreur pour toutes les pistes
