#!/usr/bin/env bash
# process-rehearsal.sh — Pipeline de traitement audio pour la groovothèque
# Usage: ./scripts/process-rehearsal.sh [--keep-work] "path/to/dossier"
set -euo pipefail

# ────────────────────────── Helpers ──────────────────────────

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

STEP=0
TOTAL_STEPS=8

log()  { echo -e "${CYAN}[${STEP}/${TOTAL_STEPS}]${RESET} $*"; }
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✗${RESET}  $*" >&2; }
die()  { err "$*"; exit 1; }

next_step() { STEP=$((STEP + 1)); echo; echo -e "${BOLD}── Étape ${STEP}/${TOTAL_STEPS} : $* ──${RESET}"; }
trim()      { local s="$1"; s="${s#"${s%%[^[:space:]]*}"}"; s="${s%"${s##*[^[:space:]]}"}"; echo "$s"; }

# ────────────────────────── Dépendances ──────────────────────

YAML_PARSER=""
HAS_AUBIO=false

check_deps() {
  for cmd in ffmpeg ffprobe bc; do
    command -v "$cmd" &>/dev/null || die "$cmd est requis mais introuvable."
  done
  if command -v python3 &>/dev/null && python3 -c "import yaml, json" &>/dev/null 2>&1; then
    YAML_PARSER="python3"
  elif command -v yq &>/dev/null; then
    YAML_PARSER="yq"
  else
    die "python3 (avec pyyaml) ou yq est requis pour lire la config YAML."
  fi
  if command -v aubiotrack &>/dev/null; then
    HAS_AUBIO=true
  else
    warn "aubiotrack introuvable — création des fiches .md désactivée"
  fi
}

# ────────────────────────── Config YAML ──────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/process-rehearsal.yaml"

# Variables remplies par load_config
MP3_BITRATE=""
MIXES_COUNT=0
EXCLUDES_COUNT=0
# MIX_<i>_OUTPUT, MIX_<i>_SRC_COUNT, MIX_<i>_SRC_<j>_FILE, MIX_<i>_SRC_<j>_PAN, MIX_<i>_SRC_<j>_GAIN
# EXCLUDE_<i>
# MIX_ALL_SOURCES : tableau plat de tous les fichiers sources des mixes

MIX_ALL_SOURCES=()

# Tables de réglages par piste (clé = nom de piste sans extension)
# TRACK_EFFECTS_JSON[name] = JSON array des steps effects
declare -A TRACK_EFFECTS_JSON=()
declare -A BLABLA_PANS=()

load_config_python() {
  local cfg="$1"
  # Un seul appel Python; toutes les sorties sont évaluées via eval
  eval "$(REHEARSAL_CONFIG="$cfg" python3 - <<'PYEOF'
import yaml, json, os, sys

KNOWN_TYPES = {"compress", "normalize", "gain", "pan"}

cfg_path = os.environ['REHEARSAL_CONFIG']
with open(cfg_path) as f:
    cfg = yaml.safe_load(f)

audio = cfg.get('audio', {})

def sh(val):
    return str(val).replace("'", "'\\''")

def json_sh(val):
    """Sérialise en JSON et échappe pour le shell single-quote."""
    return json.dumps(val).replace("'", "'\\''")

print(f"MP3_BITRATE='{sh(audio.get('mp3_bitrate','320k'))}'")

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
        print(f"MIX_{i}_SRC_{j}_GAIN='{sh(s.get('gain_db', 0))}'")

excludes = tracks.get('exclude', [])
print(f"EXCLUDES_COUNT='{len(excludes)}'")
for i, e in enumerate(excludes):
    print(f"EXCLUDE_{i}='{sh(e)}'")

per_track = tracks.get('per_track') or {}
print(f"PER_TRACK_COUNT='{len(per_track)}'")
for i, (name, settings) in enumerate(per_track.items()):
    s = settings or {}
    effects = s.get('effects')

    print(f"PER_TRACK_{i}_NAME='{sh(name)}'")

    if effects is None:
        # Pas de bloc effects → warning sera émis par le shell, JSON vide
        print(f"PER_TRACK_{i}_HAS_EFFECTS='false'")
        print(f"PER_TRACK_{i}_EFFECTS_JSON='[]'")
        continue

    # Valider et normaliser chaque step
    validated = []
    for step_idx, step in enumerate(effects):
        step_type = step.get('type')
        if step_type not in KNOWN_TYPES:
            print(f"FATAL_ERROR='type inconnu au step {step_idx + 1} de la piste {name}: \"{step_type}\". Types supportés : {sorted(KNOWN_TYPES)}'")
            print(f"PER_TRACK_{i}_HAS_EFFECTS='false'")
            print(f"PER_TRACK_{i}_EFFECTS_JSON='[]'")
            break

        if step_type == 'gain' and 'db' not in step:
            print(f"FATAL_ERROR='step gain sans champ db obligatoire (piste {name}, step {step_idx + 1})'")
            print(f"PER_TRACK_{i}_HAS_EFFECTS='false'")
            print(f"PER_TRACK_{i}_EFFECTS_JSON='[]'")
            break

        if step_type == 'pan' and 'position' not in step:
            print(f"FATAL_ERROR='step pan sans champ position obligatoire (piste {name}, step {step_idx + 1})'")
            print(f"PER_TRACK_{i}_HAS_EFFECTS='false'")
            print(f"PER_TRACK_{i}_EFFECTS_JSON='[]'")
            break

        validated.append(step)
    else:
        # Tous les steps sont valides
        print(f"PER_TRACK_{i}_HAS_EFFECTS='true'")
        print(f"PER_TRACK_{i}_EFFECTS_JSON='{json_sh(validated)}'")

blabla_pans = (cfg.get('blabla_mix') or {}).get('pans') or {}
print(f"BLABLA_PANS_COUNT='{len(blabla_pans)}'")
for i, (name, pan) in enumerate(blabla_pans.items()):
    print(f"BLABLA_PANS_NAME_{i}='{sh(name)}'")
    print(f"BLABLA_PANS_VAL_{i}='{sh(pan)}'")
PYEOF
  )"
}

load_config_yq() {
  local cfg="$1"
  MP3_BITRATE="$(yq e '.audio.mp3_bitrate' "$cfg")"
  MIXES_COUNT="$(yq e '.tracks.mixes | length' "$cfg")"
  for ((i=0; i<MIXES_COUNT; i++)); do
    declare -g "MIX_${i}_OUTPUT=$(yq e ".tracks.mixes[${i}].output" "$cfg")"
    local sc
    sc="$(yq e ".tracks.mixes[${i}].sources | length" "$cfg")"
    declare -g "MIX_${i}_SRC_COUNT=${sc}"
    for ((j=0; j<sc; j++)); do
      declare -g "MIX_${i}_SRC_${j}_FILE=$(yq e ".tracks.mixes[${i}].sources[${j}].file" "$cfg")"
      declare -g "MIX_${i}_SRC_${j}_PAN=$(yq e ".tracks.mixes[${i}].sources[${j}].pan" "$cfg")"
      declare -g "MIX_${i}_SRC_${j}_GAIN=$(yq e ".tracks.mixes[${i}].sources[${j}].gain_db // 0" "$cfg")"
    done
  done
  EXCLUDES_COUNT="$(yq e '.tracks.exclude | length' "$cfg")"
  for ((i=0; i<EXCLUDES_COUNT; i++)); do
    declare -g "EXCLUDE_${i}=$(yq e ".tracks.exclude[${i}]" "$cfg")"
  done
  # yq : lire effects par piste
  local ptc
  ptc="$(yq e '.tracks.per_track | keys | length' "$cfg")"
  declare -g "PER_TRACK_COUNT=${ptc}"
  for ((i=0; i<ptc; i++)); do
    local name
    name="$(yq e ".tracks.per_track | keys | .[${i}]" "$cfg")"
    declare -g "PER_TRACK_${i}_NAME=${name}"
    local effects_json
    effects_json="$(yq e ".tracks.per_track.\"${name}\".effects // []" -o=json "$cfg")"
    if [[ "$effects_json" == "[]" ]]; then
      declare -g "PER_TRACK_${i}_HAS_EFFECTS=false"
    else
      declare -g "PER_TRACK_${i}_HAS_EFFECTS=true"
    fi
    declare -g "PER_TRACK_${i}_EFFECTS_JSON=${effects_json}"
  done
  BLABLA_PANS_COUNT=0
  while IFS='=' read -r key val; do
    [[ -z "$key" ]] && continue
    declare -g "BLABLA_PANS_NAME_${BLABLA_PANS_COUNT}=${key}"
    declare -g "BLABLA_PANS_VAL_${BLABLA_PANS_COUNT}=${val}"
    BLABLA_PANS_COUNT=$((BLABLA_PANS_COUNT + 1))
  done < <(yq e '.blabla_mix.pans // {} | to_entries | .[] | .key + "=" + (.value | tostring)' "$cfg" 2>/dev/null || true)
}

load_config() {
  [[ -f "$CONFIG_FILE" ]] || die "Config introuvable : $CONFIG_FILE"
  if [[ "$YAML_PARSER" == "python3" ]]; then
    load_config_python "$CONFIG_FILE"
  else
    load_config_yq "$CONFIG_FILE"
  fi

  # Vérifier erreur fatale signalée par le parser Python
  if [[ -n "${FATAL_ERROR:-}" ]]; then
    die "Erreur fatale dans le config : ${FATAL_ERROR}"
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

  # Peupler les tables de réglages par piste
  TRACK_EFFECTS_JSON=()
  local ptc="${PER_TRACK_COUNT:-0}"
  for ((i=0; i<ptc; i++)); do
    local n_var="PER_TRACK_${i}_NAME"
    local he_var="PER_TRACK_${i}_HAS_EFFECTS"
    local ej_var="PER_TRACK_${i}_EFFECTS_JSON"
    local name="${!n_var}"
    local has_effects="${!he_var:-false}"
    TRACK_EFFECTS_JSON["$name"]="${!ej_var:-[]}"
    if [[ "$has_effects" != "true" ]]; then
      warn "[WARN] Piste '${name}' sans bloc effects: — passthrough silencieux"
    fi
  done

  # Peupler la table de pans blabla
  BLABLA_PANS=()
  local bpc="${BLABLA_PANS_COUNT:-0}"
  for ((i=0; i<bpc; i++)); do
    local bn_var="BLABLA_PANS_NAME_${i}"
    local bv_var="BLABLA_PANS_VAL_${i}"
    BLABLA_PANS["${!bn_var}"]="${!bv_var}"
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
    warn "Aucun fichier .txt d'étiquettes — traitement en segment unique"
    LABELS_FILE=""
  elif [[ ${#txt_files[@]} -gt 1 ]]; then
    warn "Plusieurs fichiers .txt trouvés — utilisation du plus récent"
    LABELS_FILE="$(ls -t "${txt_files[@]}" | head -1)"
    ok "Fichier étiquettes : $(basename "$LABELS_FILE")"
  else
    LABELS_FILE="${txt_files[0]}"
    ok "Fichier étiquettes : $(basename "$LABELS_FILE")"
  fi
}

# ────────────────────────── Parsing étiquettes ───────────────

SEGMENT_STARTS=()
SEGMENT_LABELS=()
SEG_COUNT=0
TOTAL_DURATION=""

parse_labels() {
  next_step "Parsing des étiquettes Audacity"

  TOTAL_DURATION="$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "${FLAC_FILES[0]}")"
  ok "Durée totale : ${TOTAL_DURATION}s"

  if [[ -z "$LABELS_FILE" ]]; then
    SEGMENT_STARTS=(0)
    SEGMENT_LABELS=("")
    SEG_COUNT=1
    ok "1 segment (durée totale)"
    return
  fi

  mapfile -t raw_lines < <(grep -v '^[[:space:]]*$' "$LABELS_FILE")
  [[ ${#raw_lines[@]} -gt 0 ]] || die "Fichier d'étiquettes vide."

  for line in "${raw_lines[@]}"; do
    IFS=$'\t' read -r col1 _col2 col3 <<<"$line"
    SEGMENT_STARTS+=("$col1")
    SEGMENT_LABELS+=("$(trim "${col3:-}")")
  done

  SEG_COUNT=${#SEGMENT_STARTS[@]}
  ok "${SEG_COUNT} segment(s) détecté(s)"
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
  mkdir -p "${WORK_DIR}/normalized"
  for ((i=0; i<SEG_COUNT; i++)); do
    mkdir -p "${WORK_DIR}/segments/$(printf '%02d' $((i+1)))"
  done
}

# ────────────────────────── Moteur d'effets ──────────────────

# Applique la chaîne d'effets d'une piste sur un fichier FLAC.
# Entrée : fichier courant ; sortie : même fichier modifié in-place.
# Les steps compress et normalize passent par Audacity (audacity_process.py --step).
# Les steps gain et pan passent directement par ffmpeg.
apply_effects_chain() {
  local name="$1"
  local filepath="$2"   # fichier FLAC de travail (sera modifié in-place)
  local effects_json="${TRACK_EFFECTS_JSON[$name]:-[]}"

  if [[ "$effects_json" == "[]" ]]; then
    return
  fi

  local step_count
  step_count="$(python3 -c "import json,sys; print(len(json.loads(sys.argv[1])))" "$effects_json")"

  local SCRIPT_PY="${SCRIPT_DIR}/audacity_process.py"

  for ((si=0; si<step_count; si++)); do
    local step_json
    step_json="$(python3 -c "import json,sys; print(json.dumps(json.loads(sys.argv[1])[int(sys.argv[2])]))" "$effects_json" "$si")"

    local step_type
    step_type="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['type'])" "$step_json")"

    log "    [${name}] step $((si+1))/${step_count} : ${step_type}"

    case "$step_type" in

      compress)
        # Lire preset et overrides inline
        local preset
        preset="$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('preset',''))" "$step_json")"
        local py_args=(--step compress)
        [[ -n "$preset" ]] && py_args+=(--preset "$preset")
        # Overrides inline
        for param in threshold ratio attack release knee lookahead makeup; do
          local val
          val="$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get(sys.argv[2],''))" "$step_json" "$param")"
          [[ -n "$val" ]] && py_args+=(--"$param" "$val")
        done
        [[ -f "$SCRIPT_PY" ]] || die "Script introuvable : $SCRIPT_PY"
        python3 "$SCRIPT_PY" "${py_args[@]}" "$filepath"
        ;;

      normalize)
        local target_db
        target_db="$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('target_db', -1))" "$step_json")"
        [[ -f "$SCRIPT_PY" ]] || die "Script introuvable : $SCRIPT_PY"
        python3 "$SCRIPT_PY" --step normalize --normalize "$target_db" "$filepath"
        ;;

      gain)
        local db
        db="$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['db'])" "$step_json")"
        local tmp_flac="${filepath%.flac}_gain_tmp.flac"
        ffmpeg -y -hide_banner -loglevel warning \
          -i "$filepath" \
          -af "volume=${db}dB" \
          "$tmp_flac"
        mv "$tmp_flac" "$filepath"
        ok "    → gain ${db} dB appliqué"
        ;;

      pan)
        local position
        position="$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['position'])" "$step_json")"
        local gain_l gain_r
        gain_l="$(python3 -c "print((100 - ${position}) / 100)")"
        gain_r="$(python3 -c "print((100 + ${position}) / 100)")"
        local tmp_flac="${filepath%.flac}_pan_tmp.flac"
        ffmpeg -y -hide_banner -loglevel warning \
          -i "$filepath" \
          -af "aformat=channel_layouts=stereo,pan=stereo|c0=${gain_l}*c0|c1=${gain_r}*c0" \
          "$tmp_flac"
        mv "$tmp_flac" "$filepath"
        ok "    → pan ${position} appliqué"
        ;;

      *)
        die "Erreur fatale : type d'effet inconnu '${step_type}' (piste '${name}'). Types supportés : compress, normalize, gain, pan."
        ;;
    esac
  done
}

# ────────────────────────── Traitement des pistes ────────────

ALL_TRACK_PATHS=()
ALL_TRACK_NAMES=()

compress_normalize() {
  next_step "Application de la chaîne d'effets"

  # Toutes les pistes (hors exclus) sont traitées, y compris les sources de mixes
  local all_sources=()
  local all_names=()
  for fpath in "${FLAC_FILES[@]}"; do
    local fname_no_ext
    fname_no_ext="$(basename "${fpath%.flac}")"
    if is_excluded "$fname_no_ext"; then
      warn "Piste exclue : ${fname_no_ext}"
      continue
    fi
    all_sources+=("$fpath")
    all_names+=("$fname_no_ext")
    if ! is_mix_source "$fname_no_ext"; then
      ALL_TRACK_PATHS+=("$fpath")
      ALL_TRACK_NAMES+=("$fname_no_ext")
    fi
  done
  # Les pistes mixées seront ajoutées à ALL_TRACK_PATHS/NAMES par build_mixes()

  [[ ${#all_sources[@]} -gt 0 ]] || die "Aucune piste à traiter après filtrage."
  ok "${#all_sources[@]} piste(s) à traiter"

  for ((ti=0; ti<${#all_sources[@]}; ti++)); do
    local src="${all_sources[$ti]}"
    local name="${all_names[$ti]}"

    # Copier la source vers le dossier normalized
    local dest="${WORK_DIR}/normalized/${name}.flac"
    cp "$src" "$dest"

    # Appliquer la chaîne d'effets
    apply_effects_chain "$name" "$dest"

    ok "  → ${name}.flac"
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
      local gvar="MIX_${mi}_SRC_${j}_GAIN"
      local fname="${!fvar}"
      local pan="${!pvar}"
      local gain_db="${!gvar:-0}"
      local fpath="${WORK_DIR}/normalized/${fname}.flac"

      if [[ ! -f "$fpath" ]]; then
        warn "Source normalisée absente pour le mix '${output_name}' : ${fname}.flac — mix ignoré"
        all_present=false; break
      fi

      inputs+=(-i "$fpath")
      local gain_l gain_r
      gain_l="$(python3 -c "import math; g=10**(${gain_db}/20); print((100 - ${pan}) / 100 * g)")"
      gain_r="$(python3 -c "import math; g=10**(${gain_db}/20); print((100 + ${pan}) / 100 * g)")"
      filter_parts+=("[${j}:a]pan=stereo|c0=${gain_l}*c0|c1=${gain_r}*c0[a${j}]")
      amix_inputs+=("[a${j}]")
    done

    [[ "$all_present" == false ]] && continue

    local fc
    fc="$(IFS=';'; echo "${filter_parts[*]}");"
    fc+="$(printf '%s' "${amix_inputs[@]}")amix=inputs=${n_sources}:normalize=0[out]"

    local out_path="${WORK_DIR}/normalized/${output_name}.flac"
    log "Mix : ${output_name}"
    ffmpeg -y -hide_banner -loglevel warning \
      "${inputs[@]}" \
      -filter_complex "$fc" \
      -map "[out]" "$out_path"
    ok "→ ${output_name}.flac"

    # Appliquer la chaîne d'effets du mix (si définie)
    apply_effects_chain "$output_name" "$out_path"

    ALL_TRACK_PATHS+=("$out_path")
    ALL_TRACK_NAMES+=("$output_name")
  done
}

# ────────────────────────── Découpe en segments ──────────────

split_segments() {
  next_step "Découpe en segments"

  # Boucle par piste — segments blabla ignorés (traités dans le second bloc)
  for ((ti=0; ti<${#ALL_TRACK_NAMES[@]}; ti++)); do
    local name="${ALL_TRACK_NAMES[$ti]}"
    local normalized="${WORK_DIR}/normalized/${name}.flac"

    # Durée réelle de ce fichier normalisé (peut différer des autres pistes)
    local track_dur
    track_dur="$(ffprobe -v error -show_entries format=duration \
      -of default=noprint_wrappers=1:nokey=1 "$normalized")"

    local produced=0
    for ((si=0; si<SEG_COUNT; si++)); do
      # Les segments blabla ne génèrent pas de pistes individuelles
      [[ "${SEGMENT_LABELS[$si]}" == "blabla" ]] && continue

      local seg_num
      seg_num="$(printf '%02d' $((si+1)))"
      local start="${SEGMENT_STARTS[$si]}"
      local end

      if [[ $((si+1)) -lt $SEG_COUNT ]]; then
        end="${SEGMENT_STARTS[$((si+1))]}"
      else
        end="$track_dur"
      fi

      # Ignorer les segments dont le début dépasse la durée de la piste
      if [ "$(echo "$start >= $track_dur" | bc -l)" -eq 1 ]; then
        warn "  ${name}, seg ${seg_num} ignoré : début ${start}s ≥ durée ${track_dur}s"
        continue
      fi

      # Ramener la fin à la durée réelle si nécessaire
      if [ "$(echo "$end > $track_dur" | bc -l)" -eq 1 ]; then
        end="$track_dur"
      fi

      # -ss -to en INPUT pour un seek efficace sur les grands fichiers
      ffmpeg -y -hide_banner -loglevel warning \
        -ss "$start" -to "$end" \
        -i "$normalized" \
        -c copy \
        "${WORK_DIR}/segments/${seg_num}/${name}.flac"
      produced=$((produced + 1))
    done
    ok "  ${name} → ${produced} segment(s) produit(s)"
  done

  # Mix stéréo pour les segments blabla
  for ((si=0; si<SEG_COUNT; si++)); do
    [[ "${SEGMENT_LABELS[$si]}" != "blabla" ]] && continue

    local seg_num
    seg_num="$(printf '%02d' $((si+1)))"
    local start="${SEGMENT_STARTS[$si]}"
    local end
    if [[ $((si+1)) -lt $SEG_COUNT ]]; then
      end="${SEGMENT_STARTS[$((si+1))]}"
    else
      end="$TOTAL_DURATION"
    fi

    local inputs=() filter_parts=() amix_inputs=()
    local n_mix=0

    for ((ti=0; ti<${#ALL_TRACK_NAMES[@]}; ti++)); do
      local name="${ALL_TRACK_NAMES[$ti]}"
      local normalized="${WORK_DIR}/normalized/${name}.flac"
      [[ -f "$normalized" ]] || continue

      local track_dur
      track_dur="$(ffprobe -v error -show_entries format=duration \
        -of default=noprint_wrappers=1:nokey=1 "$normalized")"

      [ "$(echo "$start >= $track_dur" | bc -l)" -eq 1 ] && continue

      local actual_end="$end"
      [ "$(echo "$actual_end > $track_dur" | bc -l)" -eq 1 ] && actual_end="$track_dur"

      local pan="${BLABLA_PANS[$name]:-0}"
      local gain_l gain_r
      gain_l="$(python3 -c "print((100 - ${pan}) / 100)")"
      gain_r="$(python3 -c "print((100 + ${pan}) / 100)")"

      inputs+=(-ss "$start" -to "$actual_end" -i "$normalized")
      filter_parts+=("[${n_mix}:a]aformat=channel_layouts=stereo,pan=stereo|c0=${gain_l}*c0|c1=${gain_r}*c1[a${n_mix}]")
      amix_inputs+=("[a${n_mix}]")
      n_mix=$((n_mix + 1))
    done

    if [[ $n_mix -eq 0 ]]; then
      warn "  Segment blabla ${seg_num} : aucune piste disponible"
      continue
    fi

    local fc
    fc="$(IFS=';'; echo "${filter_parts[*]}");"
    fc+="$(printf '%s' "${amix_inputs[@]}")amix=inputs=${n_mix}:normalize=0[out]"

    log "  Mix blabla segment ${seg_num} (${n_mix} piste(s))"
    ffmpeg -y -hide_banner -loglevel warning \
      "${inputs[@]}" \
      -filter_complex "$fc" \
      -map "[out]" \
      "${WORK_DIR}/segments/${seg_num}/blabla.flac"
    ok "  → segments/${seg_num}/blabla.flac"
  done
}

# ────────────────────────── Conversion MP3 + sortie ─────────

OUTPUT_DIRS=()
declare -A SEG_BPM=()

convert_output() {
  next_step "Conversion MP3 et dossiers de sortie"

  for ((si=0; si<SEG_COUNT; si++)); do
    local seg_num
    seg_num="$(printf '%02d' $((si+1)))"
    local label="${SEGMENT_LABELS[$si]}"

    local out_dir_name
    if [[ -n "$label" ]]; then
      out_dir_name="${SOURCE_NAME}_-_${seg_num}_-_${label}"
    else
      out_dir_name="${SOURCE_NAME}_-_${seg_num}"
    fi
    out_dir_name="${out_dir_name// /_}"

    local out_dir="${GROOVES_DIR}/${out_dir_name}"

    if [[ -d "$out_dir" ]]; then
      warn "Écrasement de ${out_dir_name}..."
      rm -rf "$out_dir"
    fi
    mkdir -p "$out_dir"
    OUTPUT_DIRS+=("$out_dir")

    local mp3_count=0

    if [[ "$label" == "blabla" ]]; then
      # Segment blabla : un seul fichier mix stéréo
      local blabla_flac="${WORK_DIR}/segments/${seg_num}/blabla.flac"
      if [[ -f "$blabla_flac" ]]; then
        ffmpeg -y -hide_banner -loglevel warning \
          -i "$blabla_flac" \
          -b:a "$MP3_BITRATE" \
          -map_metadata -1 \
          "${out_dir}/blabla.mp3"
        mp3_count=1
      fi
    else
      # Segment normal : une piste par fichier
      for ((ti=0; ti<${#ALL_TRACK_NAMES[@]}; ti++)); do
        local name="${ALL_TRACK_NAMES[$ti]}"
        local seg_flac="${WORK_DIR}/segments/${seg_num}/${name}.flac"

        # Le FLAC peut être absent si la piste a été ignorée (début > durée)
        [[ -f "$seg_flac" ]] || continue

        local out_name="${name/ MIX/}"
        local out_mp3="${out_dir}/${out_name}.mp3"

        ffmpeg -y -hide_banner -loglevel warning \
          -i "$seg_flac" \
          -b:a "$MP3_BITRATE" \
          -map_metadata -1 \
          "$out_mp3"
        mp3_count=$((mp3_count + 1))
      done
    fi

    if [[ $mp3_count -eq 0 ]]; then
      warn "Segment ${seg_num} ignoré : aucune piste dans ce segment"
      rm -rf "$out_dir"
      OUTPUT_DIRS=("${OUTPUT_DIRS[@]::${#OUTPUT_DIRS[@]}-1}")
    else
      ok "→ ${out_dir_name}/ (${mp3_count} piste(s))"
    fi
  done
}

# ────────────────────────── Fiches BPM ──────────────────────

create_md_sheets() {
  next_step "Création des fiches .md (BPM)"

  if [[ "$HAS_AUBIO" != "true" ]]; then
    warn "aubiotrack introuvable — création des fiches .md désactivée"
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

    # Collecter les BPM de chaque piste MP3 via aubiotrack (timestamps → BPM)
    local bpm_values=()
    for mp3 in "$out_dir"/*.mp3; do
      [[ -f "$mp3" ]] || continue
      local bpm_raw
      bpm_raw="$(aubiotrack -i "$mp3" 2>/dev/null | python3 -c "
import sys, statistics
times = [float(l) for l in sys.stdin if l.strip()]
if len(times) >= 2:
    diffs = [times[i+1]-times[i] for i in range(len(times)-1)]
    bpm = round(60 / statistics.median(diffs))
    if 20 <= bpm <= 400:
        print(bpm)
" 2>/dev/null || true)"
      [[ -n "$bpm_raw" ]] && bpm_values+=("$bpm_raw")
    done

    [[ ${#bpm_values[@]} -eq 0 ]] && continue

    # Médiane des BPM par piste, arrondie à l'entier
    local joined_bpms
    joined_bpms="$(IFS=','; echo "${bpm_values[*]}")"
    local bpm_median
    bpm_median="$(python3 -c "import statistics; print(round(statistics.median([${joined_bpms}])))")"

    # Reconstruire seg_num et label depuis le nom du dossier
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
    local dname
    dname="$(basename "$d")"
    echo -e "    • ${dname}"
    if [[ -n "${SEG_BPM[$dname]:-}" ]]; then
      local remainder="${dname#*_-_}"
      local label_part=""
      [[ "$remainder" == *"_-_"* ]] && label_part="${remainder#*_-_}"
      local label="${label_part//_/ }"
      [[ -z "$label" ]] && label="${remainder%%_-_*}"
      echo -e "      BPM : ${label} → ${SEG_BPM[$dname]}"
    fi
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
  compress_normalize
  build_mixes
  split_segments
  convert_output
  create_md_sheets
  cleanup
  print_summary
}

main "$@"
