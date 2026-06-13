#!/usr/bin/env bash
# setup.sh — installe les dépendances système du pipeline process-rehearsal
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "${RED}✗${RESET}  $*" >&2; exit 1; }

command -v apt-get &>/dev/null || die "apt-get introuvable — ce script requiert Ubuntu/Debian."

PACKAGES=(ffmpeg bc python3-yaml aubio-tools)

echo "Installation des dépendances process-rehearsal..."
echo

sudo apt-get install -y "${PACKAGES[@]}"

echo
for pkg in "${PACKAGES[@]}"; do
  case "$pkg" in
    ffmpeg)       cmd=ffmpeg ;;
    bc)           cmd=bc ;;
    python3-yaml) cmd=python3 ;;
    aubio-tools)  cmd=aubiotrack ;;
  esac
  command -v "$cmd" &>/dev/null && ok "$pkg ($cmd)" || warn "$pkg introuvable après installation"
done

# ── Flatpak + Audacity (requis pour le pipeline Audacity DRC) ──────────────────
echo
echo "Vérification de Flatpak et Audacity..."

if ! command -v flatpak &>/dev/null; then
  echo "Installation de flatpak..."
  sudo apt-get install -y flatpak
fi
command -v flatpak &>/dev/null && ok "flatpak" || die "flatpak introuvable après installation."

if ! flatpak list --app 2>/dev/null | grep -q "org.audacityteam.Audacity"; then
  echo "Installation d'Audacity via Flatpak..."
  flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
  flatpak install -y flathub org.audacityteam.Audacity
fi
flatpak list --app 2>/dev/null | grep -q "org.audacityteam.Audacity" \
  && ok "Audacity Flatpak (org.audacityteam.Audacity)" \
  || warn "Audacity Flatpak introuvable après installation"

echo
warn "Activer mod-script-pipe dans Audacity : Edit → Preferences → Modules → mod-script-pipe: Enabled → redémarrer Audacity"
