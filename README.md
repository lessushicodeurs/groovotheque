# Groovotheque

Lecteur multipiste web pour sessions d'enregistrement.

## Démarrage local

```bash
npm install
htpasswd -B -c .auth musicien   # crée .auth avec un premier utilisateur
htpasswd -B .auth admin          # ajoute un utilisateur supplémentaire
node server.js
```

Ouvrir http://localhost:3099

## Structure

- `grooves/` — dossiers déposés par FTP (un sous-dossier = un titre)
- `cache/` — peaks JSON générés côté client et mis en cache
- `public/` — frontend statique (HTML/CSS/JS, pas de build)
- `.auth` — credentials Basic Auth (`user:password`, un par ligne)
- `soundfonts/` — soundfonts téléchargés (ignoré par git, voir « Configuration »)
- `config.json` — configuration locale (ignoré par git, voir « Configuration »)

## Configuration — `config.json`

Fichier local ignoré par git, facultatif. Sans lui le projet tourne sur ses valeurs par
défaut. Le créer depuis le modèle suivi :

```bash
cp config.example.json config.json
```

| Clé | Rôle | Défaut |
|---|---|---|
| `soundFont` | Soundfont du player (nom de fichier ou chemin absolu) | `MuseScore_General.sf3` |

Le serveur relit `config.json` à chaque requête : modifier la valeur et recharger la page
suffit, pas besoin de redémarrer.

### Soundfont

Le soundfont est la banque de sons qui donne leur timbre aux pistes MIDI. Il sert à la fois
au **rendu audio** des pistes MIDI (epic 39) et à la **lecture directe** du synthétiseur sur
un groove sans piste audio : une seule valeur pour les deux.

Le fichier est cherché dans `soundfonts/` (ignoré par git), puis parmi ceux livrés avec
AlphaTab dans `node_modules/@coderline/alphatab/dist/soundfont/`. **Introuvable, le serveur
retombe sur `sonivox.sf2`** en le signalant dans ses logs : un clone frais est fonctionnel
sans aucune étape manuelle, seulement en moins bon son.

| Valeur | Taille | Format | Licence | Avantages / inconvénients |
|---|---|---|---|---|
| `MuseScore_General.sf3` *(défaut)* | 39 900 972 o (38 Mio) | SF3, samples Vorbis décodés nativement par AlphaTab | MIT (S. Christian Collins, d'après FluidR3Mono / FluidR3 de Frank Wen) | La meilleure qualité des quatre, pour un poids de fichier raisonnable grâce à la compression. À télécharger. **Voir la réserve ci-dessous : quelques presets sortent muets** |
| `MuseScore_General.sf2` | ~206 Mo | SF2, PCM non compressé | MIT (idem) | Même banque, samples non compressés : chargement sans décodage, mais 206 Mo à télécharger et à tenir en mémoire. Rarement justifié |
| `sonivox.sf2` *(repli)* | 1 351 896 o (1,29 Mio) | SF2, PCM non compressé | Apache 2.0 (Sonic Network Inc.) | Livré avec AlphaTab, rien à télécharger, chargement instantané. C'est le soundfont embarqué d'Android : qualité faible, timbres très synthétiques |
| `sonivox.sf3` | 977 208 o (954 Kio) | SF3, samples Vorbis | Apache 2.0 (idem) | Même banque que ci-dessus en plus léger. Même qualité faible |
| *n'importe quel `.sf2` / `.sf3`* | — | — | — | Déposer le fichier dans `soundfonts/` et mettre son nom dans `config.json`. Un chemin absolu est également accepté |

Télécharger le soundfont par défaut :

```bash
scripts/fetch-soundfont.sh          # MuseScore_General.sf3 (38 Mo)
scripts/fetch-soundfont.sh musescore-hq   # MuseScore_General.sf2 (206 Mo)
```

> **Réserve sur MuseScore_General.** AlphaTab ne charge que les samples *mono*
> (`sampleType & 1`) : il ignore les samples stéréo liés, en clair dans ses logs
> (« Skipping load of unsupported sample … sample type 18/20 is not supported »).
> Sur MuseScore_General cela touche les pianos, qui restent audibles grâce à leurs
> autres samples — mais certains presets peuvent sortir **complètement muets**.
> Constaté : la piste « Electric Guitar » de *Kate Bush — Babooshka* rend un signal nul
> avec MuseScore_General, alors qu'elle sonne avec `sonivox.sf2`. Le rendu muet n'est pas
> sauvegardé : la ligne garde son bouton « Réessayer le rendu en audio » et le message
> l'explique. En cas de piste muette, essayer `sonivox.sf2`.

> **Un seul soundfont à la fois.** AlphaTab sait empiler plusieurs banques (la dernière
> chargée l'emporte en cas de collision banque/preset), mais `config.json` n'expose qu'une
> valeur : la superposition n'a pas d'usage identifié ici, et une clé unique garde
> l'empreinte d'invalidation des rendus simple.

> **Changer de soundfont périme les rendus MIDI.** Le soundfont retenu entre dans
> l'empreinte des rendus, à côté de la taille et de la date du fichier Guitar Pro : les
> `midi-*.flac` du dossier sont effacés et refaits à l'ouverture suivante du groove.

## Scripts

Tous les scripts sont dans `scripts/`.

| Script | Rôle |
|---|---|
| `setup.sh` | Installe les dépendances système du pipeline audio |
| `fetch-soundfont.sh` | Télécharge un soundfont MuseScore_General dans `soundfonts/` |
| `restart-server.sh` | Redémarre le serveur Node.js |
| `process-rehearsal.sh` | Pipeline de traitement audio (découpe, normalisation, export) |
| `strip-parent-prefix.sh` | Supprime le préfixe parent des sous-dossiers de grooves |
| `markers-to-md.py` | Injecte la section Structure (marqueurs + BPM) dans le .md d'un groove |

> **Audacity 3.x requis.** `process-rehearsal.sh` pilote Audacity par `mod-script-pipe`,
> supprimé dans Audacity 4.0 et sans remplacement. Garder une instance 3.x et geler sa
> mise à jour : `flatpak mask org.audacityteam.Audacity`.
> Détails dans [scripts/README.md](scripts/README.md).

> **Config locale.** `process-rehearsal.sh` lit `scripts/process-rehearsal.yaml`, ignoré par
> git. Le créer depuis le modèle suivi :
> `cp scripts/process-rehearsal.yaml.example scripts/process-rehearsal.yaml`

## Licence

[AGPL v3](LICENSE) — libre d'utiliser, modifier et redistribuer, à condition de publier tes modifications sous la même licence (y compris si tu en fais un service en ligne).

Ce projet est personnel, sans support ni suivi de demandes. Les PR ne sont pas acceptées.
