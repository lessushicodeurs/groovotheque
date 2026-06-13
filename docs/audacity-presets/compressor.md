# Presets du compresseur Audacity

Source : [DynamicRangeProcessorUtils.h](https://github.com/audacity/audacity/blob/master/au3/libraries/au3-dynamic-range-processor/DynamicRangeProcessorUtils.h)

Paramètres FFmpeg correspondants : `acompressor=threshold=<threshold>dB:ratio=<ratio>:attack=<attack>:release=<release>:knee=<knee>dB`

> `lookaheadMs` et `makeupGainDb` n'ont pas d'équivalent direct dans `acompressor` de FFmpeg.

---

## Général

| Preset | threshold | ratio | attack (ms) | release (ms) | knee (dB) | makeup (dB) | lookahead (ms) |
|---|---|---|---|---|---|---|---|
| Modern | -14 | 4 | 0.2 | 210 | 18 | 0 | 1 |
| Glue Compressor | -22 | 1.2 | 20 | 1000 | 12 | 2.5 | 1 |
| Gentle | -18 | 1.5 | 1 | 100 | 6 | 0 | 1 |
| Beat Booster | -18 | 4 | 14 | 9 | 1 | 3 | 1 |

## Mastering

| Preset | threshold | ratio | attack (ms) | release (ms) | knee (dB) | makeup (dB) | lookahead (ms) |
|---|---|---|---|---|---|---|---|
| Deep Dive Master | -23.5 | 1.2 | 52.2 | 12.2 | 1 | 1.6 | 33.2 |
| Beefy Master | -16.8 | 1.2 | 49.6 | 17.9 | 4.9 | 2.5 | 100 |
| Make It Right Master | -6.5 | 1.4 | 1 | 1 | 1 | 1.6 | 10 |
| Brick Wall Master | -10 | 100 | 0 | 2 | 2 | 3 | 1 |

## Voix

| Preset | threshold | ratio | attack (ms) | release (ms) | knee (dB) | makeup (dB) | lookahead (ms) |
|---|---|---|---|---|---|---|---|
| Lead Vocals | -14 | 5.2 | 1 | 60 | 5.5 | 0 | 1 |
| Fat Vocals | -32 | 1.7 | 86.9 | 15.2 | 5 | 2.5 | 1 |
| Power Vocals | -16.8 | 1.5 | 2.8 | 356.3 | 19.6 | 3 | 46.2 |
| Vocal Control | -15 | 3 | 0 | 196 | 23.5 | 4.5 | 1 |
| Vocal Touch-Up | -22 | 1.5 | 2 | 450 | 30 | 3.6 | 0 |
| Voice Memos Balancer | -22.3 | 10.1 | 6.5 | 3.6 | 5.8 | 4.5 | 1 |
| Podcast/Radio | -15 | 3 | 15 | 40 | 24 | 1 | 1 |

## Instruments

| Preset | threshold | ratio | attack (ms) | release (ms) | knee (dB) | makeup (dB) | lookahead (ms) |
|---|---|---|---|---|---|---|---|
| Piano | -16 | 2 | 0.2 | 150 | 18 | 1 | 1 |
| Acoustic Guitar | -15 | 2.5 | 15 | 225 | 8 | 1.5 | 1 |
| Bass Guitar | -13 | 3 | 1 | 50 | 2 | 0 | 40 |
| Strings | -15 | 1.8 | 30 | 400 | 14.3 | 2.5 | 1 |
| Kick Drums | -14 | 4 | 30 | 120 | 0.5 | 2 | 1 |
| Drums Control | -12 | 2 | 2 | 40 | 29 | 1 | 1 |

## SFX

| Preset | threshold | ratio | attack (ms) | release (ms) | knee (dB) | makeup (dB) | lookahead (ms) |
|---|---|---|---|---|---|---|---|
| Climax Impulser SFX | -55.1 | 23.4 | 172 | 813.4 | 27.4 | 0 | 0 |
| Engine Breathing SFX | -37.7 | 4.7 | 190.2 | 0.2 | 3.5 | 0 | 2.3 |
| Great Impact SFX | -49.3 | 24.6 | 172 | 562.6 | 5 | 8.3 | 0.6 |
| Great Body SFX | -32.8 | 2.4 | 74.6 | 204.8 | 0.3 | 8.6 | 29.3 |
| Great Tail SFX | -55.4 | 2.4 | 1.4 | 199.6 | 0.3 | 23.9 | 0 |
| Smack Explosion SFX | -32.5 | 5.9 | 155.5 | 1.7 | 24.4 | 7.1 | 1.3 |
