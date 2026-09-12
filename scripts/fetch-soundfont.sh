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
#
# Le fichier téléchargé est ensuite repassé en mono par scripts/sf-mono.js :
# AlphaTab ignore les samples stéréo et le rendu MIDI sort silencieux sans
# cette étape. Elle est idempotente, ré-exécuter le script ne coûte rien.
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
command -v node &>/dev/null || die "node introuvable (requis pour la conversion mono)."
mkdir -p "$DEST_DIR"

if [[ -f "$DEST_DIR/$FILE" ]]; then
  warn "$FILE déjà présent dans soundfonts/ — pas de nouveau téléchargement."
else
  echo "Téléchargement de $FILE depuis $BASE_URL ..."
  curl -fL --progress-bar -o "$DEST_DIR/$FILE.part" "$BASE_URL/$FILE"
  mv "$DEST_DIR/$FILE.part" "$DEST_DIR/$FILE"
  ok "$FILE installé dans soundfonts/ ($(du -h "$DEST_DIR/$FILE" | cut -f1))"
fi

# Licence et notices d'attribution : le MIT de MuseScore_General impose de les
# conserver avec le fichier.
if [[ ! -f "$DEST_DIR/MuseScore_General_License.md" ]]; then
  curl -fsSL -o "$DEST_DIR/MuseScore_General_License.md" "$BASE_URL/MuseScore_General_License.md" || \
    warn "Licence non téléchargée — à récupérer sur $BASE_URL/MuseScore_General_License.md"
fi

# ── Conversion mono (obligatoire) ─────────────────────────────────────────
# AlphaTab n'ouvre que les samples mono et jette les samples stéréo, tout en
# gardant les régions qui les référencent : ces régions lisent alors hors d'un
# tableau vide et produisent des NaN qui détruisent le rendu de **toutes** les
# pistes, y compris celles à volume nul. MuseScore_General compte 146 samples
# stéréo sur 1246, dont 4 presets de piano entièrement muets.
# La conversion ne touche aucune donnée audio : elle réécrit 2 octets par
# sample dans le chunk `shdr`. Elle est idempotente — un fichier déjà converti
# ressort inchangé — donc on la repasse toujours, y compris sur un soundfont
# téléchargé par un autre moyen.
echo "Conversion des samples stéréo en mono ..."
node "$(dirname "${BASH_SOURCE[0]}")/sf-mono.js" "$DEST_DIR/$FILE"
ok "$FILE prêt ($(du -h "$DEST_DIR/$FILE" | cut -f1))"

echo
echo "Activer ce soundfont : copier config.example.json vers config.json"
echo "  cp config.example.json config.json"
echo "puis y mettre  \"soundFont\": \"$FILE\"  et recharger la page du player."
