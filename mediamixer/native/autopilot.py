"""Native port of dashboard.js's Auto-Pilot: a scripted calm -> building
-> climax -> cooldown session arc that ramps pace and barrage/jackpot/
novelty odds over a repeating cycle, via the same control endpoints the
toolbar's own actions use - instead of those settings sitting wherever
they were last manually set.

Scoped to what the native app can actually drive so far (pace,
barrage/jackpot probability, novelty bonus); the browser's version also
ramps Mosaic Fit/floater count, which aren't ported here yet.
"""
from __future__ import annotations

# (cycle_position 0.0-1.0, barrage_probability, jackpot_probability, novelty_bonus, pace_idx)
KEYFRAMES = [
    (0.00, 0.03, 0.08, 0.10, 2),  # calm
    (0.25, 0.05, 0.12, 0.15, 1),  # building
    (0.50, 0.12, 0.22, 0.30, 0),  # climax
    (0.75, 0.04, 0.10, 0.12, 2),  # cooldown
    (1.00, 0.03, 0.08, 0.10, 2),  # back to calm
]


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def sample(cycle_position: float) -> dict:
    pos = cycle_position % 1.0
    for i in range(len(KEYFRAMES) - 1):
        p0, b0, j0, n0, pace0 = KEYFRAMES[i]
        p1, b1, j1, n1, _pace1 = KEYFRAMES[i + 1]
        if p0 <= pos <= p1:
            t = (pos - p0) / (p1 - p0) if p1 > p0 else 0
            return {
                "barrage": _lerp(b0, b1, t),
                "jackpot": _lerp(j0, j1, t),
                "novelty": _lerp(n0, n1, t),
                "pace_idx": pace0,
            }
    last = KEYFRAMES[-1]
    return {"barrage": last[1], "jackpot": last[2], "novelty": last[3], "pace_idx": last[4]}


class AutoPilotState:
    def __init__(self, cycle_minutes: float = 6.0):
        self.enabled = False
        self.cycle_minutes = cycle_minutes
        self._started_at = 0.0
        self._last_pace_idx: int | None = None

    def enable(self, now: float) -> None:
        self.enabled = True
        self._started_at = now
        self._last_pace_idx = None

    def disable(self) -> None:
        self.enabled = False

    def tick(self, now: float, controls) -> None:
        if not self.enabled:
            return
        cycle_s = self.cycle_minutes * 60
        pos = ((now - self._started_at) % cycle_s) / cycle_s
        values = sample(pos)
        controls.set_intensity(values["barrage"], values["jackpot"])
        controls.set_novelty(values["novelty"])
        if values["pace_idx"] != self._last_pace_idx:
            controls.set_pace(values["pace_idx"])
            self._last_pace_idx = values["pace_idx"]
