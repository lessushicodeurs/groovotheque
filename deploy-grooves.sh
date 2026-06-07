#!/usr/bin/env bash
# Déploie un ou plusieurs dossiers de grooves sur AlwaysData via SSH.
# Par défaut, liste uniquement les grooves absents du serveur.
# Avec --all, liste tous les grooves locaux.

set -euo pipefail

REMOTE="sushi-alwaysdata"
REMOTE_GROOVES="~/sites/ghismo.com/groovotheque/grooves"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_GROOVES="$SCRIPT_DIR/grooves"

SHOW_ALL=0
if [ "${1:-}" = "--all" ]; then
  SHOW_ALL=1
fi

# Liste locale (hors dossiers se terminant par ~)
mapfile -t ALL_LOCAL < <(find "$LOCAL_GROOVES" -mindepth 1 -maxdepth 1 -type d | sort | grep -v '~$' | sed "s|$LOCAL_GROOVES/||")

if [ ${#ALL_LOCAL[@]} -eq 0 ]; then
  echo "Aucun groove trouvé dans grooves/"
  exit 1
fi

if [ "$SHOW_ALL" -eq 0 ]; then
  # Récupérer la liste des grooves déjà sur le serveur
  mapfile -t REMOTE_LIST < <(ssh "$REMOTE" "ls -1 $REMOTE_GROOVES 2>/dev/null || true")
  declare -A REMOTE_SET
  for r in "${REMOTE_LIST[@]}"; do REMOTE_SET["$r"]=1; done

  mapfile -t GROOVES < <(for g in "${ALL_LOCAL[@]}"; do
    [ -z "${REMOTE_SET[$g]+x}" ] && echo "$g"
  done)

  if [ ${#GROOVES[@]} -eq 0 ]; then
    echo "Tous les grooves locaux sont déjà sur le serveur."
    echo "Utilisez --all pour les afficher quand même."
    exit 0
  fi
else
  GROOVES=("${ALL_LOCAL[@]}")
fi

echo "Grooves à déployer :"
for i in "${!GROOVES[@]}"; do
  printf "  %2d) %s\n" "$((i + 1))" "${GROOVES[$i]}"
done
echo ""
echo "Sélection (ex: 1  ou  1,3  ou  2~4) :"
read -r SELECTION

# Parser la sélection en indices (base 0)
SELECTED=()
IFS=',' read -ra PARTS <<< "$SELECTION"
for part in "${PARTS[@]}"; do
  part="${part// /}"
  if [[ "$part" =~ ^([0-9]+)~([0-9]+)$ ]]; then
    from="${BASH_REMATCH[1]}"
    to="${BASH_REMATCH[2]}"
    for ((n = from; n <= to; n++)); do
      SELECTED+=("$((n - 1))")
    done
  elif [[ "$part" =~ ^[0-9]+$ ]]; then
    SELECTED+=("$((part - 1))")
  else
    echo "ERREUR : sélection invalide '$part'"
    exit 1
  fi
done

if [ ${#SELECTED[@]} -eq 0 ]; then
  echo "Aucun groove sélectionné."
  exit 1
fi

ERRORS=0
for idx in "${SELECTED[@]}"; do
  if [ "$idx" -lt 0 ] || [ "$idx" -ge "${#GROOVES[@]}" ]; then
    echo "ERREUR : numéro $((idx + 1)) hors de la liste."
    ERRORS=$((ERRORS + 1))
    continue
  fi

  groove="${GROOVES[$idx]}"
  local_path="$LOCAL_GROOVES/$groove"

  echo "=== Déploiement de '$groove' ==="
  ssh "$REMOTE" "mkdir -p \"$REMOTE_GROOVES/$groove\""
  rsync -avz --delete "$local_path/" "$REMOTE:$REMOTE_GROOVES/$groove/"
  echo "=== '$groove' déployé ==="
  echo ""
done

if [ "$ERRORS" -gt 0 ]; then
  echo "$ERRORS groove(s) n'ont pas pu être déployés."
  exit 1
fi
