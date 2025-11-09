from __future__ import annotations
import time
import random

class Stopwatch:
    def __enter__(self):
        self.t0 = time.perf_counter()
        return self
    def __exit__(self, *exc):
        self.ms = (time.perf_counter() - self.t0) * 1000.0


def reseed(seed: int | None) -> int:
    if seed is None:
        seed = random.randint(0, 2**31 - 1)
    random.seed(seed)
    return seed