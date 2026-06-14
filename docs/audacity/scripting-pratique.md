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
| `Compressor: thresholdDb=... compressionRatio=... attackMs=... releaseMs=... kneeWidthDb=... makeupGainDb=... lookaheadMs=...` | OK | Nouveau DRC Audacity 3.3+ — voir section 4 |
| `DynamicRangeCompressor: ...` | **PIÈGE** | Accepté sans erreur (`OK`) mais **aucun effet appliqué** — voir section 11 |
| `DynamicRangeProcessor: ...` | ECHEC | Non reconnu — moteur interne AU3, pas exposé via pipe |
| `GetInfo: Type=Tracks Format=JSON` | OK | Ping fiable — répond même sur projet vide, même au démarrage |
| `GetInfo: Type=Commands Format=Brief` | BLOQUE | Bloque à ~20 000 chars dans les plugins Nyquist — ne pas utiliser sans timeout > 5 min |

### Note sur `SelectAll:` — comportement variable

`SelectAll:` retourne des réponses différentes selon le contexte :
- **Projet vide** : `\n` seulement (ACK) — pas de `BatchCommand finished:`. Si on attend le terminateur, on bloque.
- **Avec pistes** : `\n` (ACK) + JSON liste des pistes + `BatchCommand finished: OK` + `\n`

**Solution** : utiliser `pipe.send("SelectAll:")` de façon synchrone (lire et jeter la réponse). Ne pas utiliser `send_nowait` : une réponse non lue reste dans le pipe et sera consommée par la commande suivante comme si c'était sa propre réponse — décalage silencieux en cascade (Export2 lira l'ACK de SelectAll et croira que l'export a répondu).

### Note sur `Import2:` — aucune réponse

`Import2:` ne retourne **aucune réponse** — pas même `\n` d'ACK. Écrire dans le pipe et immédiatement poller avec `GetInfo: Type=Tracks Format=JSON` pour savoir quand la piste est chargée.

### Note sur le premier démarrage

Sur Audacity fraîchement lancé, les **premières commandes peuvent prendre >10s** à répondre (chargement des plugins, initialisation). Le premier ping fiable est `GetInfo: Type=Tracks Format=JSON` avec une boucle de retry jusqu'à 30s.

---

## 4. Commande Compressor: — paramètres confirmés

> **⚠ PIÈGE CRITIQUE** : la commande s'appelle `Compressor:`, pas `DynamicRangeCompressor:`.
> `DynamicRangeCompressor:` est acceptée par Audacity sans erreur (`BatchCommand finished: OK`)
> mais **n'applique aucun effet**. Aucun avertissement, aucun `Failed!`. La seule façon de
> détecter ce bug est de mesurer la dynamique du fichier produit (ex. `ffprobe volumedetect`).

Syntaxe complète (Audacity 3.7.7 Flatpak, testé) :

```
Compressor: thresholdDb=-13 compressionRatio=3 attackMs=1 releaseMs=50 kneeWidthDb=2 makeupGainDb=0 lookaheadMs=40
```

### Correspondance des noms de paramètres

Les noms de paramètres du pipe sont distincts des labels UI et des noms dans `DynamicRangeProcessorUtils.h`. Correspondance confirmée par `GetInfo: Type=Commands Format=JSON` puis test :

| Concept | Paramètre pipe (correct) | ~~Ancien nom erroné~~ |
|---------|--------------------------|----------------------|
| Threshold | `thresholdDb` | ~~`compressorThreshold`~~ |
| Ratio | `compressionRatio` | ~~`compressorRatio`~~ |
| Attack | `attackMs` | ~~`compressorAttackTime`~~ |
| Release | `releaseMs` | ~~`compressorReleaseTime`~~ |
| Knee | `kneeWidthDb` | ~~`compressorKneeWidth`~~ |
| Makeup gain | `makeupGainDb` | *(idem)* |
| Lookahead | `lookaheadMs` | *(idem)* |

> `processorType` n'existe **pas** dans `Compressor:` (c'était un paramètre fictif de l'ancienne hypothèse). Le type est fixé par la commande elle-même (`Compressor:` = compresseur uniquement).

---

## 5. Séquence complète pour traiter un fichier

```
SelectAll:           ← nettoyer (au cas où des pistes sont déjà chargées)
RemoveTracks:
Import2: Filename="/chemin/fichier.flac"
GetInfo: Type=Tracks Format=JSON   ← poller jusqu'à voir "{" dans la réponse
[drain pipe]         ← OBLIGATOIRE après le polling (voir section 8)
SelectAll:
Compressor: thresholdDb=-13 compressionRatio=3 attackMs=1 releaseMs=50 kneeWidthDb=2 makeupGainDb=0 lookaheadMs=40
[drain pipe]         ← OBLIGATOIRE : Compressor: émet une notification différée (voir section 9)
SelectAll:
Normalize: PeakLevel=-1 ApplyGain=True RemoveDcOffset=False StereoIndependent=False
SelectAll:
Amplify: Ratio=<float> AllowClipping=False   ← optionnel
SelectAll:
Export2: Filename="/chemin/fichier.flac" NumChannels=1
SelectAll:
RemoveTracks:        ← vider pour le fichier suivant
```

> Chaque `SelectAll:` doit être envoyé de façon **synchrone** (lire et jeter la réponse) — voir note section 3.

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

---

## 9. Réponses résiduelles après polling — drain obligatoire

`_wait_for_tracks` envoie N commandes `GetInfo:` en boucle jusqu'à détecter une piste. Chaque appel consomme SA réponse, mais Audacity peut laisser des fragments de réponse dans le pipe entre deux polls (ACKs partiels, trailing newlines). Ces résidus restent dans le pipe après le retour de `_wait_for_tracks`.

**Symptôme** : la commande envoyée juste après (ex. `SelectAll:` ou `Compressor:`) lit une réponse décalée — elle consomme un résidu du polling et croit avoir reçu sa propre réponse.

**Fix** : appeler `_drain(timeout=1.0)` immédiatement après `_wait_for_tracks` pour purger le pipe avant d'envoyer la première vraie commande de traitement.

```python
_wait_for_tracks(pipe, timeout=30)
_drain(pipe, timeout=1.0)   # purger les résidus du polling
pipe.send("SelectAll:")
```

---

## 10. Notification différée de Compressor: — drain avant Export2

Après que `Compressor:` a terminé et retourné `BatchCommand finished: OK`, Audacity envoie une **notification interne supplémentaire** dans le pipe (comportement non documenté, probablement un événement d'interface signalant la fin de l'effet). Ce message n'est pas `BatchCommand finished:` — il reste dans le pipe.

**Symptôme** : `Export2:` lit cette notification comme sa propre réponse et retourne `Failed!` (ou un contenu inattendu). Le fichier exporté peut être inchangé sur disque.

**Fix** : appeler `_drain_until_batch_finished(timeout=10.0)` après `Compressor:` (et après avoir consommé son `BatchCommand finished: OK`) avant d'envoyer `Export2:`.

```python
resp = pipe.send("Compressor: ...", timeout=600.0)
# resp contient "BatchCommand finished: OK"
_drain_until_batch_finished(pipe, timeout=10.0)  # purger la notification différée
pipe.send("SelectAll:")
pipe.send("Export2: ...")
```

> Ce comportement a été constaté sur Audacity 3.7.7 Flatpak Linux. Il peut être spécifique à certaines versions ou configurations.

---

## 11. Acceptation silencieuse des commandes inconnues

Audacity retourne `BatchCommand finished: OK` pour des commandes qu'il ne reconnaît pas. **Il n'y a aucun `Failed!`, aucun message d'erreur.**

Exemples de commandes acceptées sans effet :
- `DynamicRangeCompressor:` (faux nom du compresseur — voir section 4)
- Toute commande avec une faute de frappe dans le nom

La seule façon de détecter un effet non appliqué est de mesurer le signal produit (ex. `ffprobe -af volumedetect` avant/après pour vérifier que la dynamique a changé).
