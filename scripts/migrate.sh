#!/usr/bin/env bash
# migrate.sh — Applique les migrations de données non encore enregistrées
# Usage: ./scripts/migrate.sh [--dry-run]
#
# Les migrations vivent dans scripts/migrations/<id>.sh et sont appliquées dans
# l'ordre croissant de leur nom. Le registre migrations.json (hors git) mémorise
# les migrations déjà appliquées : id, date ISO, nombre d'éléments traités.
# Il est rangé à côté des VRAIES données, pas dans le worktree courant.
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✗${RESET}  $*" >&2; }
die()  { err "$*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

# Racine des données parcourues par les migrations (surchargeable pour les tests)
GROOVES_DIR="${GROOVES_DIR:-$ROOT_DIR/grooves}"
export GROOVES_DIR

# Le registre suit les DONNÉES, pas le dépôt : dans un worktree, grooves/ est un
# lien vers le dépôt principal alors que cache/ est un vrai dossier local, qui
# disparaît avec le worktree. On résout donc le lien et on range le registre dans
# le cache/ voisin des vraies données. Volontairement à côté de grooves/ et non
# dedans : deploy-grooves.sh téléverse certaines extensions du dossier déployé,
# le registre n'a rien à faire sur le serveur.
DATA_ROOT="$(dirname "$(readlink -f "$GROOVES_DIR")")"
REGISTRY="${MIGRATIONS_REGISTRY:-$DATA_ROOT/cache/migrations.json}"

# Dossier d'état partagé par le registre et les rapports des migrations
MIGRATIONS_STATE_DIR="${MIGRATIONS_STATE_DIR:-$(dirname "$REGISTRY")}"
export MIGRATIONS_STATE_DIR

DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) echo "Usage: $0 [--dry-run]"; exit 0 ;;
    *)         die "Argument inconnu : $arg" ;;
  esac
done
export DRY_RUN

[[ -d "$MIGRATIONS_DIR" ]] || die "Dossier de migrations introuvable : $MIGRATIONS_DIR"
[[ -d "$GROOVES_DIR" ]] || die "Dossier de données introuvable : $GROOVES_DIR"

command -v python3 >/dev/null 2>&1 || die "python3 est requis"

# Liste des ids déjà appliqués (une par ligne). Échoue si le JSON est corrompu.
applied_ids() {
  python3 - "$REGISTRY" <<'PY'
import json, os, sys
path = sys.argv[1]
if not os.path.exists(path):
    sys.exit(0)
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
except json.JSONDecodeError as exc:
    print(f"JSON invalide dans {path} : {exc}", file=sys.stderr)
    sys.exit(2)
migrations = data.get("migrations") if isinstance(data, dict) else None
if not isinstance(migrations, list):
    print(f"Structure inattendue dans {path} : clé 'migrations' absente ou invalide", file=sys.stderr)
    sys.exit(2)
for entry in migrations:
    if isinstance(entry, dict) and entry.get("id"):
        print(entry["id"])
PY
}

# record_migration <id> <count>
record_migration() {
  python3 - "$REGISTRY" "$1" "$2" <<'PY'
import datetime, json, os, sys
path, mid, count = sys.argv[1], sys.argv[2], int(sys.argv[3])
data = {"migrations": []}
if os.path.exists(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
data.setdefault("migrations", [])
data["migrations"].append({
    "id": mid,
    "date": datetime.datetime.now().astimezone().replace(microsecond=0).isoformat(),
    "count": count,
})
os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
os.replace(tmp, path)
PY
}

echo -e "${BOLD}Registre :${RESET} $REGISTRY"
echo -e "${BOLD}Données  :${RESET} $GROOVES_DIR"
[[ $DRY_RUN -eq 1 ]] && echo -e "${YELLOW}Mode dry-run — aucun renommage effectué, registre non écrit${RESET}"
echo

if ! APPLIED_RAW="$(applied_ids)"; then
  die "Registre illisible — corrigez ou supprimez $REGISTRY"
fi

declare -A APPLIED=()
while IFS= read -r line; do
  [[ -n "$line" ]] && APPLIED["$line"]=1
done <<< "$APPLIED_RAW"

# -d '' : un nom de script contenant un saut de ligne ne doit pas casser la liste
mapfile -d '' MIGRATIONS < <(find "$MIGRATIONS_DIR" -maxdepth 1 -mindepth 1 -type f -name '*.sh' -print0 | sort -z)

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  warn "Aucune migration dans $MIGRATIONS_DIR"
  exit 0
fi

RUN=0
SKIPPED=0
INCOMPLETE=0

for migration in "${MIGRATIONS[@]}"; do
  [[ -n "$migration" ]] || continue
  id="$(basename "$migration" .sh)"

  if [[ -n "${APPLIED[$id]+x}" ]]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo -e "${BOLD}${CYAN}▶ Migration $id${RESET}"

  result_file="$(mktemp)"
  status=0
  MIGRATION_RESULT_FILE="$result_file" bash "$migration" || status=$?

  # La migration écrit son compteur via un trap EXIT : il est renseigné même
  # quand elle s'arrête en cours de route.
  count="$(tr -dc '0-9' < "$result_file")"
  rm -f "$result_file"
  [[ -n "$count" ]] || count=0

  if [[ $status -eq 2 ]]; then
    # Sortie « incomplet » : des cas demandent une décision humaine.
    warn "Migration $id non enregistrée — des cas restent à trancher à la main"
    if [[ $DRY_RUN -eq 1 ]]; then
      warn "Dry-run — $count élément(s) auraient été traités"
    else
      warn "$count élément(s) ont bien été traités ; relancez après arbitrage"
    fi
    INCOMPLETE=1
    echo
    break
  elif [[ $status -ne 0 ]]; then
    err "Migration $id en échec (code $status) — registre inchangé"
    err "ATTENTION : $count élément(s) ont pu être modifiés avant l'échec ; les migrations sont idempotentes, relancez après correction"
    exit 1
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    warn "Dry-run — migration $id non enregistrée ($count élément(s) auraient été traités)"
  else
    record_migration "$id" "$count"
    ok "Migration $id enregistrée ($count élément(s) traité(s))"
  fi
  RUN=$((RUN + 1))
  echo
done

echo -e "${BOLD}Résultat :${RESET} $RUN migration(s) appliquée(s), $SKIPPED déjà enregistrée(s)"

[[ $INCOMPLETE -eq 1 ]] && exit 1
exit 0
