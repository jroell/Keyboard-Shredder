import unittest

import numpy as np

from audio import alignment_error_ms


class StemTiming(unittest.TestCase):
    def test_aligned_guitar_in_a_mix_has_offset_under_one_ms(self):
        rng = np.random.default_rng(42)
        guitar = rng.normal(0, 0.1, 8000 * 12).astype(np.float32)
        mix = guitar + rng.normal(0, 0.03, len(guitar))
        self.assertLess(abs(alignment_error_ms(mix, guitar, 8000)), 1)

    def test_guitar_delayed_by_25_ms_gets_an_offset_correction(self):
        rng = np.random.default_rng(42)
        guitar = rng.normal(0, 0.1, 8000 * 12).astype(np.float32)
        delayed = np.pad(guitar, (200, 0))[:len(guitar)]
        self.assertAlmostEqual(alignment_error_ms(guitar, delayed, 8000), -25, delta=1)

    def test_guitar_delayed_by_160_ms_is_rejected(self):
        rng = np.random.default_rng(42)
        guitar = rng.normal(0, 0.1, 8000 * 12).astype(np.float32)
        mix = guitar + rng.normal(0, 0.03, len(guitar))
        delayed = np.pad(guitar, (1280, 0))[:len(guitar)]
        with self.assertRaisesRegex(ValueError, "could not be aligned"):
            alignment_error_ms(mix, delayed, 8000)
