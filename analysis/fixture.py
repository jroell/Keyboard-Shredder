"""Synthesize an original guitar-like test recording and its isolated lead."""
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from scipy.io.wavfile import write


def create_fixture(folder, seconds, asset):
    rate = 22050
    guitar = np.zeros(rate * seconds, dtype=np.float32)
    drums = np.zeros_like(guitar)
    attacks = []
    rng = np.random.default_rng(106)
    riffs = [57, 60, 62, 64, 60, 57, 55, 52]
    beat = 0.50
    index = 0
    while beat < seconds - 0.4:
        pitch = riffs[index % len(riffs)]
        chord = index % 8 == 0
        onset = beat + (0.12 if index % 8 == 5 else 0)
        attacks.append(round(onset * 1000))
        duration = 0.36 if index % 4 == 0 else 0.18
        start = int(onset * rate)
        t = np.arange(int(duration * rate)) / rate
        env = np.minimum(t / 0.005, 1) * np.minimum((duration - t) / 0.035, 1) * np.exp(-2.4 * t)
        for note in [pitch, pitch + 7] if chord else [pitch]:
            hz = 440 * 2 ** ((note - 69) / 12)
            wave = sum(np.sin(t * hz * n * 2 * np.pi) / n ** 1.6 for n in range(1, 7))
            guitar[start:start + len(t)] += (0.19 if chord else 0.32) * wave * env
        d = np.arange(int(0.12 * rate)) / rate
        kick = np.sin(2 * np.pi * (65 * d + 2 * (1 - np.exp(-40 * d)))) * np.exp(-32 * d)
        snare = rng.standard_normal(len(d)) * np.exp(-42 * d)
        start = int(beat * rate)
        drums[start:start + len(d)] += kick * 0.21 if index % 2 == 0 else snare * 0.10
        index += 1
        beat += 0.5 if beat < seconds / 2 else 0.44
    folder.mkdir(parents=True, exist_ok=True)
    if asset == "--stem-only":
        write(folder / "backing-drums.audio", rate, drums)
        stem = folder / "guitar.partial"
        write(stem, rate, guitar)
        stem.replace(folder / "guitar.audio")
    (folder / "fixture-attacks.json").write_text(json.dumps(attacks))
    if asset == "--master-only":
        source = folder / "mix.wav"
        output = folder / "master.partial"
        write(source, rate, guitar + drums)
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source),
                        "-codec:a", "libmp3lame", "-f", "mp3", str(output)], check=True)
        output.replace(folder / "master.mp3")
        source.unlink()


if __name__ == "__main__":
    create_fixture(Path(sys.argv[1]), int(sys.argv[2]), sys.argv[3])
