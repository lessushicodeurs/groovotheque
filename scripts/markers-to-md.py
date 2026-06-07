#!/usr/bin/env python3
"""
markers-to-md.py — injecte la structure (marqueurs) d'un groove dans son fichier .md

Usage:
    python3 scripts/markers-to-md.py <chemin/du/groove>

Comportement :
  - Si le .md est vide ou absent  → crée/écrit "# <nom du groove>" puis la section Structure
  - Si ## Structure existe déjà   → la remplace
  - Sinon                         → l'ajoute en fin de fichier
"""

import sys, re, json
from pathlib import Path


def fmt_time(sec):
    sec = round(sec)
    m, s = divmod(sec, 60)
    return f'{m}:{s:02d}'


def fmt_dur(sec):
    sec = round(sec)
    m, s = divmod(sec, 60)
    return f'{m}:{s:02d}' if m else f'{s}s'


def groove_name(path: Path) -> str:
    return path.name.replace('_', ' ')


def build_structure_block(markers: list) -> str:
    rows = '\n'.join(
        f"| {m['label']} | {fmt_time(m['in'])} | {fmt_time(m['out'])} | {fmt_dur(m['out'] - m['in'])} |"
        for m in sorted(markers, key=lambda m: m['in'])
    )
    return (
        '## Structure\n\n'
        '| Section | IN | OUT | Durée |\n'
        '|---|---|---|---|\n'
        f'{rows}'
    )


def main():
    if len(sys.argv) < 2:
        print('Usage: markers-to-md.py <groove_dir>', file=sys.stderr)
        sys.exit(1)

    groove_dir = Path(sys.argv[1]).resolve()

    if not groove_dir.is_dir():
        print(f'Dossier introuvable : {groove_dir}', file=sys.stderr)
        sys.exit(1)

    mix_path = groove_dir / 'mix.json'
    if not mix_path.exists():
        print(f'Pas de mix.json dans {groove_dir}', file=sys.stderr)
        sys.exit(1)

    with open(mix_path, encoding='utf-8') as f:
        mix = json.load(f)

    markers = mix.get('markers', [])
    if not markers:
        print('Aucun marqueur dans ce mix.json', file=sys.stderr)
        sys.exit(1)

    name   = groove_name(groove_dir)
    block  = build_structure_block(markers)

    md_files = list(groove_dir.glob('*.md'))
    md_path  = md_files[0] if md_files else groove_dir / f'{groove_dir.name}.md'
    content  = md_path.read_text(encoding='utf-8') if md_path.exists() else ''

    if not content.strip():
        content = f'# {name}\n\n{block}\n'
    elif re.search(r'^## Structure\b', content, re.MULTILINE):
        content = re.sub(
            r'^## Structure\b.*?(?=^##|\Z)',
            block + '\n\n',
            content,
            flags=re.MULTILINE | re.DOTALL,
        )
    else:
        content = content.rstrip('\n') + '\n\n' + block + '\n'

    md_path.write_text(content, encoding='utf-8')
    print(f'→ {md_path}\n')
    print(block)


if __name__ == '__main__':
    main()
