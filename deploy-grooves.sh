#!/usr/bin/env bash
# Déploie un ou plusieurs dossiers de grooves sur AlwaysData via SSH.
# Les grooves existants sur le serveur ne sont pas touchés.
# Usage : ./deploy-grooves.sh "Nom du groove 1" ["Nom du groove 2" ...]

set -euo pipefail

REMOTE="sushi-alwaysdata"
REMOTE_GROOVES="~/sites/ghismo.com/groovotheque/grooves"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_GROOVES="$SCRIPT_DIR/grooves"

if [ $# -eq 0 ]; then
  echo "Usage : $0 <nom-du-groove> [<nom-du-groove> ...]"
  echo ""
  echo "Grooves disponibles localement :"
  ls -1 "$LOCAL_GROOVES" 2>/dev/null | grep -v '~$' || echo "  (aucun)"
  exit 1
fi

ERRORS=0

for groove in "$@"; do
  local_path="$LOCAL_GROOVES/$groove"

  if [ ! -d "$local_path" ]; then
    echo "ERREUR : groove '$groove' introuvable dans grooves/"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  echo "=== Déploiement de '$groove' ==="
  ssh "$REMOTE" "mkdir -p $REMOTE_GROOVES/$(printf '%q' "$groove")"

  rsync -avz --delete \
    "$local_path/" \
    "$REMOTE:$REMOTE_GROOVES/$groove/"

  echo "=== '$groove' déployé ==="
  echo ""
done

if [ "$ERRORS" -gt 0 ]; then
  echo "$ERRORS groove(s) n'ont pas pu être déployés."
  exit 1
fi
