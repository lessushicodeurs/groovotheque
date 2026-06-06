#!/usr/bin/env bash
# process-rehearsal.sh — Pipeline de traitement audio pour la groovothèque
# Usage: ./scripts/process-rehearsal.sh [--keep-work] "path/to/dossier"
set -euo pipefail

# ────────────────────────── Helpers ──────────────────────────

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

STEP=0
TOTAL_STEPS=7

log()  { echo -e "${CYAN}[${STEP}/${TOTAL_STEPS}]${RESET} $*"; }
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✗${RESET}  $*" >&2; }
die()  { err "$*"; exit 1; }

next_step() { STEP=$((STEP + 1)); echo; echo -e "${BOLD}── Étape ${STEP}/${TOTAL_STEPS} : $* ──${RESET}"; }

# ────────────────────────── Dépendances ──────────────────────

YAML_PARSER=""

check_deps() {
  for cmd in ffmpeg ffprobe bc; do
    command -v "$cmd" &>/dev/null || die "$cmd est requis mais introuvable."
  done
  if command -v python3 &>/dev/null && python3 -c "import yaml" &>/dev/null 2>&1; then
    YAML_PARSER="python3"
  elif command -v yq &>/dev/null; then
    YAML_PARSER="yq"
  else
    die "python3 (avec pyyaml) ou yq est requis pour lire la config YAML."
  fi
}

# ────────────────────────── Config YAML ──────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/rehearsal-config.yaml"

# Variables remplies par load_config
MP3_BITRATE="" NORMALIZE_PEAK_DB=""
COMP_THRESHOLD="" COMP_RATIO="" COMP_ATTACK="" COMP_RELEASE="" COMP_KNEE=""
MIXES_COUNT=0
EXCLUDES_COUNT=0
# MIX_<i>_OUTPUT, MIX_<i>_SRC_COUNT, MIX_<i>_SRC_<j>_FILE, MIX_<i>_SRC_<j>_PAN
# EXCLUDE_<i>
# MIX_ALL_SOURCES : tableau plat de tous les fichiers sources des mixes

MIX_ALL_SOURCES=()

load_config_python() {
  local cfg="$1"
  # Un seul appel Python; toutes les sorties sont évaluées via eval
  eval "$(REHEARSAL_CONFIG="$cfg" python3 - <<'PYEOF'
import yaml, os, sys

cfg_path = os.environ['REHEARSAL_CONFIG']
with open(cfg_path) as f:
    cfg = yaml.safe_load(f)

audio = cfg.get('audio', {})
comp  = audio.get('compression', {})

def sh(val):
    return str(val).replace("'", "'\\''")

print(f"MP3_BITRATE='{sh(audio.get('mp3_bitrate','320k'))}'")
print(f"NORMALIZE_PEAK_DB='{sh(audio.get('normalize_peak_db',-1))}'")
print(f"COMP_THRESHOLD='{sh(comp.get('threshold_db',-20))}'")
print(f"COMP_RATIO='{sh(comp.get('ratio',3))}'")
print(f"COMP_ATTACK='{sh(comp.get('attack_ms',20))}'")
print(f"COMP_RELEASE='{sh(comp.get('release_ms',200))}'")
print(f"COMP_KNEE='{sh(comp.get('knee_db',6))}'")

tracks = cfg.get('tracks', {})
mixes  = tracks.get('mixes', [])
print(f"MIXES_COUNT='{len(mixes)}'")

for i, m in enumerate(mixes):
    print(f"MIX_{i}_OUTPUT='{sh(m['output'])}'")
    srcs = m.get('sources', [])
    print(f"MIX_{i}_SRC_COUNT='{len(srcs)}'")
    for j, s in enumerate(srcs):
        print(f"MIX_{i}_SRC_{j}_FILE='{sh(s['file'])}'")
        print(f"MIX_{i}_SRC_{j}_PAN='{sh(s['pan'])}'")

excludes = tracks.get('exclude', [])
print(f"EXCLUDES_COUNT='{len(excludes)}'")
for i, e in enumerate(excludes):
    print(f"EXCLUDE_{i}='{sh(e)}'")
PYEOF
  )"
}

load_config_yq() {
  local cfg="$1"
  MP3_BITRATE="$(yq e '.audio.mp3_bitrate' "$cfg")"
  NORMALIZE_PEAK_DB="$(yq e '.audio.normalize_peak_db' "$cfg")"
  COMP_THRESHOLD="$(yq e '.audio.compression.threshold_db' "$cfg")"
  COMP_RATIO="$(yq e '.audio.compression.ratio' "$cfg")"
  COMP_ATTACK="$(yq e '.audio.compression.attack_ms' "$cfg")"
  COMP_RELEASE="$(yq e '.audio.compression.release_ms' "$cfg")"
  COMP_KNEE="$(yq e '.audio.compression.knee_db' "$cfg")"
  MIXES_COUNT="$(yq e '.tracks.mixes | length' "$cfg")"
  for ((i=0; i<MIXES_COUNT; i++)); do
    declare -g "MIX_${i}_OUTPUT=$(yq e ".tracks.mixes[${i}].output" "$cfg")"
    local sc
    sc="$(yq e ".tracks.mixes[${i}].sources | length" "$cfg")"
    declare -g "MIX_${i}_SRC_COUNT=${sc}"
    for ((j=0; j<sc; j++)); do
      declare -g "MIX_${i}_SRC_${j}_FILE=$(yq e ".tracks.mixes[${i}].sources[${j}].file" "$cfg")"
      declare -g "MIX_${i}_SRC_${j}_PAN=$(yq e ".tracks.mixes[${i}].sources[${j}].pan" "$cfg")"
    done
  done
  EXCLUDES_COUNT="$(yq e '.tracks.exclude | length' "$cfg")"
  for ((i=0; i<EXCLUDES_COUNT; i++)); do
    declare -g "EXCLUDE_${i}=$(yq e ".tracks.exclude[${i}]" "$cfg")"
  done
}

load_config() {
  [[ -f "$CONFIG_FILE" ]] || die "Config introuvable : $CONFIG_FILE"
  if [[ "$YAML_PARSER" == "python3" ]]; then
    load_config_python "$CONFIG_FILE"
  else
    load_config_yq "$CONFIG_FILE"
  fi

  # Construire MIX_ALL_SOURCES (fichiers sources consommés par les mixes)
  MIX_ALL_SOURCES=()
  for ((mi=0; mi<MIXES_COUNT; mi++)); do
    local sc_var="MIX_${mi}_SRC_COUNT"
    local sc="${!sc_var}"
    for ((j=0; j<sc; j++)); do
      local fvar="MIX_${mi}_SRC_${j}_FILE"
      MIX_ALL_SOURCES+=("${!fvar}")
    done
  done
}

is_excluded() {
  local name="$1"
  for ((i=0; i<EXCLUDES_COUNT; i++)); do
    local v="EXCLUDE_${i}"
    [[ "${!v}" == "$name" ]] && return 0
  done
  return 1
}

is_mix_source() {
  local name="$1"
  for src in "${MIX_ALL_SOURCES[@]+"${MIX_ALL_SOURCES[@]}"}"; do
    [[ "$src" == "$name" ]] && return 0
  done
  return 1
}

# ────────────────────────── Arguments CLI ────────────────────

KEEP_WORK=false
SOURCE_DIR=""

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keep-work) KEEP_WORK=true; shift ;;
      -*) die "Option inconnue : $1" ;;
      *)
        [[ -n "$SOURCE_DIR" ]] && die "Un seul dossier source attendu."
        SOURCE_DIR="$1"; shift ;;
    esac
  done
  [[ -z "$SOURCE_DIR" ]] && die "Usage: $0 [--keep-work] \"path/to/dossier\""
  SOURCE_DIR="$(cd "$SOURCE_DIR" 2>/dev/null && pwd)" || die "Dossier introuvable : $SOURCE_DIR"
}

# ────────────────────────── Validation ───────────────────────

FLAC_FILES=()
LABELS_FILE=""

validate_input() {
  next_step "Validation des entrées"

  [[ -d "$SOURCE_DIR" ]] || die "Pas un dossier : $SOURCE_DIR"

  mapfile -t FLAC_FILES < <(find "$SOURCE_DIR" -maxdepth 1 -name "*.flac" | sort)
  [[ ${#FLAC_FILES[@]} -gt 0 ]] || die "Aucun fichier .flac trouvé dans $SOURCE_DIR"
  ok "${#FLAC_FILES[@]} fichier(s) FLAC trouvé(s)"

  local -a txt_files
  mapfile -t txt_files < <(find "$SOURCE_DIR" -maxdepth 1 -name "*.txt" | sort)
  if [[ ${#txt_files[@]} -eq 0 ]]; then
    die "Aucun fichier .txt d'étiquettes trouvé dans $SOURCE_DIR"
  elif [[ ${#txt_files[@]} -gt 1 ]]; then
    warn "Plusieurs fichiers .txt trouvés — utilisation du plus récent"
    LABELS_FILE="$(ls -t "${txt_files[@]}" | head -1)"
  else
    LABELS_FILE="${txt_files[0]}"
  fi
  ok "Fichier étiquettes : $(basename "$LABELS_FILE")"
}

# ────────────────────────── Parsing étiquettes ───────────────

SEGMENT_STARTS=()
SEGMENT_LABELS=()
SEG_COUNT=0
TOTAL_DURATION=""

parse_labels() {
  next_step "Parsing des étiquettes Audacity"

  mapfile -t raw_lines < <(grep -v '^[[:space:]]*$' "$LABELS_FILE")
  [[ ${#raw_lines[@]} -gt 0 ]] || die "Fichier d'étiquettes vide."

  for line in "${raw_lines[@]}"; do
    IFS=$'\t' read -r col1 _col2 col3 <<<"$line"
    SEGMENT_STARTS+=("$col1")
    SEGMENT_LABELS+=("${col3:-}")
  done

  SEG_COUNT=${#SEGMENT_STARTS[@]}
  ok "${SEG_COUNT} segment(s) détecté(s)"

  TOTAL_DURATION="$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "${FLAC_FILES[0]}")"
  ok "Durée totale : ${TOTAL_DURATION}s"
}

# ────────────────────────── Répertoires de travail ───────────

GROOVES_DIR=""
SOURCE_NAME=""
WORK_DIR=""

setup_dirs() {
  GROOVES_DIR="$(dirname "$SOURCE_DIR")"
  SOURCE_NAME="$(basename "$SOURCE_DIR")"
  WORK_DIR="${SOURCE_DIR}/_work"

  rm -rf "$WORK_DIR"
  mkdir -p "${WORK_DIR}/compressed" "${WORK_DIR}/normalized"
  for ((i=0; i<SEG_COUNT; i++)); do
    mkdir -p "${WORK_DIR}/segments/$(printf '%02d' $((i+1)))"
  done
}

# ────────────────────────── Mix stéréo ───────────────────────

MIX_OUTPUT_PATHS=()
MIX_OUTPUT_NAMES=()

build_mixes() {
  next_step "Mix stéréo des pistes composites"

  for ((mi=0; mi<MIXES_COUNT; mi++)); do
    local out_var="MIX_${mi}_OUTPUT"
    local output_name="${!out_var}"
    local sc_var="MIX_${mi}_SRC_COUNT"
    local n_sources="${!sc_var}"

    local inputs=()
    local filter_parts=()
    local amix_inputs=()
    local all_present=true

    for ((j=0; j<n_sources; j++)); do
      local fvar="MIX_${mi}_SRC_${j}_FILE"
      local pvar="MIX_${mi}_SRC_${j}_PAN"
      local fname="${!fvar}"
      local pan="${!pvar}"
      local fpath="${SOURCE_DIR}/${fname}.flac"

      if [[ ! -f "$fpath" ]]; then
        warn "Source absente pour le mix '${output_name}' : ${fname}.flac — mix ignoré"
        all_present=false; break
      fi

      inputs+=(-i "$fpath")
      local gain_l gain_r
      gain_l="$(python3 -c "print((100 - ${pan}) / 100)")"
      gain_r="$(python3 -c "print((100 + ${pan}) / 100)")"
      filter_parts+=("[${j}:a]pan=stereo|c0=${gain_l}*c0|c1=${gain_r}*c0[a${j}]")
      amix_inputs+=("[a${j}]")
    done

    [[ "$all_present" == false ]] && continue

    local fc
    fc="$(IFS=';'; echo "${filter_parts[*]}");"
    fc+="$(printf '%s' "${amix_inputs[@]}")amix=inputs=${n_sources}:normalize=0[out]"

    local out_path="${WORK_DIR}/${output_name}.flac"
    log "Mix : ${output_name}"
    ffmpeg -y -hide_banner -loglevel warning \
      "${inputs[@]}" \
      -filter_complex "$fc" \
      -map "[out]" "$out_path"
    ok "→ ${output_name}.flac"

    MIX_OUTPUT_PATHS+=("$out_path")
    MIX_OUTPUT_NAMES+=("$output_name")
  done
}

# ────────────────────────── Compression + Normalisation ──────

ALL_TRACK_PATHS=()
ALL_TRACK_NAMES=()

compress_normalize() {
  next_step "Compression et normalisation"

  # Pistes FLAC source (hors exclus, hors sources-mix)
  for fpath in "${FLAC_FILES[@]}"; do
    local fname_no_ext
    fname_no_ext="$(basename "${fpath%.flac}")"
    if is_excluded "$fname_no_ext"; then
      warn "Piste exclue : ${fname_no_ext}"
      continue
    fi
    if is_mix_source "$fname_no_ext"; then
      continue  # traitée dans un mix
    fi
    ALL_TRACK_PATHS+=("$fpath")
    ALL_TRACK_NAMES+=("$fname_no_ext")
  done

  # Pistes mixées
  for ((i=0; i<${#MIX_OUTPUT_PATHS[@]}; i++)); do
    ALL_TRACK_PATHS+=("${MIX_OUTPUT_PATHS[$i]}")
    ALL_TRACK_NAMES+=("${MIX_OUTPUT_NAMES[$i]}")
  done

  [[ ${#ALL_TRACK_PATHS[@]} -gt 0 ]] || die "Aucune piste à traiter après filtrage."
  ok "${#ALL_TRACK_PATHS[@]} piste(s) à traiter"

  for ((ti=0; ti<${#ALL_TRACK_PATHS[@]}; ti++)); do
    local src="${ALL_TRACK_PATHS[$ti]}"
    local name="${ALL_TRACK_NAMES[$ti]}"
    log "  Compression : ${name}"

    local compressed="${WORK_DIR}/compressed/${name}.flac"
    ffmpeg -y -hide_banner -loglevel warning \
      -i "$src" \
      -af "acompressor=threshold=${COMP_THRESHOLD}dB:ratio=${COMP_RATIO}:attack=${COMP_ATTACK}:release=${COMP_RELEASE}:knee=${COMP_KNEE}dB:makeup=1" \
      "$compressed"

    local max_vol
    max_vol="$(ffmpeg -i "$compressed" -af volumedetect -f null /dev/null 2>&1 \
      | grep max_volume \
      | awk '{print $5}')"

    local gain
    gain="$(echo "${NORMALIZE_PEAK_DB} - (${max_vol})" | bc -l)"
    log "  Normalisation : ${name} (peak=${max_vol}dB → gain=${gain}dB)"

    local normalized="${WORK_DIR}/normalized/${name}.flac"
    ffmpeg -y -hide_banner -loglevel warning \
      -i "$compressed" \
      -af "volume=${gain}dB" \
      "$normalized"

    ok "  → ${name}.flac normalisé"
  done
}

# ────────────────────────── Découpe en segments ──────────────

split_segments() {
  next_step "Découpe en segments"

  for ((ti=0; ti<${#ALL_TRACK_NAMES[@]}; ti++)); do
    local name="${ALL_TRACK_NAMES[$ti]}"
    local normalized="${WORK_DIR}/normalized/${name}.flac"

    for ((si=0; si<SEG_COUNT; si++)); do
      local seg_num
      seg_num="$(printf '%02d' $((si+1)))"
      local start="${SEGMENT_STARTS[$si]}"
      local end
      if [[ $((si+1)) -lt $SEG_COUNT ]]; then
        end="${SEGMENT_STARTS[$((si+1))]}"
      else
        end="$TOTAL_DURATION"
      fi

      ffmpeg -y -hide_banner -loglevel warning \
        -i "$normalized" \
        -ss "$start" -to "$end" \
        -c copy \
        "${WORK_DIR}/segments/${seg_num}/${name}.flac"
    done
    ok "  ${name} → ${SEG_COUNT} segment(s)"
  done
}

# ────────────────────────── Conversion MP3 + sortie ─────────

OUTPUT_DIRS=()

convert_output() {
  next_step "Conversion MP3 et dossiers de sortie"

  for ((si=0; si<SEG_COUNT; si++)); do
    local seg_num
    seg_num="$(printf '%02d' $((si+1)))"
    local label="${SEGMENT_LABELS[$si]}"

    local out_dir_name
    if [[ -n "$label" ]]; then
      out_dir_name="${SOURCE_NAME} - ${seg_num} - ${label}"
    else
      out_dir_name="${SOURCE_NAME} - ${seg_num}"
    fi

    local out_dir="${GROOVES_DIR}/${out_dir_name}"

    if [[ -d "$out_dir" ]]; then
      warn "Écrasement de ${out_dir_name}..."
      rm -rf "$out_dir"
    fi
    mkdir -p "$out_dir"
    OUTPUT_DIRS+=("$out_dir")

    for ((ti=0; ti<${#ALL_TRACK_NAMES[@]}; ti++)); do
      local name="${ALL_TRACK_NAMES[$ti]}"
      local seg_flac="${WORK_DIR}/segments/${seg_num}/${name}.flac"
      local out_name="${name/ MIX/}"
      local out_mp3="${out_dir}/${out_name}.mp3"

      ffmpeg -y -hide_banner -loglevel warning \
        -i "$seg_flac" \
        -b:a "$MP3_BITRATE" \
        -map_metadata -1 \
        "$out_mp3"
    done
    ok "→ ${out_dir_name}/"
  done
}

# ────────────────────────── Nettoyage ────────────────────────

cleanup() {
  next_step "Nettoyage"

  if [[ "$KEEP_WORK" == true ]]; then
    warn "--keep-work : dossier _work/ conservé → ${WORK_DIR}"
  else
    rm -rf "$WORK_DIR"
    ok "_work/ supprimé"
  fi
}

# ────────────────────────── Résumé ───────────────────────────

print_summary() {
  echo
  echo -e "${BOLD}${GREEN}═══ Traitement terminé ═══${RESET}"
  echo -e "  Dossier source  : ${SOURCE_NAME}"
  echo -e "  Segments créés  : ${SEG_COUNT}"
  echo -e "  Pistes/segment  : ${#ALL_TRACK_NAMES[@]}"
  echo -e "  Dossiers créés  :"
  for d in "${OUTPUT_DIRS[@]}"; do
    echo -e "    • $(basename "$d")"
  done
  echo
}

# ────────────────────────── Main ─────────────────────────────

main() {
  check_deps
  parse_args "$@"
  load_config
  validate_input
  parse_labels
  setup_dirs
  build_mixes
  compress_normalize
  split_segments
  convert_output
  cleanup
  print_summary
}

main "$@"
