#!/usr/bin/env bash
# strip-parent-prefix.sh — Supprime le préfixe "nom_du_parent_-_" des sous-dossiers
# Usage: ./scripts/strip-parent-prefix.sh [--dry-run] <dossier>
#
# Ex: 260612-Répé-Set-1/260612-Répé-Set-1_-_01_-_Intro  →  260612-Répé-Set-1/01_-_Intro
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✗${RESET}  $*" >&2; }
die()  { err "$*"; exit 1; }

DRY_RUN=0
TARGET_DIR=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *)         TARGET_DIR="$arg" ;;
  esac
done

[[ -z "$TARGET_DIR" ]] && die "Usage: $0 [--dry-run] <dossier>"
[[ -d "$TARGET_DIR" ]] || die "Dossier introuvable : $TARGET_DIR"

TARGET_DIR="$(realpath "$TARGET_DIR")"
PARENT_NAME="$(basename "$TARGET_DIR")"

echo -e "${BOLD}Dossier cible :${RESET} $TARGET_DIR"
echo -e "${BOLD}Préfixe à supprimer :${RESET} ${PARENT_NAME}_-_"
[[ $DRY_RUN -eq 1 ]] && echo -e "${YELLOW}Mode dry-run — aucun renommage effectué${RESET}"
echo

RENAMED=0
SKIPPED=0

while IFS= read -r -d '' entry; do
  name="$(basename "$entry")"

  # Le nom doit commencer par PARENT_NAME suivi de _-_ ou _ ou -
  # On cherche le préfixe exact PARENT_NAME puis un séparateur (_-_, _, -)
  stripped=""
  for sep in "_-_" "_" "-"; do
    prefix="${PARENT_NAME}${sep}"
    if [[ "$name" == "$prefix"* ]]; then
      stripped="${name#"$prefix"}"
      # Trim underscores/tirets en tête
      stripped="${stripped#_}"
      stripped="${stripped#-}"
      break
    fi
  done

  if [[ -z "$stripped" ]] || [[ "$stripped" == "$name" ]]; then
    warn "Ignoré (pas de préfixe correspondant) : $name"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  dest="$(dirname "$entry")/$stripped"

  if [[ -e "$dest" ]]; then
    err "Destination déjà existante, ignoré : $stripped"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    echo -e "  ${CYAN}→${RESET} $name  ➜  $stripped"
  else
    mv "$entry" "$dest"
    ok "$name  →  $stripped"
  fi
  RENAMED=$((RENAMED + 1))

done < <(find "$TARGET_DIR" -maxdepth 1 -mindepth 1 -type d -print0 | sort -z)

echo
echo -e "${BOLD}Résultat :${RESET} $RENAMED renommé(s), $SKIPPED ignoré(s)"
