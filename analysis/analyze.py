from contextlib import redirect_stdout
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

from scipy.io.wavfile import write

from audio import decode, stem_alignment_ms


def analyze(folder):
    rate = 22050
    master = decode(folder / "master.mp3", rate)
    guitar = decode(folder / "guitar.audio", rate)
    offset = stem_alignment_ms(folder, master, guitar, rate)

    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict
    from beat_this.inference import File2Beats
    import torch

    torch.set_num_threads(2)
    model = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "guitar.wav"
        write(path, rate, guitar)
        _, _, transcription = predict(str(path), model_or_model_path=model, minimum_note_length=85)
    checkpoint = Path(__file__).with_name("weights") / "final0.ckpt"
    if not checkpoint.is_file():
        raise ValueError("Run npm run setup:analysis to install the beat model.")
    beats, downbeats = File2Beats(checkpoint_path=str(checkpoint), device="cpu", dbn=False)(
        str(folder / "master.mp3")
    )
    return {
        "durationMs": round(len(master) * 1000 / rate),
        "beatsMs": [round(float(beat) * 1000) for beat in beats],
        "downbeatsMs": [round(float(beat) * 1000) for beat in downbeats],
        "notes": [
            {"startMs": round(start * 1000 + offset), "endMs": round(end * 1000 + offset),
             "pitch": int(pitch), "strength": float(amplitude)}
            for start, end, pitch, amplitude, _ in transcription
        ],
    }


if __name__ == "__main__":
    try:
        with redirect_stdout(sys.stderr):
            chart = analyze(Path(sys.argv[1]))
        print(json.dumps(chart))
    except ValueError as exc:
        print(f"CHART_ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
