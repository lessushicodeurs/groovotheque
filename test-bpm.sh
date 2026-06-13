#!/usr/bin/env bash
# Test harness ciblé pour create_md_sheets (epic-25)
# Réutilise les dossiers de sortie existants sans relancer le pipeline complet.
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✗${RESET}  $*" >&2; }
STEP=0; TOTAL_STEPS=1
next_step() { STEP=$((STEP+1)); echo; echo -e "${BOLD}── Étape ${STEP}/${TOTAL_STEPS} : $* ──${RESET}"; }

# Variables globales nécessaires à create_md_sheets
HAS_AUBIO=false
declare -A SEG_BPM=()

BASE="grooves/Tmp"
mapfile -t OUTPUT_DIRS < <(find "$BASE" -maxdepth 1 -name "260612-Répé-Set-1_-_*" -type d | sort)

# ────── Copie de create_md_sheets ──────
create_md_sheets() {
  next_step "Création des fiches .md (BPM)"

  if [[ "$HAS_AUBIO" != "true" ]]; then
    warn "aubiotempo introuvable — création des fiches .md désactivée"
    return
  fi

  for out_dir in "${OUTPUT_DIRS[@]}"; do
    local out_dir_name
    out_dir_name="$(basename "$out_dir")"

    [[ "$out_dir_name" == *blabla* ]] && continue

    local md_file="${out_dir}/${out_dir_name}.md"
    if [[ -f "$md_file" ]]; then
      warn "fiche existante, ignorée : ${out_dir_name}.md"
      continue
    fi

    local bpm_values=()
    for mp3 in "$out_dir"/*.mp3; do
      [[ -f "$mp3" ]] || continue
      local aubio_out
      aubio_out="$(aubiotempo -i "$mp3" 2>/dev/null || true)"
      local bpm_raw
      bpm_raw="$(echo "$aubio_out" | grep -oE '[0-9]+(\.[0-9]+)?' | LC_ALL=C awk '$1 >= 20 && $1 <= 400 { print; exit }')"
      [[ -n "$bpm_raw" ]] && bpm_values+=("$bpm_raw")
    done

    [[ ${#bpm_values[@]} -eq 0 ]] && continue

    local joined_bpms
    joined_bpms="$(IFS=','; echo "${bpm_values[*]}")"
    local bpm_median
    bpm_median="$(python3 -c "import statistics; print(round(statistics.median([${joined_bpms}])))")"

    local remainder="${out_dir_name#*_-_}"
    local seg_num="${remainder%%_-_*}"
    local label_part=""
    [[ "$remainder" == *"_-_"* ]] && label_part="${remainder#*_-_}"
    local label="${label_part//_/ }"

    local title
    if [[ -n "$label_part" ]]; then
      title="# ${seg_num} ${label}"
    else
      title="# ${seg_num}"
    fi

    printf -- '---\nbpm: %s\n---\n\n%s\n\n- %s bpm\n' \
      "$bpm_median" "$title" "$bpm_median" > "$md_file"

    SEG_BPM["$out_dir_name"]="$bpm_median"
    ok "→ ${out_dir_name}.md (BPM : ${bpm_median})"
  done
}

# ────── run ──────
if [[ "${1:-}" == "--has-aubio" ]]; then
  HAS_AUBIO=true
fi

create_md_sheets

echo
echo "SEG_BPM contents:"
for k in "${!SEG_BPM[@]}"; do echo "  $k → ${SEG_BPM[$k]}"; done

# ────── test print_summary inline ──────
test_print_summary() {
  echo
  echo "=== Résumé (test print_summary) ==="
  for dname in "260612-Répé-Set-1_-_01_-_Intro_+_Superstition" "260612-Répé-Set-1_-_02_-_blabla" "260612-Répé-Set-1_-_03_-_Sexy_man_-_take_1"; do
    echo "    • ${dname}"
    if [[ -n "${SEG_BPM[$dname]:-}" ]]; then
      local remainder="${dname#*_-_}"
      local label_part=""
      [[ "$remainder" == *"_-_"* ]] && label_part="${remainder#*_-_}"
      local label="${label_part//_/ }"
      [[ -z "$label" ]] && label="${remainder%%_-_*}"
      echo "      BPM : ${label} → ${SEG_BPM[$dname]}"
    fi
  done
}
test_print_summary
