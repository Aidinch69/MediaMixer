extends Control
## Root scene. Owns the grid of VideoTiles, the floater overlay layer, and
## wires ApiClient snapshots to both. Direct port of the orchestration half
## of mediamixer/native/shell.py - the gamification/FX half comes in a
## later pass; this is the core "show the live session, let floaters drift
## over it" loop.

const FLOATER_CHECK_S := 4.0
const FLOATER_DURATION_RANGE_S := Vector2(10.0, 18.0)
const MOSAIC_REFLOW_S := 4.0

var grid_area: Control
var floater_layer: Control
var settings_panel: Control
var circle_shader: Shader

var tiles: Array[VideoTile] = []
var current_tile_count := 0
var current_columns := 1
var current_layout := ""

var mosaic_enabled := false
var floater_enabled := true
var floater_target_count := 3
var floater_opacity := 0.6
var floater_source := "dedicated"
var active_floaters: Array[Floater] = []

var _floater_timer := 0.0
var _mosaic_timer := 0.0


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	circle_shader = load("res://circle_mask.gdshader")

	grid_area = Control.new()
	grid_area.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(grid_area)

	floater_layer = Control.new()
	floater_layer.set_anchors_preset(Control.PRESET_FULL_RECT)
	floater_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(floater_layer)

	settings_panel = preload("res://scripts/settings_panel.gd").new()
	add_child(settings_panel)
	settings_panel.setup(self)

	ApiClient.snapshot_received.connect(_on_snapshot)
	ApiClient.connection_lost.connect(func(): print("[main] connection lost, retrying..."))

	resized.connect(_on_resized)


func _process(delta: float) -> void:
	if floater_enabled:
		_floater_timer += delta
		if _floater_timer >= FLOATER_CHECK_S:
			_floater_timer = 0.0
			_maybe_spawn_floater()
	if mosaic_enabled:
		_mosaic_timer += delta
		if _mosaic_timer >= MOSAIC_REFLOW_S:
			_mosaic_timer = 0.0
			_layout_tiles()


func _on_resized() -> void:
	_layout_tiles()


# ---------------------------------------------------------------- snapshot

func _on_snapshot(data: Dictionary) -> void:
	var screens: Array = data.get("screens", [])
	var columns: int = data.get("columns", 1)
	var layout: String = data.get("layout", "")

	if screens.size() != current_tile_count or columns != current_columns:
		_rebuild_grid(screens.size(), columns)
	current_layout = layout

	for i in range(screens.size()):
		var screen: Dictionary = screens[i]
		var path: String = screen.get("path", "")
		if path != "" and i < tiles.size():
			tiles[i].set_source(path)


func _rebuild_grid(tile_count: int, columns: int) -> void:
	for t in tiles:
		t.queue_free()
	tiles.clear()
	for i in range(tile_count):
		var tile := VideoTile.new()
		tile.index = i
		tile.rated.connect(_on_rated)
		grid_area.add_child(tile)
		tiles.append(tile)
	current_tile_count = tile_count
	current_columns = columns
	_layout_tiles()


func _on_rated(index: int, direction: String) -> void:
	ApiClient.rate(index, direction)


# ------------------------------------------------------------------ layout

func _layout_tiles() -> void:
	if tiles.is_empty():
		return
	var w := grid_area.size.x
	var h := grid_area.size.y
	if w <= 0 or h <= 0:
		return

	var rects: Array
	if mosaic_enabled:
		var aspect_ratios := []
		for t in tiles:
			aspect_ratios.append(t.aspect_ratio())
		var target_rows: int = max(1, int(round(sqrt(float(tiles.size()) * h / w))))
		var target_row_height := h / float(target_rows)
		rects = Mosaic.compute_mosaic_layout(aspect_ratios, w, h, target_row_height)
	else:
		rects = Mosaic.uniform_layout(tiles.size(), current_columns, w, h)

	for i in range(tiles.size()):
		var r: Dictionary = rects[i]
		tiles[i].position = Vector2(r.x, r.y)
		tiles[i].size = Vector2(r.width, r.height)


# ----------------------------------------------------------------- floater

func _maybe_spawn_floater() -> void:
	if active_floaters.size() >= floater_target_count:
		return
	var source := floater_source
	if source == "both":
		source = "dedicated" if randf() < 0.5 else "library"
	ApiClient.list_overlay_fx(source, func(items: Array):
		if items.is_empty() and source != "library":
			ApiClient.list_overlay_fx("library", func(fallback_items: Array):
				_spawn_floater_from(fallback_items)
			)
		else:
			_spawn_floater_from(items)
	)


func _spawn_floater_from(items: Array) -> void:
	if items.is_empty():
		return
	var item: Dictionary = items[randi() % items.size()]
	var kind_path: String = String(item.get("path", ""))
	var base: String = String(item.get("base", ""))

	var w := grid_area.size.x
	var h := grid_area.size.y
	if w <= 0 or h <= 0:
		return
	var diameter: float = max(80.0, min(w, h) * 0.22)
	var start := Vector2(randf_range(-diameter, w), randf_range(-diameter, h))
	var end := Vector2(randf_range(-diameter, w), randf_range(-diameter, h))
	var duration := randf_range(FLOATER_DURATION_RANGE_S.x, FLOATER_DURATION_RANGE_S.y)

	var floater := Floater.new()
	floater_layer.add_child(floater)
	active_floaters.append(floater)
	floater.finished_drifting.connect(_on_floater_finished)
	floater.setup(base, kind_path, diameter, start, end, duration, circle_shader, floater_opacity)


func _on_floater_finished(floater: Floater) -> void:
	active_floaters.erase(floater)
	floater.queue_free()


# -------------------------------------------------------- settings setters

func set_mosaic_enabled(enabled: bool) -> void:
	mosaic_enabled = enabled
	_layout_tiles()


func set_floater_enabled(enabled: bool) -> void:
	floater_enabled = enabled
	if not enabled:
		for f in active_floaters.duplicate():
			f.queue_free()
		active_floaters.clear()


func set_floater_source(source: String) -> void:
	floater_source = source


func set_floater_count(count: int) -> void:
	floater_target_count = count


func set_floater_opacity(value: float) -> void:
	floater_opacity = value
