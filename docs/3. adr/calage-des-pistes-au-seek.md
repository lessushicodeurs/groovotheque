# ADR — Calage des pistes au seek (copies recalables)

## Le défaut

Sur le groove `Ghismo/Tabs/The_Clark_Sisters_-_Ha_Ya`, le backing track embarqué dans le `.gp`
et les stems MP3 du dossier ne jouent pas ensemble. Le décalage n'apparaît pas quand la lecture
part du début : il survient dès qu'on démarre ailleurs, et donc aussi à chaque rebond de boucle,
qui passe par `seekAllTo()`.

## Ce que disent les mesures

Les fichiers eux-mêmes sont superposables : corrélation croisée entre la somme des quatre stems
et le backing, sur trois fenêtres (début, milieu, fin), **décalage = 1 échantillon (0,02 ms),
sans dérive**. Le défaut est donc dans l'application, pas dans le contenu.

Chaque format comparé, dans Chromium, à un WAV du même son (le WAV, lui, se rejoint au
sample près) :

| format | seek 0 s | 20 s | 90 s | 140,7 s |
|---|---|---|---|---|
| **MP3** (les stems) | 0 | −66,6 ms | **+369,1 ms** | −224,9 ms |
| **M4A/AAC** (le backing) | 0 | +47,9 ms | +47,9 ms | +47,9 ms |
| FLAC | 0 | −11,6 ms | 0 | 0 |
| OGG/Opus | −5,1 ms | +3,2 ms | +3,3 ms | +2,6 ms |

Deux causes distinctes, qui s'additionnent :

- **MP3 à débit variable.** Ces fichiers portent un en-tête Xing sans tag LAME. Chrome se cale
  via la table Xing : 100 entrées pour tout le fichier, soit environ une seconde d'audio par
  entrée sur un morceau de cinq minutes. L'erreur est de plusieurs centaines de millisecondes et
  **change selon l'endroit visé**. Les quatre stems partagent la même table : ils se trompent
  ensemble, ce qui fait entendre « le backing est décalé » alors que ce sont eux qui sautent.
- **AAC sans `elst`.** Le backing du `.gp` a 2112 échantillons d'amorce (`iTunSMPB`) et aucune
  table d'édition. Chrome les retire au démarrage à zéro, mais plus après un seek : **+47,9 ms,
  constants**.

Aucun réglage ne corrige cela : tant que le navigateur se cale lui-même dans du MP3 à débit
variable, l'erreur est là.

## Décision

Garder dans le cache une **copie FLAC** de chaque piste qui se cale mal, et la lire à la place de
l'originale.

- **Ce qui est converti** : les fichiers `.mp3` du dossier, et le backing track embarqué dans le
  `.gp` (sous le nom `_backing`, celui que le cache lui donne déjà pour ses peaks).
- **Ce qui ne l'est pas** : `.wav`, `.flac`, `.ogg` — ils se calent déjà juste, les mesures
  ci-dessus le montrent. Les rendus MIDI sont du FLAC : rien à faire pour eux non plus.
- **Où** : `cache/<groove>/seekable/<nom>.flac`, avec un `<nom>.json` portant la taille et la
  date de la source. Le dossier de l'utilisateur n'est jamais touché ; l'original reste ce qui
  s'affiche, se télécharge et part dans le zip.
- **Quand** : à l'ouverture du groove, en tâche de fond, une piste à la fois et après le rendu
  MIDI s'il tourne. La piste bascule sur sa copie dès qu'elle est prête, à la même position ;
  WaveSurfer garde son élément média, donc le routage Web Audio (gain, pan) survit.
- **Péremption** : une source dont la taille ou la date change périme sa copie, qui est refaite.

### Pourquoi pas autrement

- **Décoder en PCM dans le navigateur à chaque ouverture** (blob WAV passé à WaveSurfer) : même
  résultat au calage, sans serveur ni cache, mais ≈ 50 Mo de blob par piste (250 Mo sur ce
  groove) et un décodage à chaque ouverture. Écarté pour la mémoire, notamment sur mobile.
- **Réécrire la table Xing des MP3** : elle est intrinsèquement grossière (un octet par centième
  de fichier). Même parfaite, elle ne descend pas sous la demi-seconde d'erreur.
- **Ré-encoder en MP3 à débit constant** : perte de qualité sur une piste déjà compressée, pour
  un calage encore borné par la trame (26 ms).

## Résultat mesuré

Après conversion, sur les mêmes points de départ (0, 20, 60, 90, 140,7, 200, 260 s), écart entre
le backing et un stem : **0 échantillon**, sur toutes les fenêtres d'analyse.

Coût observé sur « Ha Ya » (4 min 42, six pistes) : **10 secondes** de conversion à la première
ouverture, **64 Mo** de cache pour 34 Mo de fichiers source.

## Ce que ça ne couvre pas

Une piste au format `.ogg` garde ses ±3 ms, et un FLAC ses ≤ 12 ms de trame : c'est en dessous du
seuil audible sur ce matériel, et aucune mesure ne justifie de les convertir.
