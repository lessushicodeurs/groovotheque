# Epic 29 — Batching de la chaîne d'effets Audacity

## Objectif

Réduire le nombre d'imports/exports Audacity en regroupant les steps consécutifs de même famille (Audacity) en un seul cycle import → N effets → export. Les steps `gain` et `pan` (ffmpeg) restent inchangés et servent de coupures naturelles entre les groupes Audacity.

**Exemple :** chaîne `normalize → compress → normalize → gain → compress`
- Aujourd'hui : 5 appels python, 5 Import2, 5 Export2
- Après epic : 2 appels python, 2 Import2, 2 Export2 — le `gain` (ffmpeg) coupe la chaîne en deux groupes Audacity `[normalize, compress, normalize]` et `[compress]`

---

## Contexte technique

- `apply_effects_chain()` dans `process-rehearsal.sh` boucle step par step et appelle `audacity_process.py --step compress/normalize` pour chaque step Audacity.
- `gain` et `pan` sont gérés directement en bash via ffmpeg — cette responsabilité ne change pas.
- Chaque appel python fait aujourd'hui : `RemoveTracks → Import2 → wait → effet → Export2 → RemoveTracks`.

---

## Décisions de conception

1. **Le groupement vit dans bash** : bash scanne la chaîne, identifie les runs consécutifs de steps Audacity (`compress`, `normalize`), et appelle python une seule fois par run avec `--chain '<json_array>'`.

2. **Nouvelle interface python** : `--chain '<json_array>' filepath` remplace `--step` pour les appels depuis bash. Python reçoit ex. `[{"type":"compress","preset":"Bass Guitar"},{"type":"normalize","target_db":-1}]`. Le `--step` reste disponible pour usage manuel/debug.

3. **Vérification par défaut : per-run** : un seul mtime check après l'Export2 final du run.

4. **Vérification renforcée avec `--verify`** : après chaque effet dans le run (sauf le dernier), un Export2 intermédiaire est effectué et le mtime est vérifié. La piste reste chargée en mémoire Audacity — pas de re-import. Le dernier Export2 du run sert à la fois de vérification finale et de sortie.

5. **Flag utilisateur `--verify-effects`** sur `process-rehearsal.sh`, transmis en `--verify` à `audacity_process.py`. Typiquement utilisé avec `--only-track "NOM"` pour déboguer un preset.

---

## Stories

### Story 1 — Nouvelle fonction `apply_audacity_chain()` dans `audacity_process.py`

Ajouter une fonction `apply_audacity_chain(pipe, filepath, steps, verify=False)` :

```
Import2(filepath)
wait_for_tracks()
drain()

for each step in steps:
    SelectAll()
    apply_effect(step)   # Compressor: ou Normalize: selon type
    
    if verify AND not last_step:
        SelectAll()
        Export2(filepath)
        check mtime changed
        # PAS de re-import — la piste reste chargée

SelectAll()
Export2(filepath)        # export final (toujours)
check mtime changed
SelectAll()
RemoveTracks()
```

La fonction `apply_effect(step)` dispatche selon `step["type"]` :
- `compress` → `_compressor_command(params)`
- `normalize` → `Normalize: PeakLevel=...`

Ajouter le flag CLI `--chain '<json>'` dans `argparse`. Garder `--step compress/normalize` pour compatibilité/debugging manuel.

Ajouter `--verify` (booléen, défaut `False`).

### Story 2 — Refactorer `apply_effects_chain()` dans `process-rehearsal.sh`

Remplacer la boucle step-par-step par un algorithme de groupement :

```
audacity_run=[]

for each step in effects:
    if step.type in [compress, normalize]:
        audacity_run.append(step)
    else:
        # step ffmpeg — flush le run Audacity en cours si non vide
        if audacity_run non vide:
            call python3 audacity_process.py --chain <json(audacity_run)> [--verify] filepath
            audacity_run = []
        # appliquer le step ffmpeg (gain ou pan) comme aujourd'hui

# flush le dernier run Audacity s'il reste des steps
if audacity_run non vide:
    call python3 audacity_process.py --chain <json(audacity_run)> [--verify] filepath
```

Pour construire le JSON du sous-tableau, utiliser python3 inline (déjà utilisé pour le parsing JSON dans le script).

### Story 3 — Ajouter `--verify-effects` à `process-rehearsal.sh`

Dans `parse_args()` : reconnaître `--verify-effects` (flag booléen, défaut false).
Stocker dans `VERIFY_EFFECTS=true`.
Dans `apply_effects_chain()` : passer `--verify` à python quand `VERIFY_EFFECTS=true`.

Mettre à jour `scripts/README.md` :
- Documenter `--verify-effects` dans le tableau des options
- Exemple d'usage : `./scripts/process-rehearsal.sh --only-track "01 BASS" --verify-effects ...`

---

## Critères d'acceptance

1. Chaîne `normalize → compress → normalize` sur un fichier : **1 Import2, 1 Export2** (vérifiable avec des logs de debug dans python).
2. Chaîne `normalize → compress → normalize → gain → compress` : **2 appels python**, 2 Import2, 2 Export2. Le gain est appliqué entre les deux via ffmpeg.
3. Chaîne 100 % ffmpeg (`gain → pan`) : python n'est pas appelé du tout.
4. Chaîne 100 % Audacity de 1 step (`normalize`) : 1 Import2, 1 Export2 — même comportement qu'aujourd'hui.
5. `--verify-effects` : un Export2 intermédiaire visible dans les logs après chaque effet sauf le dernier.
6. Audio produit identique avec et sans `--verify-effects` (même chaîne, même preset).
7. `--step` fonctionne encore depuis la ligne de commande (pas de régression pour usage manuel).

---

## Risques et points d'attention

- **Notification différée de `Compressor:`** (cf. `scripting-pratique.md` section 10) : dans un run multi-step, la barrière `GetInfo:` placée après `Compressor:` sert déjà de drain. Vérifier que ce drain est bien présent dans la boucle `apply_audacity_chain`.
- **`SelectAll:` en mode vérify** : la piste reste chargée après un Export2 intermédiaire, mais il faut s'assurer qu'elle est toujours entièrement sélectionnée avant l'effet suivant.
- **Ordre des imports dans le YAML** : la logique de groupement est purement syntaxique (types consécutifs) — deux `compress` séparés par un `normalize` forment UN run de 3, pas deux runs de 1.
