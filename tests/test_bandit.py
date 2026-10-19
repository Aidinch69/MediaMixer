import random
from collections import Counter

from mediamixer.bandit import decayed_value, exploration_score, softmax_pick


def test_decay_halves_after_one_halflife():
    assert decayed_value(1.0, updated_at=100, now=100 + 1800, halflife_s=1800) == 0.5


def test_decay_ignores_never_updated_and_disabled_halflife():
    assert decayed_value(0.8, updated_at=0, now=10_000, halflife_s=1800) == 0.8
    assert decayed_value(0.8, updated_at=100, now=10_000, halflife_s=0) == 0.8


def test_exploration_bonus_shrinks_with_plays():
    fresh = exploration_score(0.0, play_count=0, bonus_c=0.5)
    worn = exploration_score(0.0, play_count=99, bonus_c=0.5)
    assert fresh == 0.5
    assert worn < fresh


def test_softmax_edge_cases():
    assert softmax_pick([], [], 0.6) is None
    assert softmax_pick(["only"], [5.0], 0.6) == "only"


def test_softmax_favors_higher_scores_but_not_exclusively():
    random.seed(1)
    counts = Counter(softmax_pick(["hi", "lo"], [1.0, 0.0], 0.6) for _ in range(5000))
    assert counts["hi"] > counts["lo"] > 0


def test_softmax_is_stable_with_huge_scores():
    # Subtracting the peak before exp() keeps this from overflowing.
    assert softmax_pick(["a", "b"], [10_000.0, 9_999.0], 0.05) in ("a", "b")
