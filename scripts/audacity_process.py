#!/usr/bin/env python3
"""Pilote Audacity via mod-script-pipe pour appliquer des effets audio sur des fichiers FLAC."""

import argparse
import fcntl
import json
import os
import select
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


def _pipe_is_live(pipe_path: str) -> bool:
    """Vérifie si Audacity lit activement le pipe (O_NONBLOCK échoue si aucun lecteur)."""
    try:
        fd = os.open(pipe_path, os.O_WRONLY | os.O_NONBLOCK)
        os.close(fd)
        return True
    except OSError:
        return False


def _ensure_audacity_running():
    pipe = _pipe_path()

    # Pipe présent et Audacity actif → rien à faire
    if os.path.exists(pipe) and _pipe_is_live(pipe):
        return

    # Pipe présent mais personne ne lit → FIFO stale (Audacity s'est fermé)
    if os.path.exists(pipe) and not _pipe_is_live(pipe):
        print("Pipe stale détecté (Audacity fermé) — redémarrage via Flatpak...", flush=True)
    else:
        print("Audacity non lancé — démarrage via Flatpak...", flush=True)

    subprocess.Popen(
        ["flatpak", "run", "org.audacityteam.Audacity"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Attendre que le pipe soit créé ET actif (Audacity le lit)
    deadline = time.time() + PIPE_TIMEOUT
    while True:
        if os.path.exists(pipe) and _pipe_is_live(pipe):
            break
        if time.time() > deadline:
            msg = (
                f"Erreur : le pipe Audacity n'est pas apparu après {PIPE_TIMEOUT}s.\n"
                + MOD_SCRIPT_PIPE_HELP
            )
            if os.path.exists(pipe):
                msg = (
                    "Erreur : Audacity est lancé mais le pipe mod-script-pipe est absent.\n"
                    + MOD_SCRIPT_PIPE_HELP
                )
            print(msg, file=sys.stderr)
            sys.exit(1)
        time.sleep(0.5)

    # Laisser Audacity finir son initialisation (le pipe est live mais les commandes
    # ne répondent pas encore pendant ~5s après que le pipe apparaît)
    time.sleep(6)
    print("Audacity prêt.", flush=True)


class AudacityPipe:
    """Connexion synchrone au pipe mod-script-pipe d'Audacity."""

    def __init__(self):
        uid = os.getuid()
        self._to_path = f"/tmp/audacity_script_pipe.to.{uid}"
        self._from_path = f"/tmp/audacity_script_pipe.from.{uid}"
        # Ouvrir en O_NONBLOCK puis repasser en mode bloquant pour les écritures
        # évite le blocage indéfini si le pipe n'a pas de lecteur
        fd = os.open(self._to_path, os.O_WRONLY | os.O_NONBLOCK)
        fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) & ~os.O_NONBLOCK)
        # UTF-8 explicite pour les chemins avec accents (é, è, etc.)
        self._to = os.fdopen(fd, "w", encoding="utf-8")
        self._from = open(self._from_path, "r", encoding="utf-8")
        # Vider les réponses résiduelles d'une session précédente
        self._drain(timeout=1.0)

    def send(self, command: str, timeout: float = 60.0):
        """Envoie une commande et retourne la réponse complète.

        Attend "BatchCommand finished:" comme terminateur réel (pas la ligne vide
        initiale qui est juste un ACK d'Audacity).
        Retourne None si le timeout expire sans recevoir BatchCommand finished.
        """
        self._to.write(command + "\n")
        self._to.flush()
        result = ""
        deadline = time.time() + timeout
        while time.time() < deadline:
            rem = deadline - time.time()
            if rem <= 0:
                break
            ready = select.select([self._from], [], [], min(rem, 1.0))
            if not ready[0]:
                continue
            line = self._from.readline()
            result += line
            if "BatchCommand finished:" in line:
                # Drainer le \n final
                if select.select([self._from], [], [], 0.5)[0]:
                    self._from.readline()
                return result.strip()
        # Timeout sans BatchCommand finished : tenter de resynchroniser
        self._drain_until_batch_finished()
        return None

    def send_nowait(self, command: str):
        """Envoie une commande sans attendre la réponse.

        À utiliser pour SelectAll: (pas de réponse sur projet vide) et Import2:
        (ne retourne jamais BatchCommand finished).
        """
        self._to.write(command + "\n")
        self._to.flush()

    def _drain(self, timeout: float = 2.0):
        """Consomme tous les octets disponibles dans le pipe de lecture."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not select.select([self._from], [], [], 0.3)[0]:
                break
            self._from.readline()

    def _drain_until_batch_finished(self, timeout: float = 60.0):
        """Consomme une réponse complète du pipe pour maintenir la synchro après timeout."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not select.select([self._from], [], [], 2.0)[0]:
                break
            line = self._from.readline()
            if "BatchCommand finished:" in line:
                if select.select([self._from], [], [], 0.3)[0]:
                    self._from.readline()
                break

    def close(self):
        self._to.close()
        self._from.close()


# ─────────────────────────── Traitement ────────────────────────

def _is_failed(resp) -> bool:
    """Retourne True si la réponse indique un échec ou un timeout."""
    if resp is None:
        return True
    return "finished: failed" in resp.lower()


def _wait_for_tracks(pipe: AudacityPipe, timeout: int = 30) -> bool:
    """Sonde GetInfo:Tracks jusqu'à ce qu'au moins une piste soit chargée."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = pipe.send("GetInfo: Type=Tracks Format=JSON", timeout=5.0)
        # La réponse contient du JSON + "BatchCommand finished: OK"
        # Si des pistes sont présentes le JSON contiendra au moins "{"
        if resp and "{" in resp:
            return True
        time.sleep(0.3)
    return False


def _compressor_command(params: dict) -> str:
    """Construit la commande Audacity Compressor depuis un dict de paramètres.

    Noms de paramètres issus de GetInfo: Type=Commands Format=JSON (Audacity 3.x).
    L'ancien nom DynamicRangeCompressor: n'existe pas — Audacity répond "OK" mais
    n'applique aucun effet. La commande correcte est Compressor:.
    """
    return (
        f"Compressor: "
        f"thresholdDb={params['threshold']} "
        f"compressionRatio={params['ratio']} "
        f"attackMs={params['attack']} "
        f"releaseMs={params['release']} "
        f"kneeWidthDb={params['knee']} "
        f"makeupGainDb={params['makeup']} "
        f"lookaheadMs={params['lookahead']}"
    )


def resolve_comp_params(preset: str | None, overrides: dict) -> dict | None:
    """Résout les paramètres de compression depuis un preset + overrides inline."""
    if preset:
        if preset not in PRESETS:
            print(f"Erreur : preset inconnu '{preset}'.\nPresets disponibles :", file=sys.stderr)
            for name in sorted(PRESETS):
                print(f"  - {name}", file=sys.stderr)
            sys.exit(1)
        params = dict(PRESETS[preset])
        params.update({k: v for k, v in overrides.items() if v is not None})
        return params

    provided = {k: v for k, v in overrides.items() if v is not None}
    if not provided:
        return None  # Pas de compression

    # Valeurs par défaut si paramètres partiels
    defaults = {"threshold": -20, "ratio": 3, "attack": 20,
                "release": 200, "knee": 6, "lookahead": 1, "makeup": 0}
    return {**defaults, **provided}


def apply_compress_step(pipe: AudacityPipe, filepath: str, comp_params: dict):
    """Applique un step compress via Audacity sur le fichier (in-place)."""
    abs_path = os.path.abspath(filepath)

    pipe.send_nowait("SelectAll:")
    pipe.send("RemoveTracks:")
    pipe.send_nowait(f'Import2: Filename="{abs_path}"')

    if not _wait_for_tracks(pipe):
        print(f"    Timeout : la piste n'a pas été chargée dans Audacity", file=sys.stderr)
        pipe.send_nowait("SelectAll:")
        pipe.send("RemoveTracks:")
        sys.exit(1)

    # Drainer les réponses résiduelles des polls GetInfo de _wait_for_tracks.
    # Le polling envoie plusieurs GetInfo et peut laisser des réponses non consommées
    # dans le pipe, décalant la lecture des commandes suivantes.
    pipe._drain(timeout=1.0)

    print(f"    Compress ({comp_params})", flush=True)
    pipe.send("SelectAll:")
    # DRC sur un long fichier peut prendre plusieurs minutes — timeout 600s (10min).
    resp = pipe.send(_compressor_command(comp_params), timeout=600.0)
    if _is_failed(resp):
        print(f"    Avertissement compresseur : {resp}", file=sys.stderr)

    # Barrière de synchronisation : GetInfo force Audacity à terminer le DRC avant de continuer.
    # Audacity exécute les commandes en séquence — GetInfo ne sera traité qu'une fois DRC
    # vraiment terminé (y compris son traitement asynchrone interne). Timeout 120s : GetInfo
    # répond normalement en <1s, mais on donne de la marge au cas où DRC a encore des effets
    # post-traitement (notifications, etc.).
    pipe.send("GetInfo: Type=Tracks Format=JSON", timeout=120.0)

    mtime_before = os.stat(abs_path).st_mtime_ns

    pipe.send("SelectAll:")
    resp = pipe.send(f'Export2: Filename="{abs_path}" NumChannels=1')
    if _is_failed(resp):
        print(f"    Avertissement export : {resp}", file=sys.stderr)

    # Laisser le flush filesystem se propager avant de lire le mtime
    time.sleep(0.1)
    if os.stat(abs_path).st_mtime_ns <= mtime_before:
        print(f"    ERREUR : export compress échoué — fichier inchangé sur disque", file=sys.stderr)

    pipe.send("SelectAll:")
    pipe.send("RemoveTracks:")


def apply_normalize_step(pipe: AudacityPipe, filepath: str, target_db: float):
    """Applique un step normalize via Audacity sur le fichier (in-place)."""
    abs_path = os.path.abspath(filepath)

    pipe.send_nowait("SelectAll:")
    pipe.send("RemoveTracks:")
    pipe.send_nowait(f'Import2: Filename="{abs_path}"')

    if not _wait_for_tracks(pipe):
        print(f"    Timeout : la piste n'a pas été chargée dans Audacity", file=sys.stderr)
        pipe.send_nowait("SelectAll:")
        pipe.send("RemoveTracks:")
        sys.exit(1)

    # Drainer les réponses résiduelles des polls GetInfo de _wait_for_tracks.
    pipe._drain(timeout=1.0)

    print(f"    Normalize: peak {target_db} dBFS", flush=True)
    pipe.send("SelectAll:")
    resp = pipe.send(f"Normalize: PeakLevel={target_db} ApplyGain=True RemoveDcOffset=False StereoIndependent=False")
    if _is_failed(resp):
        print(f"    Avertissement normalize : {resp}", file=sys.stderr)

    resp = pipe.send(f'Export2: Filename="{abs_path}" NumChannels=1')
    if _is_failed(resp):
        print(f"    Avertissement export : {resp}", file=sys.stderr)

    pipe.send("SelectAll:")
    pipe.send("RemoveTracks:")


def _apply_effect(pipe: AudacityPipe, step: dict):
    """Dispatche un step vers la commande Audacity correspondante.

    step["type"] supporte : "compress", "normalize".
    Envoie SelectAll: avant l'effet.
    """
    step_type = step.get("type")
    if step_type == "compress":
        preset = step.get("preset")
        overrides = {k: step.get(k) for k in ("threshold", "ratio", "attack", "release", "knee", "lookahead", "makeup")}
        params = resolve_comp_params(preset, overrides)
        if params is None:
            print("Erreur : step compress sans preset ni paramètres.", file=sys.stderr)
            sys.exit(1)
        print(f"    [chain] Compress ({params})", flush=True)
        pipe.send("SelectAll:")
        resp = pipe.send(_compressor_command(params), timeout=600.0)
        if _is_failed(resp):
            print(f"    Avertissement compresseur : {resp}", file=sys.stderr)
        # Barrière de synchronisation post-DRC
        pipe.send("GetInfo: Type=Tracks Format=JSON", timeout=120.0)
    elif step_type == "normalize":
        target_db = step.get("target_db", -1.0)
        print(f"    [chain] Normalize: peak {target_db} dBFS", flush=True)
        pipe.send("SelectAll:")
        resp = pipe.send(
            f"Normalize: PeakLevel={target_db} ApplyGain=True RemoveDcOffset=False StereoIndependent=False"
        )
        if _is_failed(resp):
            print(f"    Avertissement normalize : {resp}", file=sys.stderr)
    else:
        print(f"Erreur fatale : type de step inconnu '{step_type}' dans la chaîne.", file=sys.stderr)
        sys.exit(1)


def apply_audacity_chain(pipe: AudacityPipe, filepath: str, steps: list, verify: bool = False):
    """Applique une chaîne de N steps Audacity en un seul cycle import → effets → export.

    Algorithme :
      Import2(filepath)
      wait_for_tracks()
      drain()

      for each step in steps:
          SelectAll()
          apply_effect(step)

          if verify AND not last_step:
              SelectAll()
              Export2(filepath)      ← export intermédiaire visible dans les logs
              check mtime changed
              # PAS de re-import — la piste reste chargée

      SelectAll()
      Export2(filepath)              ← export final (toujours)
      check mtime changed
      SelectAll()
      RemoveTracks()
    """
    abs_path = os.path.abspath(filepath)
    print(f"  [chain] Import : {os.path.basename(filepath)} ({len(steps)} step(s))", flush=True)

    pipe.send_nowait("SelectAll:")
    pipe.send("RemoveTracks:")
    pipe.send_nowait(f'Import2: Filename="{abs_path}"')

    if not _wait_for_tracks(pipe):
        print(f"    Timeout : la piste n'a pas été chargée dans Audacity", file=sys.stderr)
        pipe.send_nowait("SelectAll:")
        pipe.send("RemoveTracks:")
        sys.exit(1)

    # Drainer les réponses résiduelles des polls GetInfo de _wait_for_tracks.
    pipe._drain(timeout=1.0)

    n_steps = len(steps)
    for i, step in enumerate(steps):
        _apply_effect(pipe, step)

        is_last = (i == n_steps - 1)
        if verify and not is_last:
            mtime_before = os.stat(abs_path).st_mtime_ns
            pipe.send("SelectAll:")
            resp = pipe.send(f'Export2: Filename="{abs_path}" NumChannels=1')
            if _is_failed(resp):
                print(f"    Avertissement export intermédiaire : {resp}", file=sys.stderr)
            time.sleep(0.1)
            if os.stat(abs_path).st_mtime_ns <= mtime_before:
                print(
                    f"    ERREUR : export intermédiaire échoué — fichier inchangé sur disque",
                    file=sys.stderr,
                )
            print(f"    [chain] Export intermédiaire après step {i + 1}/{n_steps}", flush=True)

    # Export final
    mtime_before = os.stat(abs_path).st_mtime_ns
    pipe.send("SelectAll:")
    resp = pipe.send(f'Export2: Filename="{abs_path}" NumChannels=1')
    if _is_failed(resp):
        print(f"    Avertissement export final : {resp}", file=sys.stderr)
    time.sleep(0.1)
    if os.stat(abs_path).st_mtime_ns <= mtime_before:
        print(f"    ERREUR : export final échoué — fichier inchangé sur disque", file=sys.stderr)

    print(f"  [chain] Export final : {os.path.basename(filepath)}", flush=True)
    pipe.send("SelectAll:")
    pipe.send("RemoveTracks:")


def process_file(pipe: AudacityPipe, filepath: str, comp_params: dict | None,
                 normalize_db: float, gain_db: float, multi_pass: int = 1):
    """[LEGACY] Applique (compressor → normalize) × multi_pass → gain sur un fichier FLAC via le pipe."""
    abs_path = os.path.abspath(filepath)
    print(f"  Traitement : {os.path.basename(filepath)}", flush=True)

    # Nettoyer d'éventuelles pistes résiduelles avant de commencer.
    # SelectAll sur projet vide n'envoie pas BatchCommand finished → send_nowait.
    pipe.send_nowait("SelectAll:")
    pipe.send("RemoveTracks:")

    # Import2 ne retourne pas BatchCommand finished — fire-and-forget puis polling.
    pipe.send_nowait(f'Import2: Filename="{abs_path}"')

    if not _wait_for_tracks(pipe):
        print(f"    Timeout : la piste n'a pas été chargée dans Audacity", file=sys.stderr)
        pipe.send_nowait("SelectAll:")
        pipe.send("RemoveTracks:")
        return

    # À partir d'ici les pistes sont chargées → SelectAll répond toujours avec
    # BatchCommand finished: OK. On utilise send() synchrone pour maintenir la
    # synchro du pipe, surtout critique sur plusieurs passes.
    for pass_idx in range(max(1, multi_pass)):
        pass_label = f" (passe {pass_idx + 1}/{multi_pass})" if multi_pass > 1 else ""

        # Compression (optionnel)
        if comp_params is not None:
            print(f"    Compression{pass_label} ({comp_params})", flush=True)
            pipe.send("SelectAll:")
            resp = pipe.send(_compressor_command(comp_params))
            if _is_failed(resp):
                print(f"    Avertissement compresseur : {resp}", file=sys.stderr)

        # Normalisation (toujours)
        print(f"    Normalize{pass_label}: peak {normalize_db} dBFS", flush=True)
        pipe.send("SelectAll:")
        resp = pipe.send(f"Normalize: PeakLevel={normalize_db} ApplyGain=True RemoveDcOffset=False StereoIndependent=False")
        if _is_failed(resp):
            print(f"    Avertissement normalize : {resp}", file=sys.stderr)

    # Gain additionnel (optionnel, une seule fois après toutes les passes)
    if gain_db != 0.0:
        gain_factor = 10 ** (gain_db / 20)
        print(f"    Gain : {gain_db:+.1f} dB (ratio={gain_factor:.4f})", flush=True)
        pipe.send("SelectAll:")
        resp = pipe.send(f"Amplify: Ratio={gain_factor} AllowClipping=False")
        if _is_failed(resp):
            print(f"    Avertissement gain : {resp}", file=sys.stderr)

    # DRC émet une notification différée ~500ms après son traitement (via le pipe Audacity).
    # Elle arrive typiquement juste après Normalize. On la draine avant l'export pour
    # éviter qu'elle soit lue comme réponse à Export2.
    if comp_params is not None:
        pipe._drain(timeout=0.5)

    # Export sur place (FLAC) — guillemets pour les chemins avec espaces
    resp = pipe.send(f'Export2: Filename="{abs_path}" NumChannels=1')
    if _is_failed(resp):
        print(f"    Avertissement export : {resp}", file=sys.stderr)

    # Vider le projet pour le prochain fichier (sans fermer Audacity)
    pipe.send("SelectAll:")
    pipe.send("RemoveTracks:")
    print(f"    ✓ {os.path.basename(filepath)}", flush=True)


# ─────────────────────────── Mode chain ────────────────────────

def run_chain_mode(args):
    """Mode chain : applique une liste de steps Audacity en un seul Import/Export."""
    try:
        steps = json.loads(args.chain)
    except json.JSONDecodeError as e:
        print(f"Erreur : JSON invalide pour --chain : {e}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(steps, list) or len(steps) == 0:
        print("Erreur : --chain attend un tableau JSON non vide.", file=sys.stderr)
        sys.exit(1)

    _ensure_audacity_running()
    pipe = AudacityPipe()
    try:
        resp = None
        for _ in range(6):
            resp = pipe.send("GetInfo: Type=Tracks Format=JSON", timeout=5.0)
            if resp is not None:
                break
            time.sleep(1)
        if resp is None:
            print(
                "Erreur : Audacity ne répond pas dans les 30s.\n"
                "  → Si un dialogue s'affiche dans Audacity (récupération de projet, etc.),\n"
                "    cliquez 'Passer' ou fermez-le, puis relancez le script.",
                file=sys.stderr,
            )
            sys.exit(1)

        for filepath in args.files:
            if not os.path.isfile(filepath):
                print(f"Fichier introuvable : {filepath}", file=sys.stderr)
                sys.exit(1)
            apply_audacity_chain(pipe, filepath, steps, verify=args.verify)
            print(f"    ✓ {os.path.basename(filepath)}", flush=True)
    finally:
        pipe.close()


# ─────────────────────────── Mode step ─────────────────────────

def run_step_mode(args):
    """Mode step : applique un unique step (compress ou normalize) sur un fichier."""
    step_type = args.step

    if step_type == "compress":
        overrides = {
            "threshold": args.threshold,
            "ratio":     args.ratio,
            "attack":    args.attack,
            "release":   args.release,
            "knee":      args.knee,
            "lookahead": args.lookahead,
            "makeup":    args.makeup,
        }
        comp_params = resolve_comp_params(args.preset, overrides)
        if comp_params is None:
            print("Erreur : step compress sans preset ni paramètres.", file=sys.stderr)
            sys.exit(1)
    elif step_type == "normalize":
        pass  # target_db déjà dans args.normalize
    else:
        print(f"Erreur fatale : type de step inconnu '{step_type}'.", file=sys.stderr)
        sys.exit(1)

    _ensure_audacity_running()
    pipe = AudacityPipe()
    try:
        # Ping de réactivité avec retry
        resp = None
        for _ in range(6):
            resp = pipe.send("GetInfo: Type=Tracks Format=JSON", timeout=5.0)
            if resp is not None:
                break
            time.sleep(1)
        if resp is None:
            print(
                "Erreur : Audacity ne répond pas dans les 30s.\n"
                "  → Si un dialogue s'affiche dans Audacity (récupération de projet, etc.),\n"
                "    cliquez 'Passer' ou fermez-le, puis relancez le script.",
                file=sys.stderr,
            )
            sys.exit(1)

        for filepath in args.files:
            if not os.path.isfile(filepath):
                print(f"Fichier introuvable : {filepath}", file=sys.stderr)
                sys.exit(1)
            print(f"  [{step_type}] {os.path.basename(filepath)}", flush=True)
            if step_type == "compress":
                apply_compress_step(pipe, filepath, comp_params)
            elif step_type == "normalize":
                apply_normalize_step(pipe, filepath, args.normalize)
            print(f"    ✓ {os.path.basename(filepath)}", flush=True)
    finally:
        pipe.close()


# ─────────────────────────── CLI ───────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Applique des effets audio via Audacity mod-script-pipe."
    )
    # Mode chain : liste de steps JSON
    parser.add_argument("--chain", metavar="JSON",
                        help="Applique une chaîne de steps Audacity en un seul Import/Export (JSON array)")
    parser.add_argument("--verify", action="store_true", default=False,
                        help="En mode --chain : exporte après chaque step (sauf le dernier) pour vérification")
    # Mode step (nouveau)
    parser.add_argument("--step", choices=["compress", "normalize"],
                        help="Applique un unique step (compress ou normalize)")
    # Preset ou paramètres directs (compress)
    parser.add_argument("--preset", help="Nom du preset de compression Audacity")
    parser.add_argument("--threshold", type=float, help="Seuil (dBFS)")
    parser.add_argument("--ratio",    type=float, help="Ratio de compression")
    parser.add_argument("--attack",   type=float, help="Attaque (ms)")
    parser.add_argument("--release",  type=float, help="Relâchement (ms)")
    parser.add_argument("--knee",     type=float, help="Knee (dB)")
    parser.add_argument("--lookahead", type=float, help="Lookahead (ms)")
    parser.add_argument("--makeup",   type=float, help="Makeup gain (dB)")
    # Multi-pass (mode legacy)
    parser.add_argument("--multi-pass", type=int, default=1,
                        help="Nombre de passes compressor+normalize (défaut 1) [mode legacy]")
    # Normalisation
    parser.add_argument("--normalize", type=float, default=-1.0,
                        help="Niveau peak cible (dBFS, défaut -1)")
    # Gain additionnel (mode legacy)
    parser.add_argument("--gain", type=float, default=0.0,
                        help="Gain additionnel après normalisation (dB) [mode legacy]")
    # Fichiers
    parser.add_argument("files", nargs="+", help="Fichiers FLAC à traiter")
    return parser.parse_args()


def resolve_compression(args) -> dict | None:
    """Résout les paramètres de compression depuis le preset ou les flags directs [mode legacy]."""
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

    # Mode chain : applique une liste de steps en un seul Import/Export
    if args.chain:
        run_chain_mode(args)
        return

    # Mode step : applique un unique effet
    if args.step:
        run_step_mode(args)
        return

    # Mode legacy : compressor → normalize → gain (multi-pass)
    comp_params = resolve_compression(args)

    _ensure_audacity_running()

    pipe = AudacityPipe()
    try:
        # Ping de réactivité avec retry — GetInfo répond toujours sur projet vide.
        # On réessaie jusqu'à 30s car le scripting thread peut être lent au premier
        # démarrage (chargement des plugins, etc.).
        resp = None
        for _ in range(6):
            resp = pipe.send("GetInfo: Type=Tracks Format=JSON", timeout=5.0)
            if resp is not None:
                break
            time.sleep(1)
        if resp is None:
            print(
                "Erreur : Audacity ne répond pas dans les 30s.\n"
                "  → Si un dialogue s'affiche dans Audacity (récupération de projet, etc.),\n"
                "    cliquez 'Passer' ou fermez-le, puis relancez le script.",
                file=sys.stderr,
            )
            sys.exit(1)

        for filepath in args.files:
            if not os.path.isfile(filepath):
                print(f"Fichier introuvable : {filepath}", file=sys.stderr)
                continue
            process_file(pipe, filepath, comp_params, args.normalize, args.gain, args.multi_pass)
    finally:
        pipe.close()


if __name__ == "__main__":
    main()
