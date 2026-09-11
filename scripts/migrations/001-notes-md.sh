#!/usr/bin/env bash
# 001-notes-md.sh — Renomme la fiche BPM de chaque groove en notes.md
# Usage: ./scripts/migrate.sh [--dry-run]   (ne pas lancer directement)
#
# Depuis l'epic 31, la fiche d'un groove porte le nom fixe `notes.md`.
# Historiquement elle portait le nom du dossier — et parfois un nom décorrélé,
# séquelle de scripts/strip-parent-prefix.sh. Cette migration renomme l'unique
# `*.md` de chaque dossier de groove en `notes.md`, quel que soit son nom.
#
# Codes de sortie :
#   0  tout est traité — le runner enregistre la migration
#   1  au moins un renommage a échoué — des éléments ont pu être modifiés avant
#   2  des dossiers ambigus restent à trancher — migration volontairement non
#      enregistrée pour qu'on y revienne (liste dans le fichier des ambigus)
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

# Dossier d'état (registre, rapports). Fourni par le runner ; à défaut, calculé
# à côté des VRAIES données : GROOVES_DIR peut être un lien symbolique vers le
# dépôt principal, on résout donc le lien avant de remonter d'un cran.
if [[ -n "${MIGRATIONS_STATE_DIR:-}" ]]; then
  STATE_DIR="$MIGRATIONS_STATE_DIR"
else
  STATE_DIR="$(dirname "$(readlink -f "$GROOVES_DIR")")/cache"
fi
AMBIGUOUS_FILE="$STATE_DIR/001-notes-md-ambigus.txt"

MIGRATED=0
ALREADY=0
AMBIGUOUS=0
TRASH=0
EMPTY=0
FAILED=0

# Le nombre d'éléments traités doit toujours remonter au runner, y compris si le
# script s'arrête en cours de route : un renommage déjà fait reste fait.
report_result() {
  [[ -n "${MIGRATION_RESULT_FILE:-}" ]] && echo "$MIGRATED" > "$MIGRATION_RESULT_FILE"
  return 0
}
trap report_result EXIT

# Critère identique à scripts/deploy-grooves.sh : un dossier est un groove s'il
# contient directement au moins un fichier audio ou Guitar Pro.
# Duplication volontaire : deploy-grooves.sh n'est pas versionné (il contient la
# cible SSH), il ne peut donc pas être factorisé avec ce dépôt.
is_groove() {
  local dir="$1"
  find -H "$dir" -maxdepth 1 -type f \( \
    -name "*.mp3" -o -name "*.wav" -o -name "*.flac" -o -name "*.ogg" \
    -o -name "*.gp" -o -name "*.gpx" -o -name "*.gp5" -o -name "*.gp4" -o -name "*.gp8" \
  \) -print -quit | grep -q .
}

# Parcours calqué sur collect_local_grooves() de deploy-grooves.sh :
# - on s'arrête au premier niveau qui est un groove (pas de groove imbriqué) ;
# - le glob */ saute les dossiers cachés, comme le déploiement.
# Seule différence assumée : deploy-grooves.sh ignore d'emblée les dossiers dont
# le nom finit par ~ (corbeille) ; ici on y descend quand même, uniquement pour
# les compter, jamais pour y renommer quoi que ce soit.
# Émet des enregistrements "<0|1 corbeille>\t<chemin relatif>" séparés par \0.
collect_grooves() {
  local dir="$1" rel="$2" trash="$3"
  local subdir name subrel subtrash
  for subdir in "$dir"/*/; do
    [[ -d "$subdir" ]] || continue
    name="$(basename "$subdir")"
    subrel="${rel:+$rel/}$name"
    subtrash="$trash"
    [[ "$name" == *~ ]] && subtrash=1
    if is_groove "$subdir"; then
      printf '%s\t%s\0' "$subtrash" "$subrel"
    else
      collect_grooves "$subdir" "$subrel" "$subtrash"
    fi
  done
}

echo -e "${BOLD}Racine parcourue :${RESET} $GROOVES_DIR"
[[ "$DRY_RUN" -eq 1 ]] && echo -e "${YELLOW}Mode dry-run — aucun renommage effectué${RESET}"
echo

mapfile -d '' ENTRIES < <(collect_grooves "$GROOVES_DIR" "" 0 | sort -z)

AMBIGUOUS_LIST=()

for entry in "${ENTRIES[@]}"; do
  [[ -n "$entry" ]] || continue
  trash="${entry%%$'\t'*}"
  rel="${entry#*$'\t'}"
  dir="$GROOVES_DIR/$rel"

  if [[ "$trash" == "1" ]]; then
    TRASH=$((TRASH + 1))
    continue
  fi

  target="$dir/notes.md"

  # -e (et non -f) : un notes.md qui serait un répertoire ferait passer -f à faux
  # et `mv` déplacerait la fiche DANS ce répertoire.
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ -f "$target" ]]; then
      ALREADY=$((ALREADY + 1))
    else
      warn "notes.md n'est pas un fichier régulier dans $rel — décision humaine requise"
      AMBIGUOUS_LIST+=("$rel	notes.md n'est pas un fichier régulier")
      AMBIGUOUS=$((AMBIGUOUS + 1))
    fi
    continue
  fi

  mapfile -d '' MD_FILES < <(find -H "$dir" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

  case ${#MD_FILES[@]} in
    0)
      EMPTY=$((EMPTY + 1))
      ;;
    1)
      src="${MD_FILES[0]}"
      name="$(basename "$src")"
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo -e "  ${CYAN}→${RESET} $rel/$name  ➜  notes.md"
        MIGRATED=$((MIGRATED + 1))
      else
        # -n : ne jamais écraser une cible apparue entre-temps.
        # -T : la cible est le nouveau nom, jamais un répertoire de destination.
        # mv -n sort en 0 même quand il ne fait rien : on vérifie le résultat.
        if mv -n -T -- "$src" "$target" 2>/dev/null && [[ -f "$target" && ! -e "$src" ]]; then
          ok "$rel/$name  →  notes.md"
          MIGRATED=$((MIGRATED + 1))
        else
          err "Échec du renommage de $rel/$name en notes.md"
          FAILED=$((FAILED + 1))
          continue
        fi
      fi
      ;;
    *)
      names=()
      for f in "${MD_FILES[@]}"; do names+=("$(basename "$f")"); done
      warn "Plusieurs fiches dans $rel — décision humaine requise : ${names[*]}"
      AMBIGUOUS_LIST+=("$rel	${names[*]}")
      AMBIGUOUS=$((AMBIGUOUS + 1))
      ;;
  esac
done

echo
echo -e "${BOLD}Résultat :${RESET} $MIGRATED migré(s), $ALREADY déjà en notes.md, $AMBIGUOUS ambigu(s), $EMPTY sans fiche, $TRASH en corbeille (composant de chemin finissant par ~, ignoré)"
[[ $FAILED -gt 0 ]] && err "$FAILED renommage(s) en échec"

# Les ambigus doivent survivre à la sortie du script : sans trace écrite, ils se
# noient dans le flot et personne n'y revient.
if [[ "$DRY_RUN" -eq 1 ]]; then
  [[ $AMBIGUOUS -gt 0 ]] && warn "Dry-run — la liste des ambigus n'est pas écrite ($AMBIGUOUS_FILE)"
elif [[ $AMBIGUOUS -gt 0 ]]; then
  mkdir -p "$STATE_DIR"
  {
    echo "# Dossiers de grooves à trancher à la main — migration 001-notes-md"
    echo "# Généré le $(date --iso-8601=seconds)"
    echo "# Renommez la bonne fiche en notes.md, puis relancez ./scripts/migrate.sh"
    printf '%s\n' "${AMBIGUOUS_LIST[@]}"
  } > "$AMBIGUOUS_FILE"
  warn "Liste des ambigus écrite dans $AMBIGUOUS_FILE"
else
  rm -f "$AMBIGUOUS_FILE"
fi

[[ $FAILED -gt 0 ]] && exit 1
[[ $AMBIGUOUS -gt 0 ]] && exit 2
exit 0
