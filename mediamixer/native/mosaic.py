"""Mosaic Fit: sizes each tile by its clip's own aspect ratio via
justified-row packing, instead of a uniform grid - cuts down on black
bars/cropping when clips have mixed aspect ratios. Native port of
dashboard.js's Mosaic Fit math.

Each row's tile widths are computed as that row's own aspect-ratio
shares (always summing to exactly the container width), independent of
the row-height scaling factor - a real bug in an earlier version tied
width directly to the globally-scaled height and caused severe
overflow/underfill on mixed-aspect-ratio content; keeping the two
calculations independent is the fix, kept here from the start.
"""
from __future__ import annotations

import math

DEFAULT_ASPECT = 16 / 9


def pack_rows(aspect_ratios: list[float], container_width: float, target_row_height: float) -> list[list[int]]:
    """Greedily groups tile indices into rows so each row's natural width
    at target_row_height is close to container_width."""
    rows: list[list[int]] = []
    current: list[int] = []
    current_ar_sum = 0.0
    for i, ar in enumerate(aspect_ratios):
        current.append(i)
        current_ar_sum += ar
        if current_ar_sum * target_row_height >= container_width:
            rows.append(current)
            current = []
            current_ar_sum = 0.0
    if current:
        rows.append(current)
    return rows


def compute_mosaic_layout(
    aspect_ratios: list[float], container_width: float, container_height: float, target_row_height: float
) -> list[dict]:
    """Returns per-tile absolute geometry (same order as aspect_ratios):
    [{"x", "y", "width", "height"}, ...], all rows stacked to exactly
    fill container_height and each row's tiles summing to exactly
    container_width."""
    if not aspect_ratios or container_width <= 0 or container_height <= 0:
        return []

    rows = pack_rows(aspect_ratios, container_width, target_row_height)

    natural_heights = []
    for row in rows:
        ar_sum = sum(aspect_ratios[i] for i in row) or 1.0
        natural_heights.append(container_width / ar_sum)

    total_natural = sum(natural_heights) or 1.0
    scale = container_height / total_natural

    results: list[dict] = [None] * len(aspect_ratios)  # type: ignore[list-item]
    y = 0.0
    for row, natural_height in zip(rows, natural_heights):
        row_height = natural_height * scale
        ar_sum = sum(aspect_ratios[i] for i in row) or 1.0
        x = 0.0
        for i in row:
            tile_width = (aspect_ratios[i] / ar_sum) * container_width
            results[i] = {"x": x, "y": y, "width": tile_width, "height": row_height}
            x += tile_width
        y += row_height
    return results


def uniform_layout(tile_count: int, columns: int, container_width: float, container_height: float, spacing: float = 2) -> list[dict]:
    """Plain equal-size grid geometry - used when Mosaic Fit is off."""
    if tile_count <= 0 or container_width <= 0 or container_height <= 0:
        return []
    rows = math.ceil(tile_count / columns)
    cell_w = (container_width - spacing * (columns - 1)) / columns
    cell_h = (container_height - spacing * (rows - 1)) / rows
    results = []
    for i in range(tile_count):
        col = i % columns
        row = i // columns
        results.append({
            "x": col * (cell_w + spacing),
            "y": row * (cell_h + spacing),
            "width": cell_w,
            "height": cell_h,
        })
    return results
