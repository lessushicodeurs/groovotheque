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
- `cache/` — fichiers dérivés des grooves, refaits tout seuls si on les efface (voir « Cache »)
- `public/` — frontend statique (HTML/CSS/JS, pas de build)
- `.auth` — credentials Basic Auth (`user:password`, un par ligne)
- `soundfonts/` — soundfonts téléchargés (ignoré par git, voir « Configuration »)
- `config.json` — configuration locale (ignoré par git, voir « Configuration »)

## Cache

`cache/` reprend l'arborescence de `grooves/` et ne contient que des fichiers **dérivés** : le
supprimer ne perd rien, tout se refait à l'ouverture suivante des grooves concernés. Il est
ignoré par git et jamais déployé.

| Contenu | Chemin | Fait quand |
|---|---|---|
| Peaks des waveforms | `<groove>/<piste>.peaks.json` | À la première lecture d'une piste |
| Empreinte des rendus MIDI | `<groove>/midi/fingerprint.json` | Au rendu d'une piste MIDI ; c'est elle qui périme les `midi-*.flac` quand le `.gp` ou le soundfont change |
| Copies recalables des pistes | `<groove>/seekable/<piste>.flac` | À l'ouverture d'un groove contenant des MP3 ou un backing track |

> **Copies recalables : le cache pèse environ deux fois les fichiers source.** Chrome ne rejoint
> pas la position demandée dans un MP3 à débit variable — il passe par la table Xing, trop
> grossière, et manque sa cible de plusieurs centaines de millisecondes, d'une valeur différente
> selon l'endroit visé. Le backing track embarqué dans un `.gp` est de l'AAC, dont l'amorce est
> oubliée après un seek (+47,9 ms constants). Les deux ne jouent donc plus ensemble dès qu'on ne
> part pas du début, ni à chaque rebond de boucle. Le player garde donc en cache une copie FLAC
> de ces pistes et la lit à leur place ; les fichiers du dossier ne sont pas touchés et restent
> ce qui s'affiche, se télécharge et part dans le zip. Sur un morceau de 4 min 42 à six pistes :
> 10 s de conversion à la première ouverture, 72 Mo de cache pour 34 Mo de source.
> Le `.wav`, le `.flac` et l'`.ogg` se calent déjà juste et ne sont pas copiés.
> Mesures et options écartées dans [docs/3. adr/calage-des-pistes-au-seek.md](docs/3.%20adr/calage-des-pistes-au-seek.md).

> **Le mobile lit les copies, il n'en fabrique pas.** Décoder, encoder et déposer plusieurs
> dizaines de mégaoctets est un travail de poste fixe. Un groove ouvert seulement depuis un
> téléphone garde donc le décalage au seek jusqu'à ce qu'un desktop l'ouvre une fois.

## Configuration — `config.json`

Fichier local ignoré par git, facultatif. Sans lui le projet tourne sur ses valeurs par
défaut. Le créer depuis le modèle suivi :

```bash
cp config.example.json config.json
```

| Clé | Rôle | Défaut |
|---|---|---|
| `soundFont` | Soundfont du player (nom de fichier ou chemin absolu) | `MuseScore_General.sf3` |

`config.example.json` documente les valeurs acceptées et leurs compromis directement dans
le fichier : JSON n'ayant pas de commentaires, les clés commençant par `_` en tiennent lieu
et sont ignorées par le serveur.

Le serveur relit `config.json` à chaque requête : modifier la valeur et recharger la page
suffit, pas besoin de redémarrer.

La variable d'environnement `GROOVOTHEQUE_CONFIG` déplace ce fichier, pour faire tourner
une instance sur une autre configuration sans toucher à celle du dépôt.

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

> **Conversion mono, obligatoire.** AlphaTab ne charge que les samples *mono*
> (`sampleType & 1`) : il écarte les samples stéréo… mais garde les régions qui les
> référencent. Ces régions lisent alors hors d'un tableau vide et produisent des `NaN`.
> Comme `NaN × 0 = NaN`, **une seule piste fautive, même à volume nul, anéantit le rendu
> de toutes les autres** — et la voix ne s'éteint jamais, elle pollue jusqu'à la fin du
> morceau. Converti en entiers 16 bits, le `NaN` donne 0 : silence complet.
> MuseScore_General compte 146 samples stéréo sur 1246 (11,7 %), soit 4 presets de piano
> entièrement muets (Grand Piano, Bright Grand, Honky-Tonk, Mellow Grand) et 31 partiels.
>
> `scripts/fetch-soundfont.sh` règle le problème à l'installation en repassant tous les
> samples en mono (`scripts/sf-mono.js`) : 2 octets réécrits par sample dans le chunk
> `shdr`, **aucune donnée audio touchée**, ~1 s pour 38 Mo. Chaque moitié d'une paire
> stéréo devient une voix mono panoramiquée par sa région : le timbre est conservé.
> Résultat : 309 presets intacts, 0 partiel, 0 muet.
>
> Un soundfont déposé à la main doit y passer aussi :
> ```bash
> node scripts/sf-mono.js --check soundfonts/<fichier>   # compte les samples stéréo
> node scripts/sf-mono.js soundfonts/<fichier>           # convertit sur place
> ```
> Le serveur détecte le cas au démarrage et le signale dans ses logs
> (« contient N sample(s) stéréo »).

> **Une piste est isolée par son canal MIDI, pas par son index.** `AudioExportOptions.trackVolume`
> est indexé par piste, mais AlphaTab le retraduit en canaux juste avant l'export. Deux
> pistes sur le même canal écrivent donc dans la même case, et la dernière gagne — or
> **toutes les pistes de percussion d'un fichier Guitar Pro sont sur le canal 10**, que la
> norme General MIDI réserve à la batterie. Sans précaution, isoler une percussion donne
> soit un rendu muet (une piste suivante remet le canal à zéro), soit un rendu contenant
> toutes les percussions mélangées. Le rendu déplace donc, le temps de l'export, les pistes
> qui partagent le canal de la piste visée vers des canaux libres : elles sont à volume nul,
> le timbre qu'elles y prennent est sans effet. La piste visée, elle, ne bouge pas — le
> canal 10 porte le kit de batterie du soundfont.
>
> **Fuite du métronome.** Même mécanisme, autre symptôme : `AlphaSynthAudioExporter`
> initialise son canal de métronome sur le canal 17 (indice 16) puis relit le volume voulu
> par `channelGetMixVolume(16)`. Sur un score assez fourni pour que ce canal appartienne à
> une vraie piste, l'isoler y posait 1,0 et rallumait le clic malgré `metronomeVolume: 0`.
> La piste visée est donc écartée de ce canal avant l'export : un canal MIDI ordinaire ne
> porte aucun timbre en propre, banque et programme étant réémis pour chaque canal.
> Détails dans `public/js/midi-render.js`.

> **Un seul soundfont à la fois.** AlphaTab sait empiler plusieurs banques (la dernière
> chargée l'emporte en cas de collision banque/preset), mais `config.json` n'expose qu'une
> valeur : la superposition n'a pas d'usage identifié ici, et une clé unique garde
> l'empreinte d'invalidation des rendus simple.

> **Changer de soundfont périme les rendus MIDI.** Le soundfont retenu entre dans
> l'empreinte des rendus, à côté de la taille et de la date du fichier Guitar Pro : les
> `midi-*.flac` du dossier sont effacés et refaits à l'ouverture suivante du groove.
> L'empreinte retient son nom, sa taille **et son nombre de samples stéréo** — la
> conversion mono ne change pas la taille du fichier, elle serait passée inaperçue.
> Un compteur de version du moteur de rendu (`MIDI_RENDER_VERSION`, dans `server.js`)
> complète l'empreinte : l'incrémenter périme tous les rendus existants, ce qu'il faut
> faire dès qu'un changement modifie le son produit à `.gp` et soundfont identiques.
> C'est le cas du niveau de sortie : le rendu applique `masterVolume: 0.5` et non 1,0,
> qui écrêtait (la piste Drums de *Babooshka* sortait à +2,1 dBFS ; elle est à −3,9 dBFS
> maintenant, et le volume de piste du player rattrape la différence). C'est le cas aussi
> de l'isolation par canal (version 3).

## Scripts

Tous les scripts sont dans `scripts/`.

| Script | Rôle |
|---|---|
| `setup.sh` | Installe les dépendances système du pipeline audio |
| `fetch-soundfont.sh` | Télécharge un soundfont MuseScore_General dans `soundfonts/` et le repasse en mono |
| `sf-mono.js` | Repasse en mono les samples stéréo d'un soundfont SF2/SF3 (`--check` pour compter) |
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
