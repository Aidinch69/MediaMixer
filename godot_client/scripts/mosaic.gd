extends RefCounted
class_name Mosaic
## Direct port of mediamixer/mosaic.py - same formulas, same variable names
## where practical, so the two can be diffed against each other later.

const DEFAULT_ASPECT := 16.0 / 9.0


static func pack_rows(aspect_ratios: Array, container_width: float, target_row_height: float) -> Array:
	var rows := []
	var current_row := []
	var current_ar_sum := 0.0
	for ar in aspect_ratios:
		current_row.append(ar)
		current_ar_sum += ar
		if current_ar_sum * target_row_height >= container_width:
			rows.append(current_row)
			current_row = []
			current_ar_sum = 0.0
	if not current_row.is_empty():
		rows.append(current_row)
	return rows


static func compute_mosaic_layout(aspect_ratios: Array, container_width: float, container_height: float, target_row_height: float) -> Array:
	var rows := pack_rows(aspect_ratios, container_width, target_row_height)
	var natural_heights := []
	for row in rows:
		var ar_sum := 0.0
		for ar in row:
			ar_sum += ar
		natural_heights.append(container_width / (ar_sum if ar_sum > 0.0 else 1.0))
	var total_natural := 0.0
	for h in natural_heights:
		total_natural += h
	var scale := container_height / (total_natural if total_natural > 0.0 else 1.0)

	var result := []
	var y := 0.0
	for row_idx in range(rows.size()):
		var row = rows[row_idx]
		var row_height: float = natural_heights[row_idx] * scale
		var row_ar_sum := 0.0
		for ar in row:
			row_ar_sum += ar
		var x := 0.0
		for ar in row:
			var tile_width: float = (ar / row_ar_sum) * container_width
			result.append({"x": x, "y": y, "width": tile_width, "height": row_height})
			x += tile_width
		y += row_height
	return result


static func uniform_layout(tile_count: int, columns: int, container_width: float, container_height: float, spacing: float = 2.0) -> Array:
	var rows := int(ceil(float(tile_count) / float(columns)))
	var cell_w := (container_width - spacing * (columns - 1)) / float(columns)
	var cell_h := (container_height - spacing * (rows - 1)) / float(rows)
	var result := []
	for i in range(tile_count):
		var col := i % columns
		var row := i / columns
		result.append({
			"x": col * (cell_w + spacing), "y": row * (cell_h + spacing),
			"width": cell_w, "height": cell_h,
		})
	return result
