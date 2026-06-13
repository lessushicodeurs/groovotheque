# Epic 26 — WIP / Passation de session

> Rédigé le 2026-06-13. À passer à une nouvelle session Claude pour continuer l'implémentation.

---

## Contexte projet

`groovotheque` à `/home/alaindiart/Sites/_perso/groovotheque`, worktree epic en cours : `.worktrees/epic-26-audacity-drc`. L'epic remplace le pipeline ffmpeg `acompressor`/`dynaudnorm` de `process-rehearsal.sh` par des appels Audacity 3.7.7 Flatpak via mod-script-pipe.

Spec complète : `docs/1. todo/epic-26-audacity-drc.md`  
Doc de référence mod-script-pipe : `docs/audacity/audacity-cli-research.md`  
Presets DRC : `docs/audacity/presets/compressor.md`

---

## État de l'implémentation

### Fichiers modifiés (tout dans `.worktrees/epic-26-audacity-drc/`)

- `scripts/audacity_process.py` — helper Python principal (IPC Audacity via mod-script-pipe)
- `scripts/rehearsal-config.yaml` — config presets par piste
- `scripts/setup.sh` — vérification Flatpak Audacity
- `scripts/process-rehearsal.sh` — pipeline principal (ffmpeg compress/norm remplacé)

### Ce qui fonctionne (testé en direct sur pipe Audacity)

| Commande | Statut |
|----------|--------|
| `Import2: Filename="/chemin/fichier.flac"` | ✅ charge le fichier |
| `SelectAll:` | ✅ |
| `Normalize: PeakLevel=-1 ApplyGain=True RemoveDcOffset=False StereoIndependent=False` | ✅ |
| `Amplify: Ratio=<float> AllowClipping=False` | ✅ |
| `Export2: Filename="/chemin/fichier.flac" NumChannels=1` | ✅ (guillemets obligatoires pour les espaces) |
| `RemoveTracks:` | ✅ vide le projet pour le fichier suivant |
| `OpenFiles:` | ❌ non reconnu |
| `Close: SaveChanges=No` | ⚠️ non testé proprement, remplacé par RemoveTracks: |

### Commande DRC : NOM NON CONFIRMÉ

- `DynamicRangeProcessor: compressorThreshold=... compressorRatio=...` → **non reconnu** (effet "au3", nouveau moteur Audacity 3.7, probablement non exposé dans l'ancienne API scripting)
- `DynamicRangeCompressor:` → résultat ambigu (Help a retourné OK mais la sync du pipe était mauvaise lors du test)
- `Compressor:` → existe, mais c'est **l'ancien compresseur** Audacity (paramètres différents : `compressionRatio` seulement, pas `compressorThreshold`, `lookaheadMs`, etc.)

La liste complète des commandes (`GetInfo: Type=Commands Format=Brief`) se bloque à ~20 000 chars dans la section plugins Nyquist et ne se termine jamais. `DynamicRangeProcessor` n'apparaît pas dans les données reçues.

---

## Bug critique : synchronisation du pipe (à corriger en premier)

### Le problème

La fonction `send()` actuelle casse sur la **première ligne vide** (`\n`). Or Audacity envoie `\n` **immédiatement** comme ACK, puis la vraie réponse arrive plus tard. Résultat : chaque `send()` lit la réponse de la commande **précédente**, pas la sienne. Quand une commande time out, toutes les réponses suivantes se décalent d'un rang.

### Le fix

Utiliser `"BatchCommand finished:"` comme terminateur, et **drainer** la réponse en attente après un timeout :

```python
def send(self, command: str, timeout: float = 60.0):
    self._to.write(command + "\n")
    self._to.flush()
    result = ""
    deadline = time.time() + timeout
    while time.time() < deadline:
        rem = deadline - time.time()
        ready = select.select([self._from], [], [], min(rem, 1.0))
        if not ready[0]:
            if time.time() >= deadline:
                self._drain_until_batch_finished()
                return None
            continue
        line = self._from.readline()
        result += line
        if "BatchCommand finished:" in line:
            # Drainer le \n final
            if select.select([self._from], [], [], 0.5)[0]:
                self._from.readline()
            break
    return result.strip()

def _drain_until_batch_finished(self, timeout: float = 60.0):
    """Consomme une réponse complète du pipe pour maintenir la synchro après timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not select.select([self._from], [], [], 2.0)[0]:
            break
        line = self._from.readline()
        if "BatchCommand finished:" in line:
            if select.select([self._from], [], [], 0.3)[0]:
                self._from.readline()
            break
```

---

## Séquence correcte pour traiter un fichier

```
Import2: Filename="/chemin/avec espaces/fichier.flac"
# Poller GetInfo: Type=Tracks Format=JSON jusqu'à voir "{" dans la réponse
SelectAll:
DynamicRangeCompressor: compressorThreshold=-13 compressorRatio=3 compressorAttackTime=1 compressorReleaseTime=50 compressorKneeWidth=2 makeupGainDb=0 lookaheadMs=40 processorType=0
# ↑ NOM À CONFIRMER — si non reconnu, chercher le bon nom
SelectAll:
Normalize: PeakLevel=-1 ApplyGain=True RemoveDcOffset=False StereoIndependent=False
# Si gain ≠ 0 :
SelectAll:
Amplify: Ratio=<float> AllowClipping=False
# Exporter sur place :
Export2: Filename="/chemin/fichier.flac" NumChannels=1
# Vider le projet pour le fichier suivant :
SelectAll:
RemoveTracks:
```

---

## Ce qu'il faut faire, dans l'ordre

### 1. Corriger `send()` dans `audacity_process.py`

Remplacer l'implémentation actuelle (qui casse sur le premier `\n`) par celle documentée ci-dessus (`BatchCommand finished:` + drain after timeout).

### 2. Confirmer le nom de la commande DRC

Avec une piste chargée dans Audacity (utiliser `/home/alaindiart/test_bass.flac` — copie de `01 BASS.flac`), tester :

```python
# Après Import2 + attente chargement + SelectAll :
send('DynamicRangeCompressor: compressorThreshold=-13 compressorRatio=3 '
     'compressorAttackTime=1 compressorReleaseTime=50 compressorKneeWidth=2 '
     'makeupGainDb=0 lookaheadMs=40 processorType=0')
```

- Si `BatchCommand finished: OK` → ✅ le nom est `DynamicRangeCompressor`
- Si "not recognized" → lire la liste complète : `GetInfo: Type=Commands Format=Brief`, sauvegarder dans un fichier, attendre que ça se termine (peut prendre > 5 min à cause d'un plugin Nyquist bloquant), chercher `ynamic` ou `Range`

### 3. Tester le pipeline complet

```bash
cd .worktrees/epic-26-audacity-drc
./scripts/process-rehearsal.sh ./grooves/Tmp/260612-Répé-Set-1/
```

---

## Infos pratiques

| Quoi | Valeur |
|------|--------|
| Pipe Audacity | `/tmp/audacity_script_pipe.to.1000` et `.from.1000` |
| Lancer Audacity | `flatpak run org.audacityteam.Audacity &`, attendre ~8s |
| Vérifier pipe LIVE | `python3 -c "import os,fcntl; fd=os.open('/tmp/audacity_script_pipe.to.1000', os.O_WRONLY\|os.O_NONBLOCK); os.close(fd); print('LIVE')"` |
| Autosaves à supprimer avant redémarrage | `~/.var/app/org.audacityteam.Audacity/cache/tmp/audacity-alaindiart/*.aup3unsaved*` |
| Fichier test sans accent | `/home/alaindiart/test_bass.flac` |
| Données de répétition | `.worktrees/epic-26-audacity-drc/grooves/Tmp/260612-Répé-Set-1/` |

**Règle projet** : committer uniquement sur validation explicite de l'utilisateur.
