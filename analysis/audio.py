import subprocess

import numpy as np
from scipy.signal import correlate, correlation_lags


def decode(path, rate, channels=1):
    audio = subprocess.check_output([
        "ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-t", "241",
        "-vn", "-ac", str(channels), "-ar", str(rate), "-f", "f32le", "pipe:1",
    ], timeout=30)
    samples = np.frombuffer(audio, dtype="<f4")
    return samples if channels == 1 else samples.reshape(-1, channels)


def alignment_error_ms(master, guitar, rate):
    if abs(len(master) - len(guitar)) > rate // 4:
        raise ValueError("The guitar stem and master differ in length.")
    if np.sqrt(np.mean(guitar ** 2)) < 0.002:
        raise ValueError("The guitar stem is too quiet to chart.")
    offsets = []
    for center in (0.2, 0.5, 0.8):
        at = int(min(len(guitar), len(master)) * center)
        start, end = max(0, at - 2 * rate), at + 2 * rate
        main, stem = np.diff(master[start:end]), np.diff(guitar[start:end])
        strength = np.linalg.norm(main) * np.linalg.norm(stem)
        if strength < 1e-6:
            continue
        corr = correlate(main, stem, method="fft") / strength
        lags = correlation_lags(len(main), len(stem))
        keep = np.abs(lags) <= rate // 4
        scores = np.abs(corr[keep])
        peak = np.argmax(scores)
        if scores[peak] >= 0.12:
            offsets.append(float(lags[keep][peak] * 1000 / rate))
    if len(offsets) < 2 or max(offsets) - min(offsets) > 12 or max(map(abs, offsets)) > 120:
        raise ValueError("The guitar stem could not be aligned with the recording.")
    return float(np.median(offsets))
