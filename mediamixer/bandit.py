"""Pure math for the reward-weighted content selector. No I/O, fully unit-testable."""
from __future__ import annotations

import math
import random
from typing import Optional, Sequence, TypeVar

T = TypeVar("T")


def decayed_value(ema: float, updated_at: float, now: float, halflife_s: float) -> float:
    """Exponentially decay a reward EMA back toward zero the longer it's gone untouched."""
    if updated_at <= 0 or halflife_s <= 0:
        return ema
    dt = max(0.0, now - updated_at)
    return ema * (0.5 ** (dt / halflife_s))


def exploration_score(ema: float, play_count: int, bonus_c: float) -> float:
    """UCB-style bonus so lightly-played items keep getting a fair shot against
    well-established favorites instead of being starved out permanently."""
    return ema + bonus_c / math.sqrt(1 + play_count)


def softmax_pick(items: Sequence[T], scores: Sequence[float], temp: float) -> Optional[T]:
    if not items:
        return None
    if len(items) == 1:
        return items[0]
    peak = max(scores)
    weights = [math.exp((s - peak) / temp) for s in scores]
    total = sum(weights) or 1.0
    return random.choices(items, weights=[w / total for w in weights], k=1)[0]
