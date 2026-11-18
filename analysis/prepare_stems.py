"""Render time-aligned playback assets from the source separation."""
from pathlib import Path
import subprocess
import sys

import numpy as np

from audio import decode, stem_alignment_ms


def shifted(samples, shift, length):
    result = np.zeros((length, 2), dtype=np.float32)
    source_start, destination_start = max(0, -shift), max(0, shift)
    count = min(len(samples) - source_start, length - destination_start)
    if count > 0:
        result[destination_start:destination_start + count] = samples[source_start:source_start + count]
    return result


def encode(path, samples, rate):
    temp = path.with_suffix(".partial")
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", str(rate), "-ac", "2", "-i", "pipe:0",
        "-codec:a", "libmp3lame", "-q:a", "2", "-f", "mp3", str(temp),
    ], input=samples.astype("<f4", copy=False).tobytes(), check=True, timeout=60)
    temp.replace(path)


def prepare(folder):
    rate = 44100
    master = decode(folder / "master.mp3", rate, channels=2)
    guitar = decode(folder / "guitar.audio", rate, channels=2)
    lag = stem_alignment_ms(folder, master.mean(axis=1), guitar.mean(axis=1), rate)
    shift = round(lag * rate / 1000)
    lead = shifted(guitar, shift, len(master))
    other_stems = sorted(folder.glob("backing-*.audio"))
    if not other_stems:
        raise ValueError("The recording has no isolated backing stems.")
    backing = np.zeros_like(lead)
    for path in other_stems:
        backing += shifted(decode(path, rate, channels=2), shift, len(master))
    peak = max(float(np.max(np.abs(backing + lead))), float(np.max(np.abs(backing))), 0.98)
    correction = 0.98 / peak
    encode(folder / "lead.mp3", lead * correction, rate)
    encode(folder / "backing.mp3", backing * correction, rate)


if __name__ == "__main__":
    try:
        prepare(Path(sys.argv[1]))
    except ValueError as exc:
        print(f"CHART_ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
