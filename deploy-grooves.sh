#!/usr/bin/env bash
# Déploie un ou plusieurs grooves (arborescence à N niveaux) sur AlwaysData via SSH.
# Détecte les grooves récursivement : un dossier est un groove s'il contient
# directement au moins un fichier audio (.mp3 .wav .flac .ogg) ou GP.
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

# Retourne 0 si le dossier contient directement au moins un fichier audio ou GP
is_groove() {
  local dir="$1"
  find "$dir" -maxdepth 1 -type f \( \
    -name "*.mp3" -o -name "*.wav" -o -name "*.flac" -o -name "*.ogg" \
    -o -name "*.gp" -o -name "*.gpx" -o -name "*.gp5" -o -name "*.gp4" -o -name "*.gp8" \
  \) -print -quit | grep -q .
}

# Collecte récursivement les chemins relatifs de tous les grooves locaux
collect_local_grooves() {
  local dir="$1"
  local rel="$2"

  for subdir in "$dir"/*/; do
    [ -d "$subdir" ] || continue
    local name
    name="$(basename "$subdir")"
    [[ "$name" == *~ ]] && continue

    local subrel="${rel:+$rel/}$name"

    if is_groove "$subdir"; then
      echo "$subrel"
    else
      collect_local_grooves "$subdir" "$subrel"
    fi
  done
}

mapfile -t ALL_LOCAL < <(collect_local_grooves "$LOCAL_GROOVES" "" | sort)

if [ ${#ALL_LOCAL[@]} -eq 0 ]; then
  echo "Aucun groove trouvé dans grooves/"
  exit 1
fi

if [ "$SHOW_ALL" -eq 0 ]; then
  # Vérifier quels grooves sont déjà présents sur le serveur (par existence du répertoire)
  mapfile -t REMOTE_LIST < <(ssh "$REMOTE" \
    "cd $REMOTE_GROOVES 2>/dev/null && find . -mindepth 1 -type d | sed 's|^\./||' | sort" 2>/dev/null || true)
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
  remote_path="$REMOTE_GROOVES/$groove"

  echo "=== Déploiement de '$groove' ==="

  # Créer l'arborescence de répertoires sur le serveur
  # Note: ~ entre double quotes ne s'expande pas sur le shell distant ;
  # on substitue ~/  par $HOME/ (qui lui s'expande en double quotes).
  remote_path_home="\${HOME}/${remote_path#\~/}"
  ssh "$REMOTE" "mkdir -p \"$remote_path_home\""

  # Uploader uniquement les fichiers utiles, exclure les sous-dossiers internes
  rsync -avz \
    --include="*.mp3" --include="*.wav" --include="*.flac" --include="*.ogg" \
    --include="*.gp"  --include="*.gpx" --include="*.gp5"  --include="*.gp4" --include="*.gp8" \
    --include="mix.json" --include="*.md" \
    --exclude="*/" \
    --exclude="*" \
    "$local_path/" "$REMOTE:$remote_path/"

  # Fallback mix.json : si le groove n'a pas son propre mix.json mais que le
  # dossier parent en possède un, le déployer sur le serveur distant.
  parent_rel="$(dirname "$groove")"
  if [ "$parent_rel" != "." ] && [ ! -f "$local_path/mix.json" ]; then
    parent_mix_local="$LOCAL_GROOVES/$parent_rel/mix.json"
    if [ -f "$parent_mix_local" ]; then
      parent_remote_home="\${HOME}/${REMOTE_GROOVES#\~/}/$parent_rel"
      echo "  → mix.json parent trouvé dans '$parent_rel', déploiement sur le serveur…"
      ssh "$REMOTE" "mkdir -p \"$parent_remote_home\""
      rsync -avz "$parent_mix_local" "$REMOTE:${REMOTE_GROOVES}/$parent_rel/mix.json"
      echo "  → mix.json parent déployé dans '$parent_rel'"
    fi
  fi

  echo "=== '$groove' déployé ==="
  echo ""
done

if [ "$ERRORS" -gt 0 ]; then
  echo "$ERRORS groove(s) n'ont pas pu être déployés."
  exit 1
fi
