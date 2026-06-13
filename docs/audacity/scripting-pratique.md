# Guide pratique — Audacity scripting via mod-script-pipe

> Basé sur des tests réels effectués sur Audacity 3.7.7 Flatpak (Linux).
> Ce document corrige plusieurs inexactitudes de la documentation officielle et de `pipeclient.py`.

---

## 1. Protocole de communication — comportement réel

### Ce que dit la documentation officielle (et `pipeclient.py`)

S'arrêter à la première ligne vide pour signaler la fin d'une réponse.

### Ce qui se passe réellement

Audacity envoie `\n` **immédiatement** comme ACK d'accusé de réception, **puis** envoie la vraie réponse. Si on s'arrête sur ce premier `\n`, on lit la réponse de la commande *précédente* — décalage de 1 rang en cascade.

### Fix correct : utiliser `BatchCommand finished:` comme terminateur

Format réel d'une réponse réussie :

```
\n                           ← ACK immédiat (ignorer)
[contenu optionnel]\n       ← résultat (peut être vide pour certaines commandes)
BatchCommand finished: OK\n ← terminateur réel
\n                           ← trailing newline final (à drainer)
```

Format d'une réponse en erreur :

```
\n
command 'XYZ' not recognized
BatchCommand finished: Failed
\n
```

### Après un timeout

Drainer le pipe jusqu'au prochain `BatchCommand finished:` avant d'envoyer la commande suivante. Sinon les réponses se décalent en cascade.

---

## 2. Vérification du pipe actif (O_NONBLOCK)

Pour détecter si Audacity écoute activement le pipe (vs. pipe stale après fermeture) :

```python
import os

try:
    fd = os.open("/tmp/audacity_script_pipe.to.1000", os.O_WRONLY | os.O_NONBLOCK)
    os.close(fd)
    # Audacity écoute
except OSError:
    # OSError: [Errno 6] No such device or address → pipe stale, Audacity fermé
    pass
```

---

## 3. Commandes testées — résultats confirmés (Audacity 3.7.7)

| Commande | Statut | Notes |
|----------|--------|-------|
| `Import2: Filename="/chemin/fichier.flac"` | OK | Guillemets obligatoires ; **ne retourne AUCUNE réponse** — fire-and-forget |
| `OpenFiles: Filename=...` | ECHEC | Non reconnu dans 3.7.7 — fausse info dans la doc générale |
| `SelectAll:` | OK* | *Voir note ci-dessous — comportement variable |
| `Normalize: PeakLevel=-1 ApplyGain=True RemoveDcOffset=False StereoIndependent=False` | OK | |
| `Amplify: Ratio=<float> AllowClipping=False` | OK | Ratio = facteur linéaire (10^(dB/20)) |
| `Export2: Filename="/chemin/fichier.flac" NumChannels=1` | OK | Guillemets obligatoires pour les chemins avec espaces |
| `RemoveTracks:` | OK | Vide le projet sans fermer Audacity ; répond toujours avec `BatchCommand finished:` |
| `Close: SaveChanges=No` | non testé proprement | Remplacé par `RemoveTracks:` dans la pratique |
| `DynamicRangeCompressor: ...` | OK | Nouveau DRC Audacity 3.3+ — voir section 4 |
| `DynamicRangeProcessor: ...` | ECHEC | Non reconnu — moteur interne AU3, pas exposé via pipe |
| `GetInfo: Type=Tracks Format=JSON` | OK | Ping fiable — répond même sur projet vide, même au démarrage |
| `GetInfo: Type=Commands Format=Brief` | BLOQUE | Bloque à ~20 000 chars dans les plugins Nyquist — ne pas utiliser sans timeout > 5 min |

### Note sur `SelectAll:` — comportement variable

`SelectAll:` retourne des réponses différentes selon le contexte :
- **Projet vide** : `\n` seulement (ACK) — pas de `BatchCommand finished:`. Si on attend le terminateur, on bloque.
- **Avec pistes** : `\n` (ACK) + JSON liste des pistes + `BatchCommand finished: OK` + `\n`

**Solution** : utiliser `send_nowait("SelectAll:")` — écrire dans le pipe sans lire la réponse. La commande suivante sera envoyée après SelectAll dans la file, et Audacity les exécutera dans l'ordre.

### Note sur `Import2:` — aucune réponse

`Import2:` ne retourne **aucune réponse** — pas même `\n` d'ACK. Écrire dans le pipe et immédiatement poller avec `GetInfo: Type=Tracks Format=JSON` pour savoir quand la piste est chargée.

### Note sur le premier démarrage

Sur Audacity fraîchement lancé, les **premières commandes peuvent prendre >10s** à répondre (chargement des plugins, initialisation). Le premier ping fiable est `GetInfo: Type=Tracks Format=JSON` avec une boucle de retry jusqu'à 30s.

---

## 4. Commande DynamicRangeCompressor — paramètres confirmés

Syntaxe complète :

```
DynamicRangeCompressor: compressorThreshold=-13 compressorRatio=3 compressorAttackTime=1 compressorReleaseTime=50 compressorKneeWidth=2 makeupGainDb=0 lookaheadMs=40 processorType=0
```

`processorType` : `0` = Compressor, `1` = Expander/Noise Gate, `2` = Limiter

### Correspondance des noms de paramètres

Les noms de paramètres du pipe ne correspondent pas aux noms dans le code source C++ (`DynamicRangeProcessorUtils.h`) ni aux labels dans l'UI. Correspondance confirmée par test :

| Concept | Paramètre pipe |
|---------|---------------|
| Threshold | `compressorThreshold` |
| Ratio | `compressorRatio` |
| Attack | `compressorAttackTime` |
| Release | `compressorReleaseTime` |
| Knee | `compressorKneeWidth` |
| Makeup gain | `makeupGainDb` |
| Lookahead | `lookaheadMs` |
| Type (compressor/expander/limiter) | `processorType` |

---

## 5. Séquence complète pour traiter un fichier

```
SelectAll:           ← nettoyer d'abord (au cas où des pistes sont déjà chargées)
RemoveTracks:
Import2: Filename="/chemin/fichier.flac"
GetInfo: Type=Tracks Format=JSON   ← poller jusqu'à voir "{" dans la réponse
SelectAll:
DynamicRangeCompressor: compressorThreshold=-13 compressorRatio=3 compressorAttackTime=1 compressorReleaseTime=50 compressorKneeWidth=2 makeupGainDb=0 lookaheadMs=40 processorType=0
SelectAll:
Normalize: PeakLevel=-1 ApplyGain=True RemoveDcOffset=False StereoIndependent=False
SelectAll:
Amplify: Ratio=<float> AllowClipping=False   ← optionnel
Export2: Filename="/chemin/fichier.flac" NumChannels=1
SelectAll:
RemoveTracks:        ← vider pour le fichier suivant
```

---

## 6. Détection de chargement de piste (polling)

`Import2:` ne retourne aucune réponse. Le chargement se produit en arrière-plan. Il faut poller `GetInfo: Type=Tracks Format=JSON` jusqu'à voir `{` dans la réponse — ce caractère indique qu'au moins une piste est présente et chargée.

```python
def _wait_for_tracks(pipe, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = pipe.send("GetInfo: Type=Tracks Format=JSON", timeout=5.0)
        if resp and "{" in resp:
            return True
        time.sleep(0.3)
    return False
```

---

## 7. Autosaves problématiques (Flatpak)

Quand Audacity se ferme anormalement, il laisse des fichiers `.aup3unsaved*` dans :

```
~/.var/app/org.audacityteam.Audacity/cache/tmp/audacity-<user>/
```

Au prochain démarrage, Audacity affiche une fenêtre de récupération qui **bloque le pipe** jusqu'à que l'utilisateur clique. Nettoyer avant de redémarrer Audacity :

```bash
rm -f ~/.var/app/org.audacityteam.Audacity/cache/tmp/audacity-alaindiart/*.aup3unsaved*
```

---

## 8. Flatpak — chemins et pipes

Le Flatpak Audacity partage `/tmp` avec le host. Les pipes `/tmp/audacity_script_pipe.*` sont donc accessibles normalement depuis l'extérieur du Flatpak sans configuration supplémentaire.

Les chemins de fichiers audio passés à `Import2:` et `Export2:` doivent pointer vers un répertoire accessible au Flatpak. Le répertoire home et `/tmp` sont accessibles par défaut.
