#!/usr/bin/env bash
# fetch-soundfont.sh — télécharge un soundfont dans soundfonts/ (ignoré par git).
#
# Le soundfont sert à la fois au rendu audio des pistes MIDI et à la lecture
# directe du synthétiseur. Il se choisit dans config.json (clé "soundFont") ;
# sans fichier présent, le serveur retombe sur le sonivox.sf2 livré avec
# AlphaTab et le projet reste fonctionnel.
#
# Usage :
#   scripts/fetch-soundfont.sh                  # MuseScore_General.sf3 (défaut, 38 Mo)
#   scripts/fetch-soundfont.sh musescore-hq     # MuseScore_General.sf2 (206 Mo)
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "${RED}✗${RESET}  $*" >&2; exit 1; }

DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/soundfonts"
BASE_URL='https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General'

case "${1:-musescore}" in
  musescore)    FILE='MuseScore_General.sf3' ;;
  musescore-hq) FILE='MuseScore_General.sf2' ;;
  *)            die "Cible inconnue : $1 (attendu : musescore | musescore-hq)" ;;
esac

command -v curl &>/dev/null || die "curl introuvable."
mkdir -p "$DEST_DIR"

if [[ -f "$DEST_DIR/$FILE" ]]; then
  warn "$FILE déjà présent dans soundfonts/ — rien à faire."
  exit 0
fi

echo "Téléchargement de $FILE depuis $BASE_URL ..."
curl -fL --progress-bar -o "$DEST_DIR/$FILE.part" "$BASE_URL/$FILE"
mv "$DEST_DIR/$FILE.part" "$DEST_DIR/$FILE"

# Licence et notices d'attribution : le MIT de MuseScore_General impose de les
# conserver avec le fichier.
curl -fsSL -o "$DEST_DIR/MuseScore_General_License.md" "$BASE_URL/MuseScore_General_License.md" || \
  warn "Licence non téléchargée — à récupérer sur $BASE_URL/MuseScore_General_License.md"

ok "$FILE installé dans soundfonts/ ($(du -h "$DEST_DIR/$FILE" | cut -f1))"
echo
echo "Activer ce soundfont : copier config.example.json vers config.json"
echo "  cp config.example.json config.json"
echo "puis y mettre  \"soundFont\": \"$FILE\"  et recharger la page du player."
