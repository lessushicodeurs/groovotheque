#!/usr/bin/env bash
# Déploie les fichiers du projet sur AlwaysData via SSH, puis redémarre le site.
# Préserve grooves/, cache/, et .auth sur le serveur.
# Usage : ./deploy.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Charger les credentials API depuis .env.deploy
ENV_FILE="$SCRIPT_DIR/.env.deploy"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERREUR : fichier .env.deploy absent. Copier .env.deploy.example et renseigner les valeurs."
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

REMOTE="sushi-alwaysdata"
REMOTE_DIR="~/sites/ghismo.com/groovotheque"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  echo "=== MODE DRY-RUN — aucun fichier ne sera transféré ni redémarré ==="
fi

RSYNC_OPTS=(-avz)
[ "$DRY_RUN" -eq 1 ] && RSYNC_OPTS+=(--dry-run)

if [ "$DRY_RUN" -eq 0 ]; then
  echo "=== Préparation des dépendances (npm ci --omit=dev) ==="
  npm ci --omit=dev --prefix "$SCRIPT_DIR"
  echo ""
fi

echo "=== Déploiement Groovotheque → $REMOTE:$REMOTE_DIR ==="

# Pas de --delete : grooves/, cache/, .git/ éventuels sur le serveur doivent être préservés.
rsync "${RSYNC_OPTS[@]}" \
  --exclude='.git' \
  --exclude='.claude' \
  --exclude='.worktrees' \
  --exclude='grooves' \
  --exclude='grooves-tmp' \
  --exclude='cache' \
  --exclude='.auth' \
  --exclude='.env.deploy' \
  --exclude='comments.json' \
  --exclude='docs' \
  --exclude='tests' \
  --exclude='playwright.config.js' \
  --exclude='PRD.md' \
  "$SCRIPT_DIR/" \
  "$REMOTE:$REMOTE_DIR/"

if [ "$DRY_RUN" -eq 0 ]; then
  echo "=== Restauration des dépendances de dev ==="
  npm ci --prefix "$SCRIPT_DIR"
  echo ""

  echo "=== Création des répertoires persistants si absents ==="
  ssh "$REMOTE" "mkdir -p $REMOTE_DIR/grooves $REMOTE_DIR/cache"

  echo ""
  echo "=== Redémarrage du site AlwaysData (id: $ALWAYSDATA_SITE_ID) ==="
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    --basic -u "$ALWAYSDATA_API_KEY account=$ALWAYSDATA_ACCOUNT:" \
    "https://api.alwaysdata.com/v1/site/$ALWAYSDATA_SITE_ID/restart/")

  if [ "$HTTP_STATUS" = "204" ]; then
    echo "Site redémarré avec succès."
  else
    echo "ERREUR : restart échoué (HTTP $HTTP_STATUS)."
    echo "Vérifier l'état du site dans le panel AlwaysData."
    exit 1
  fi

  echo ""
  echo "=== Déploiement terminé ==="
  if ! ssh "$REMOTE" "test -f $REMOTE_DIR/.auth"; then
    echo "AVERTISSEMENT : .auth absent sur le serveur."
    echo "  ssh $REMOTE 'cp $REMOTE_DIR/.auth.example $REMOTE_DIR/.auth && nano $REMOTE_DIR/.auth'"
  fi
fi
