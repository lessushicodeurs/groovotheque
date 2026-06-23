#!/usr/bin/env python3
"""
markers-to-md.py — injecte la structure (marqueurs) d'un groove dans son fichier .md

Usage:
    python3 scripts/markers-to-md.py <chemin/du/groove> [options]

Options:
    --bpm BPM     BPM manuel (ex. --bpm 99)
    --skip N      exclure les N premières sections du calcul de BPM
                  (utile quand le début du fichier est un titre différent)

Comportement :
  - Si le .md est vide ou absent  → crée/écrit "# <nom du groove>" puis la section Structure
  - Si ## Structure existe déjà   → la remplace
  - Sinon                         → l'ajoute en fin de fichier
"""

import sys, re, json
from pathlib import Path


# ── Helpers temps ─────────────────────────────────────────────────────────────

def fmt_time(sec):
    sec = round(sec)
    m, s = divmod(sec, 60)
    return f'{m}:{s:02d}'


def fmt_dur(sec):
    sec = round(sec)
    m, s = divmod(sec, 60)
    return f'{m}:{s:02d}' if m else f'{s}s'


# ── Détection BPM ─────────────────────────────────────────────────────────────

def score_bpm(bpm, durations):
    """
    Erreur totale : somme des distances à l'entier le plus proche pour chaque section,
    en mesures de 4 temps. Pénalité légère sur les non-multiples de 2 pour orienter
    vers des phrases "carrées" (4, 8, 16, 32 mesures…).
    """
    beats_per_measure = 4
    total = 0.0
    for d in durations:
        m = d * bpm / (beats_per_measure * 60)
        r = round(m)
        frac = abs(m - r)
        if r > 0 and r % 2 != 0:   # non-multiple de 2 → léger malus
            frac += 0.08
        total += frac
    return total


def find_best_bpm(durations, bpm_min=60.0, bpm_max=220.0, step=0.1):
    best_bpm, best_score = bpm_min, float('inf')
    bpm = bpm_min
    while bpm <= bpm_max:
        s = score_bpm(bpm, durations)
        if s < best_score:
            best_score, best_bpm = s, bpm
        bpm = round(bpm + step, 1)
    return round(best_bpm, 1), best_score


def measures(duration_sec, bpm):
    return round(duration_sec * bpm / 240)   # 240 = 4 temps × 60


# ── Nom du groove ─────────────────────────────────────────────────────────────

def groove_name(path: Path) -> str:
    return path.name.replace('_', ' ')


# ── Construction du bloc markdown ─────────────────────────────────────────────

def build_structure_block(sorted_markers, bpm=None):
    labels = [m['label'] for m in sorted_markers]

    if bpm:
        data_rows = [
            ('Mesures', [str(measures(m['out'] - m['in'], bpm)) for m in sorted_markers]),
        ]
    else:
        data_rows = [
            ('IN',    [fmt_time(m['in'])             for m in sorted_markers]),
            ('OUT',   [fmt_time(m['out'])             for m in sorted_markers]),
            ('Durée', [fmt_dur(m['out'] - m['in'])   for m in sorted_markers]),
        ]

    all_rows = [['Section'] + labels] + [[name] + vals for name, vals in data_rows]
    widths   = [max(len(r[c]) for r in all_rows) for c in range(len(all_rows[0]))]
    widths   = [max(w, 3) for w in widths]

    def fmt_row(cells):
        return '| ' + ' | '.join(f'{c:<{widths[i]}}' for i, c in enumerate(cells)) + ' |'

    sep  = '|' + '|'.join('-' * (w + 2) for w in widths) + '|'
    lines = [fmt_row(all_rows[0]), sep] + [fmt_row(r) for r in all_rows[1:]]
    return '## Structure\n\n' + '\n'.join(lines) + '\n'


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    if not args:
        print('Usage: markers-to-md.py <groove_dir> [--bpm BPM] [--skip N]', file=sys.stderr)
        sys.exit(1)

    # Parse args
    groove_dir_arg = None
    bpm_arg  = None
    skip_arg = 0

    i = 0
    while i < len(args):
        if args[i] == '--bpm' and i + 1 < len(args):
            bpm_arg = float(args[i + 1]); i += 2
        elif args[i] == '--skip' and i + 1 < len(args):
            skip_arg = int(args[i + 1]); i += 2
        else:
            groove_dir_arg = args[i]; i += 1

    if not groove_dir_arg:
        print('Chemin du groove manquant.', file=sys.stderr)
        sys.exit(1)

    groove_dir = Path(groove_dir_arg).resolve()
    if not groove_dir.is_dir():
        print(f'Dossier introuvable : {groove_dir}', file=sys.stderr)
        sys.exit(1)

    markers_path = groove_dir / 'markers.json'
    if not markers_path.exists():
        print(f'Pas de markers.json dans {groove_dir}', file=sys.stderr)
        sys.exit(1)

    with open(markers_path, encoding='utf-8') as f:
        markers = json.load(f)

    if not markers:
        print('Aucun marqueur dans ce markers.json', file=sys.stderr)
        sys.exit(1)

    sorted_markers = sorted(markers, key=lambda m: m['in'])

    # Sections utilisées pour le calcul BPM (après skip)
    bpm_markers = sorted_markers[skip_arg:]
    if not bpm_markers:
        print(f'--skip {skip_arg} supprime toutes les sections, réduire la valeur.', file=sys.stderr)
        sys.exit(1)

    # BPM
    if bpm_arg:
        bpm = bpm_arg
        print(f'BPM fourni : {bpm}')
    else:
        durations = [m['out'] - m['in'] for m in bpm_markers]
        bpm, score = find_best_bpm(durations)
        n_used = len(bpm_markers)
        skipped_info = f' (sections 1-{skip_arg} ignorées)' if skip_arg else ''
        print(f'BPM détecté : {bpm}  [erreur={score:.3f}, {n_used} sections{skipped_info}]')

    # Construire et écrire le bloc
    name     = groove_name(groove_dir)
    block    = build_structure_block(sorted_markers, bpm)
    bpm_line = f'- {round(bpm)} bpm\n\n' if bpm else ''

    md_files = list(groove_dir.glob('*.md'))
    md_path  = md_files[0] if md_files else groove_dir / f'{groove_dir.name}.md'
    content  = md_path.read_text(encoding='utf-8') if md_path.exists() else ''

    if not content.strip():
        content = f'# {name}\n\n{bpm_line}{block}\n'
    elif re.search(r'^## Structure\b', content, re.MULTILINE):
        # Remplace aussi l'éventuelle ligne bpm déjà présente juste avant ## Structure
        content = re.sub(
            r'(?:- \d+(?:\.\d+)? bpm\n\n)?^## Structure\b.*?(?=^##|\Z)',
            bpm_line + block + '\n\n',
            content,
            flags=re.MULTILINE | re.DOTALL,
        )
    else:
        content = content.rstrip('\n') + '\n\n' + bpm_line + block + '\n'

    md_path.write_text(content, encoding='utf-8')
    print(f'→ {md_path}\n')
    print(block)


if __name__ == '__main__':
    main()
