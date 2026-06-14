# Compte rendu de recherche — Audacity en CLI

> Recherche effectuée le 2026-06-13 via deep-research (101 agents, 19 sources, 25 claims vérifiés).
> Sources primaires : manuel officiel Audacity, dépôts GitHub audacity/audacity, JamesCrook/TeamTools, Witiko/audacity-bridge, asweigart/pyaudacity, slhck/ffmpeg-normalize.

---

## Verdict principal

**Audacity n'a pas de CLI native.** Il n'existe aucun flag `--batch`, aucun mode headless, aucun daemon. Toute automatisation passe par un protocole IPC via **pipes nommés** (`mod-script-pipe`), qui exige qu'une instance Audacity avec GUI soit déjà lancée — ou lancée par le script lui-même.

---

## Mécanisme : mod-script-pipe

### Principe

Audacity expose un module optionnel (`mod-script-pipe`) qui crée deux pipes nommés à son démarrage. Tout programme capable d'écrire/lire sur ces pipes peut envoyer des commandes à Audacity et récupérer les réponses.

> Manuel officiel : *"Commands are sent to Audacity over a named pipe. Any scripting language that supports named pipes can be used."*

### Activation (one-time)

Le module n'est **pas activé par défaut** :

```
Edit → Preferences → Modules → mod-script-pipe : Enabled → redémarrer Audacity
```

Confirmé par le manuel officiel, pyaudacity (asweigart), audacity-scripting (PyPI) et plusieurs sources terrain.

### Localisation des pipes

| OS | Pipe "to" (commandes → Audacity) | Pipe "from" (réponses ← Audacity) |
|----|----------------------------------|-----------------------------------|
| Linux / macOS | `/tmp/audacity_script_pipe.to.<uid>` | `/tmp/audacity_script_pipe.from.<uid>` |
| Windows | `\\.\pipe\ToSrvPipe` | `\\.\pipe\FromSrvPipe` |

L'UID Unix est **dynamique** — les chemins doivent être construits avec `os.getuid()`, jamais hardcodés.

### Usage direct (Python sans bibliothèque tierce)

```python
import os

uid = os.getuid()
pipe_to   = f"/tmp/audacity_script_pipe.to.{uid}"
pipe_from = f"/tmp/audacity_script_pipe.from.{uid}"

with open(pipe_to, "w") as to_pipe:
    to_pipe.write("GetInfo: Type=Commands\nEnd\n")

with open(pipe_from, "r") as from_pipe:
    result = from_pipe.readline()
    print(result)
```

Le code de référence officiel (`pipeclient.py`) se trouve dans le dépôt `audacity/audacity`.

### Commandes utiles (Audacity 3.x)

| Action | Commande scripting |
|--------|-------------------|
| Ouvrir un fichier | `Import2: Filename="/path/to/file.flac"` |
| Tout sélectionner | `SelectAll` |
| Appliquer un effet | `NomDeLEffet: Param1=val ...` |
| Normaliser (peak) | `Normalize: PeakLevel=-1 ApplyGain=1 RemoveDcOffset=1 StereoIndependent=0` |
| Amplifier (gain) | `Amplify: Ratio=<facteur_linéaire>` |
| Exporter | `Export2: Filename=/path/out.flac` |
| Fermer sans sauver | `Close: SaveChanges=No` |
| Lister les commandes | `GetInfo: Type=Commands` |

> **Note** : le nom exact de la commande pour le nouveau DRC (Audacity 3.3+) est `Compressor:` (confirmé sur 3.7.7 Flatpak). `DynamicRangeCompressor:` est accepté sans erreur mais n'applique aucun effet — piège silencieux. Voir `docs/audacity/scripting-pratique.md` pour les paramètres complets et les pièges du protocole.

---

## Outils tiers évalués

### audacity-scripting (PyPI)

Bibliothèque Python qui encapsule le protocole mod-script-pipe.

- Prérequis explicite : *"All the commands assume that the Audacity application is up and running; That is mandatory."*
- Pas de mode headless.
- Utile pour simplifier le code de communication.

### pyaudacity (asweigart/GitHub)

Idem — wrapper Python, même contrainte d'instance GUI active. Confirme que mod-script-pipe doit être activé manuellement.

### audacity-bridge (Witiko/GitHub) — confiance **moyenne**

Outil **shell** qui encapsule mod-script-pipe pour l'intégration dans des Makefile et scripts shell. Gère le démarrage/arrêt automatique d'Audacity.

**Limitations documentées par l'auteur lui-même :**
- Crash d'Audacity sur Linux à la commande `Exit` (contourné en interne)
- Perte silencieuse de messages pendant le splash screen (contourné par un sleep fixe)
- Incapacité à détecter les dialogues modaux bloquants
- Projet sans versioning strict, maintenance communautaire

→ **Fragile pour un usage en production critique.**

### CLI-Anything Audacity (HKUDS/GitHub) — **écarté**

Se présente comme un CLI headless pour Audacity. En réalité : **n'appelle pas Audacity du tout**. C'est un CLI Python standalone qui réimplémente basiquement compression et normalize en pur Python (boucle sample-par-sample, sans lookahead, sans enveloppe attack/release réelle). Exemple de leur implémentation du compressor :

```python
for s in samples:
    if abs(s) > threshold:
        excess = abs(s) - threshold
        compressed = threshold + excess / ratio
        result.append(compressed if s > 0 else -compressed)
    else:
        result.append(s)
```

→ **Même problème que ffmpeg : ne reproduit pas le DRC natif d'Audacity.**

---

## Pourquoi ffmpeg ne peut pas reproduire le DRC d'Audacity

Le compresseur DRC d'Audacity 3.3+ (nouveau Dynamic Range Compressor) possède deux paramètres absents de `acompressor` ffmpeg :

| Paramètre | Audacity DRC | ffmpeg acompressor |
|-----------|-------------|-------------------|
| `lookaheadMs` | ✓ (ex. 40ms pour Bass Guitar) | ✗ absent |
| `makeupGainDb` | ✓ (gain de compensation post-compression) | ✗ pas d'équivalent direct |

Source documentée : `docs/audacity-presets/compressor.md` (tiré de `DynamicRangeProcessorUtils.h` dans le code source Audacity).

Le `lookaheadMs` permet au compresseur de "voir" le signal à venir avant de l'appliquer — c'est ce qui donne ce son caractéristique sur les transitoires que ffmpeg ne peut pas reproduire à paramètres identiques.

---

## Alternatives CLI natives (pour des pipelines sans GUI)

Pour des traitements batch **vraiment headless** (serveur, CI/CD, sans Audacity installé) :

| Besoin | Outil | Commande type |
|--------|-------|---------------|
| Normalisation EBU R128 | **ffmpeg-normalize** | `ffmpeg-normalize input.wav -o output.wav` |
| Rééchantillonnage | **SoX** | `sox input.wav output.wav rate 16k` |
| Conversion de format | **SoX** | `sox input.wav output.mp3` |

Ces outils sont de vrais CLI, sans dépendance GUI, intégrables directement dans des scripts cron ou des pipelines CI/CD.

**Limitation importante** : ces outils ne reproduisent pas le DRC d'Audacity. Ils sont adaptés pour de la normalisation standard (peak, LUFS) mais pas pour le traitement qualitatif que l'on cherche à automatiser ici.

---

## Contraintes connues d'Audacity en mode scripté

1. **Pas de mode headless sur Linux** — nécessite un serveur X (X11 ou Wayland). Xvfb (virtual framebuffer) est théoriquement possible mais non documenté de façon fiable avec mod-script-pipe.
2. **mod-script-pipe varie selon la distribution** — les builds AppImage Linux peuvent ne pas l'inclure. Les packages `.deb` officiels et les Flatpak l'incluent.
3. **Flatpak** — le pipe reste dans `/tmp` du host (partagé avec le Flatpak), les chemins standards fonctionnent.
4. **Aucune roadmap headless** — aucune issue ou PR officielle Audacity ne mentionne l'ajout d'un mode CLI sans GUI (état 2025).

---

## Questions ouvertes non résolues

- **Xvfb** : permet-il de faire tourner Audacity 3.7.7 Flatpak de façon fiable sur un serveur Linux sans écran avec mod-script-pipe ? Non testé.
- **Forks (Tenacity, etc.)** : ont-ils introduit un vrai mode CLI ? Non investigué.
- **Nom exact de la commande DRC 3.x** : résolu — `Compressor:` (testé sur 3.7.7 Flatpak). `DynamicRangeCompressor:` est un faux-ami : accepté sans erreur, sans effet.
- **Performances batch** : temps de traitement Audacity (via pipe) vs ffmpeg sur des centaines de fichiers — non mesuré.

---

## Sources primaires

- [Manuel Audacity — Scripting](https://manual.audacityteam.org/man/scripting.html)
- [mod-script-pipe docs (JamesCrook)](https://github.com/JamesCrook/TeamTools/blob/master/docs/Mod-Script-Pipe.md)
- [audacity/audacity — pipeclient.py](https://github.com/audacity/audacity)
- [audacity-bridge (Witiko)](https://github.com/Witiko/audacity-bridge)
- [pyaudacity (asweigart)](https://github.com/asweigart/pyaudacity)
- [audacity-scripting (PyPI)](https://pypi.org/project/audacity-scripting/)
- [ffmpeg-normalize (slhck)](https://github.com/slhck/ffmpeg-normalize)
- [hotelexistence.ca — Python batch processing Audacity](https://www.hotelexistence.ca/audacity-python-batch-processing/)
- [Forum Audacity — Run Audacity without GUI](https://forum.audacityteam.org/t/run-audacity-without-gui/38971)
- [Forum Audacity — Headless Linux](https://forum.audacityteam.org/t/using-audacity-on-headless-linux-boxes/29916)
