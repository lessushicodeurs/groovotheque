#!/usr/bin/env python3
"""Pilote Audacity via mod-script-pipe pour appliquer compressor → normalize → gain sur des fichiers FLAC."""

import argparse
import os
import subprocess
import sys
import time

# ─────────────────────────── Presets ───────────────────────────
# Source : docs/audacity-presets/compressor.md
PRESETS = {
    # Général
    "Modern":           {"threshold": -14, "ratio": 4,    "attack": 0.2,  "release": 210,   "knee": 18,   "makeup": 0,   "lookahead": 1},
    "Glue Compressor":  {"threshold": -22, "ratio": 1.2,  "attack": 20,   "release": 1000,  "knee": 12,   "makeup": 2.5, "lookahead": 1},
    "Gentle":           {"threshold": -18, "ratio": 1.5,  "attack": 1,    "release": 100,   "knee": 6,    "makeup": 0,   "lookahead": 1},
    "Beat Booster":     {"threshold": -18, "ratio": 4,    "attack": 14,   "release": 9,     "knee": 1,    "makeup": 3,   "lookahead": 1},
    # Mastering
    "Deep Dive Master":     {"threshold": -23.5, "ratio": 1.2,  "attack": 52.2, "release": 12.2,  "knee": 1,    "makeup": 1.6, "lookahead": 33.2},
    "Beefy Master":         {"threshold": -16.8, "ratio": 1.2,  "attack": 49.6, "release": 17.9,  "knee": 4.9,  "makeup": 2.5, "lookahead": 100},
    "Make It Right Master": {"threshold": -6.5,  "ratio": 1.4,  "attack": 1,    "release": 1,     "knee": 1,    "makeup": 1.6, "lookahead": 10},
    "Brick Wall Master":    {"threshold": -10,   "ratio": 100,  "attack": 0,    "release": 2,     "knee": 2,    "makeup": 3,   "lookahead": 1},
    # Voix
    "Lead Vocals":        {"threshold": -14, "ratio": 5.2,  "attack": 1,    "release": 60,    "knee": 5.5,  "makeup": 0,   "lookahead": 1},
    "Fat Vocals":         {"threshold": -32, "ratio": 1.7,  "attack": 86.9, "release": 15.2,  "knee": 5,    "makeup": 2.5, "lookahead": 1},
    "Power Vocals":       {"threshold": -16.8, "ratio": 1.5, "attack": 2.8, "release": 356.3, "knee": 19.6, "makeup": 3,   "lookahead": 46.2},
    "Vocal Control":      {"threshold": -15, "ratio": 3,    "attack": 0,    "release": 196,   "knee": 23.5, "makeup": 4.5, "lookahead": 1},
    "Vocal Touch-Up":     {"threshold": -22, "ratio": 1.5,  "attack": 2,    "release": 450,   "knee": 30,   "makeup": 3.6, "lookahead": 0},
    "Voice Memos Balancer": {"threshold": -22.3, "ratio": 10.1, "attack": 6.5, "release": 3.6, "knee": 5.8, "makeup": 4.5, "lookahead": 1},
    "Podcast/Radio":      {"threshold": -15, "ratio": 3,    "attack": 15,   "release": 40,    "knee": 24,   "makeup": 1,   "lookahead": 1},
    # Instruments
    "Piano":          {"threshold": -16, "ratio": 2,    "attack": 0.2,  "release": 150,   "knee": 18,   "makeup": 1,   "lookahead": 1},
    "Acoustic Guitar": {"threshold": -15, "ratio": 2.5, "attack": 15,   "release": 225,   "knee": 8,    "makeup": 1.5, "lookahead": 1},
    "Bass Guitar":    {"threshold": -13, "ratio": 3,    "attack": 1,    "release": 50,    "knee": 2,    "makeup": 0,   "lookahead": 40},
    "Strings":        {"threshold": -15, "ratio": 1.8,  "attack": 30,   "release": 400,   "knee": 14.3, "makeup": 2.5, "lookahead": 1},
    "Kick Drums":     {"threshold": -14, "ratio": 4,    "attack": 30,   "release": 120,   "knee": 0.5,  "makeup": 2,   "lookahead": 1},
    "Drums Control":  {"threshold": -12, "ratio": 2,    "attack": 2,    "release": 40,    "knee": 29,   "makeup": 1,   "lookahead": 1},
    # SFX
    "Climax Impulser SFX": {"threshold": -55.1, "ratio": 23.4, "attack": 172,   "release": 813.4, "knee": 27.4, "makeup": 0,   "lookahead": 0},
    "Engine Breathing SFX": {"threshold": -37.7, "ratio": 4.7, "attack": 190.2, "release": 0.2,   "knee": 3.5,  "makeup": 0,   "lookahead": 2.3},
    "Great Impact SFX": {"threshold": -49.3, "ratio": 24.6, "attack": 172,   "release": 562.6, "knee": 5,    "makeup": 8.3, "lookahead": 0.6},
    "Great Body SFX":   {"threshold": -32.8, "ratio": 2.4,  "attack": 74.6,  "release": 204.8, "knee": 0.3,  "makeup": 8.6, "lookahead": 29.3},
    "Great Tail SFX":   {"threshold": -55.4, "ratio": 2.4,  "attack": 1.4,   "release": 199.6, "knee": 0.3,  "makeup": 23.9, "lookahead": 0},
    "Smack Explosion SFX": {"threshold": -32.5, "ratio": 5.9, "attack": 155.5, "release": 1.7, "knee": 24.4, "makeup": 7.1, "lookahead": 1.3},
}

# ─────────────────────────── Pipe Audacity ─────────────────────

PIPE_TIMEOUT = 30  # secondes


def _pipe_path():
    uid = os.getuid()
    return f"/tmp/audacity_script_pipe.to.{uid}"


MOD_SCRIPT_PIPE_HELP = (
    "  → Activer mod-script-pipe dans Audacity :\n"
    "      Edit → Preferences → Modules → mod-script-pipe : Enabled → redémarrer Audacity"
)


def _audacity_is_running() -> bool:
    try:
        result = subprocess.run(["pgrep", "-x", "audacity"], capture_output=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False


def _ensure_audacity_running():
    pipe = _pipe_path()
    if os.path.exists(pipe):
        return

    if _audacity_is_running():
        print(
            "Erreur : Audacity est ouvert mais le pipe mod-script-pipe est absent.\n"
            + MOD_SCRIPT_PIPE_HELP,
            file=sys.stderr,
        )
        sys.exit(1)

    print("Audacity non lancé — démarrage via Flatpak...", flush=True)
    subprocess.Popen(
        ["flatpak", "run", "org.audacityteam.Audacity"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    deadline = time.time() + PIPE_TIMEOUT
    while not os.path.exists(pipe):
        if time.time() > deadline:
            print(
                f"Erreur : le pipe Audacity n'est pas apparu après {PIPE_TIMEOUT}s.\n"
                + MOD_SCRIPT_PIPE_HELP,
                file=sys.stderr,
            )
            sys.exit(1)
        time.sleep(0.5)

    # Laisser Audacity finir son initialisation
    time.sleep(2)
    print("Audacity prêt.", flush=True)


class AudacityPipe:
    """Connexion synchrone au pipe mod-script-pipe d'Audacity."""

    def __init__(self):
        uid = os.getuid()
        self._to_path = f"/tmp/audacity_script_pipe.to.{uid}"
        self._from_path = f"/tmp/audacity_script_pipe.from.{uid}"
        self._to = open(self._to_path, "w")
        self._from = open(self._from_path, "r")

    def send(self, command: str) -> str:
        """Envoie une commande et retourne la réponse complète."""
        self._to.write(command + "\n")
        self._to.flush()
        lines = []
        while True:
            line = self._from.readline()
            if line.endswith("\n"):
                line = line.rstrip("\n")
            if line == "":
                break
            lines.append(line)
        return "\n".join(lines)

    def close(self):
        self._to.close()
        self._from.close()


# ─────────────────────────── Traitement ────────────────────────

def _wait_for_tracks(pipe: AudacityPipe, timeout: int = 30) -> bool:
    """Sonde GetInfo:Tracks jusqu'à ce qu'au moins une piste soit chargée."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = pipe.send("GetInfo: Type=Tracks Format=JSON")
        # La réponse contient du JSON + "BatchCommand finished: OK"
        # Si des pistes sont présentes le JSON contiendra au moins "{"
        if "{" in resp:
            return True
        time.sleep(0.3)
    return False


def _compressor_command(params: dict) -> str:
    """Construit la commande Audacity DRC Compressor depuis un dict de paramètres."""
    return (
        f"DynamicRangeProcessor: "
        f"compressorThreshold={params['threshold']} "
        f"compressorRatio={params['ratio']} "
        f"compressorAttackTime={params['attack']} "
        f"compressorReleaseTime={params['release']} "
        f"compressorKneeWidth={params['knee']} "
        f"makeupGainDb={params['makeup']} "
        f"lookaheadMs={params['lookahead']} "
        f"processorType=0"
    )


def process_file(pipe: AudacityPipe, filepath: str, comp_params: dict | None,
                 normalize_db: float, gain_db: float):
    """Applique compressor → normalize → gain sur un fichier FLAC via le pipe."""
    abs_path = os.path.abspath(filepath)
    print(f"  Traitement : {os.path.basename(filepath)}", flush=True)

    # Ouvrir le fichier (OpenFiles est asynchrone — attendre le chargement)
    resp = pipe.send(f"OpenFiles: Filename={abs_path}")
    if "error" in resp.lower():
        print(f"    Erreur à l'ouverture : {resp}", file=sys.stderr)
        return

    if not _wait_for_tracks(pipe):
        print(f"    Timeout : la piste n'a pas été chargée dans Audacity", file=sys.stderr)
        pipe.send("Close: SaveChanges=No")
        return

    # Sélectionner tout
    pipe.send("SelectAll:")

    # Compression (optionnel)
    if comp_params is not None:
        print(f"    Compression ({comp_params})", flush=True)
        cmd = _compressor_command(comp_params)
        resp = pipe.send(cmd)
        if "error" in resp.lower():
            print(f"    Avertissement compresseur : {resp}", file=sys.stderr)

    # Normalisation (toujours)
    print(f"    Normalize: peak {normalize_db} dBFS", flush=True)
    pipe.send("SelectAll:")
    resp = pipe.send(f"Normalize: PeakLevel={normalize_db} ApplyGain=True RemoveDcOffset=False StereoIndependent=False")
    if "error" in resp.lower():
        print(f"    Avertissement normalize : {resp}", file=sys.stderr)

    # Gain additionnel (optionnel)
    if gain_db != 0.0:
        gain_factor = 10 ** (gain_db / 20)
        print(f"    Gain : {gain_db:+.1f} dB (ratio={gain_factor:.4f})", flush=True)
        pipe.send("SelectAll:")
        resp = pipe.send(f"Amplify: Ratio={gain_factor} AllowClipping=False")
        if "error" in resp.lower():
            print(f"    Avertissement gain : {resp}", file=sys.stderr)

    # Export sur place (FLAC)
    resp = pipe.send(f"Export2: Filename={abs_path} NumChannels=1")
    if "error" in resp.lower():
        print(f"    Avertissement export : {resp}", file=sys.stderr)

    # Fermer sans sauvegarder le projet Audacity
    pipe.send("Close: SaveChanges=No")
    print(f"    ✓ {os.path.basename(filepath)}", flush=True)


# ─────────────────────────── CLI ───────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Applique compressor → normalize → gain via Audacity mod-script-pipe."
    )
    # Preset ou paramètres directs
    parser.add_argument("--preset", help="Nom du preset de compression Audacity")
    parser.add_argument("--threshold", type=float, help="Seuil (dBFS)")
    parser.add_argument("--ratio",    type=float, help="Ratio de compression")
    parser.add_argument("--attack",   type=float, help="Attaque (ms)")
    parser.add_argument("--release",  type=float, help="Relâchement (ms)")
    parser.add_argument("--knee",     type=float, help="Knee (dB)")
    parser.add_argument("--lookahead", type=float, help="Lookahead (ms)")
    parser.add_argument("--makeup",   type=float, help="Makeup gain (dB)")
    # Normalisation
    parser.add_argument("--normalize", type=float, default=-1.0,
                        help="Niveau peak cible (dBFS, défaut -1)")
    # Gain additionnel
    parser.add_argument("--gain", type=float, default=0.0,
                        help="Gain additionnel après normalisation (dB)")
    # Fichiers
    parser.add_argument("files", nargs="+", help="Fichiers FLAC à traiter")
    return parser.parse_args()


def resolve_compression(args) -> dict | None:
    """Résout les paramètres de compression depuis le preset ou les flags directs."""
    if args.preset:
        if args.preset not in PRESETS:
            print(f"Erreur : preset inconnu '{args.preset}'.\nPresets disponibles :", file=sys.stderr)
            for name in sorted(PRESETS):
                print(f"  - {name}", file=sys.stderr)
            sys.exit(1)
        return dict(PRESETS[args.preset])

    direct_params = {
        "threshold": args.threshold,
        "ratio":     args.ratio,
        "attack":    args.attack,
        "release":   args.release,
        "knee":      args.knee,
        "lookahead": args.lookahead,
        "makeup":    args.makeup,
    }
    provided = {k: v for k, v in direct_params.items() if v is not None}
    if not provided:
        return None  # Pas de compression

    # Valeurs par défaut si paramètres partiels
    defaults = {"threshold": -20, "ratio": 3, "attack": 20,
                "release": 200, "knee": 6, "lookahead": 1, "makeup": 0}
    return {**defaults, **provided}


def main():
    args = parse_args()
    comp_params = resolve_compression(args)

    _ensure_audacity_running()

    pipe = AudacityPipe()
    try:
        for filepath in args.files:
            if not os.path.isfile(filepath):
                print(f"Fichier introuvable : {filepath}", file=sys.stderr)
                continue
            process_file(pipe, filepath, comp_params, args.normalize, args.gain)
    finally:
        pipe.close()


if __name__ == "__main__":
    main()
