#!/usr/bin/env bash
# 001-notes-md.sh — Renomme la fiche BPM de chaque groove en notes.md
# Usage: ./scripts/migrate.sh [--dry-run]   (ne pas lancer directement)
#
# Depuis l'epic 31, la fiche d'un groove porte le nom fixe `notes.md`.
# Historiquement elle portait le nom du dossier — et parfois un nom décorrélé,
# séquelle de scripts/strip-parent-prefix.sh. Cette migration renomme l'unique
# `*.md` de chaque dossier de groove en `notes.md`, quel que soit son nom.
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✗${RESET}  $*" >&2; }
die()  { err "$*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Racine parcourue — surchargeable via GROOVES_DIR (utilisée par les tests)
GROOVES_DIR="${GROOVES_DIR:-$ROOT_DIR/grooves}"
DRY_RUN="${DRY_RUN:-0}"

[[ -d "$GROOVES_DIR" ]] || die "Dossier introuvable : $GROOVES_DIR"

# Critère identique à scripts/deploy-grooves.sh : un dossier est un groove s'il
# contient directement au moins un fichier audio ou Guitar Pro.
is_groove() {
  local dir="$1"
  find -H "$dir" -maxdepth 1 -type f \( \
    -name "*.mp3" -o -name "*.wav" -o -name "*.flac" -o -name "*.ogg" \
    -o -name "*.gp" -o -name "*.gpx" -o -name "*.gp5" -o -name "*.gp4" -o -name "*.gp8" \
  \) -print -quit | grep -q .
}

# grooves/ est un lien symbolique vers les vraies données : -H le fait suivre
# pour l'argument de ligne de commande uniquement.

# Un composant du chemin finissant par ~ marque une corbeille (ignorée côté serveur)
is_trash() {
  local rel="$1"
  local part
  local IFS='/'
  for part in $rel; do
    [[ "$part" == *~ ]] && return 0
  done
  return 1
}

echo -e "${BOLD}Racine parcourue :${RESET} $GROOVES_DIR"
[[ "$DRY_RUN" -eq 1 ]] && echo -e "${YELLOW}Mode dry-run — aucun renommage effectué${RESET}"
echo

MIGRATED=0
ALREADY=0
AMBIGUOUS=0
TRASH=0
EMPTY=0

mapfile -d '' GROOVE_DIRS < <(find -H "$GROOVES_DIR" -mindepth 1 -type d -print0 | sort -z)

for dir in "${GROOVE_DIRS[@]}"; do
  [[ -n "$dir" ]] || continue
  is_groove "$dir" || continue

  rel="${dir#"$GROOVES_DIR"/}"

  if is_trash "$rel"; then
    TRASH=$((TRASH + 1))
    continue
  fi

  mapfile -d '' MD_FILES < <(find -H "$dir" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

  if [[ -f "$dir/notes.md" ]]; then
    ALREADY=$((ALREADY + 1))
    continue
  fi

  case ${#MD_FILES[@]} in
    0)
      EMPTY=$((EMPTY + 1))
      ;;
    1)
      src="${MD_FILES[0]}"
      name="$(basename "$src")"
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo -e "  ${CYAN}→${RESET} $rel/$name  ➜  notes.md"
      else
        mv "$src" "$dir/notes.md"
        ok "$rel/$name  →  notes.md"
      fi
      MIGRATED=$((MIGRATED + 1))
      ;;
    *)
      names=()
      for f in "${MD_FILES[@]}"; do names+=("$(basename "$f")"); done
      warn "Plusieurs fiches dans $rel — décision humaine requise : ${names[*]}"
      AMBIGUOUS=$((AMBIGUOUS + 1))
      ;;
  esac
done

echo
echo -e "${BOLD}Résultat :${RESET} $MIGRATED migré(s), $ALREADY déjà en notes.md, $AMBIGUOUS ambigu(s), $EMPTY sans fiche, $TRASH en corbeille (composant de chemin finissant par ~, ignoré)"

# Nombre d'éléments traités, remonté au runner
[[ -n "${MIGRATION_RESULT_FILE:-}" ]] && echo "$MIGRATED" > "$MIGRATION_RESULT_FILE"

exit 0
