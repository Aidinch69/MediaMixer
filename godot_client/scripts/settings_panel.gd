extends PanelContainer
## First-pass settings panel: layout, mosaic, floater controls, quick
## overrides. Full reference for what's still to come (gamification
## readouts, audio sliders, autopilot, categories, quests) is
## mediamixer/native/settings_panel.py - this covers the core
## interactivity loop first.

const LAYOUTS := [["dual", "Dual"], ["grid2x2", "2x2"], ["grid2x3", "2x3"],
	["grid3x3", "3x3"], ["grid4x4", "4x4"], ["grid5x5", "5x5"]]
const SOURCES := ["dedicated", "library", "both"]

var main: Node


func setup(main_node: Node) -> void:
	main = main_node
	# Anchor-relative positioning (PRESET_TOP_RIGHT) computed against the
	# parent's size during the same _ready() pass that creates it, before
	# Godot's first real layout pass runs - it read a stale (0,0) parent
	# size and ended up off-screen to the left. The viewport's size is
	# reliable immediately, so position directly against that instead.
	var viewport_size := get_viewport_rect().size
	size = Vector2(280, 640)
	position = Vector2(viewport_size.x - size.x, 0)
	custom_minimum_size = size
	mouse_filter = Control.MOUSE_FILTER_STOP

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 6)
	add_child(vbox)

	vbox.add_child(_header("Layout"))
	var layout_grid := GridContainer.new()
	layout_grid.columns = 3
	vbox.add_child(layout_grid)
	for pair in LAYOUTS:
		var btn := Button.new()
		btn.text = pair[1]
		btn.pressed.connect(func(): ApiClient.set_layout(pair[0]))
		layout_grid.add_child(btn)

	var mosaic_cb := CheckBox.new()
	mosaic_cb.text = "Mosaic Fit"
	mosaic_cb.button_pressed = main.mosaic_enabled
	mosaic_cb.toggled.connect(func(v): main.set_mosaic_enabled(v))
	vbox.add_child(mosaic_cb)

	vbox.add_child(_header("Floating Overlay FX"))
	var floater_cb := CheckBox.new()
	floater_cb.text = "Enabled"
	floater_cb.button_pressed = main.floater_enabled
	floater_cb.toggled.connect(func(v): main.set_floater_enabled(v))
	vbox.add_child(floater_cb)

	var source_box := OptionButton.new()
	for s in SOURCES:
		source_box.add_item(s)
	source_box.selected = SOURCES.find(main.floater_source)
	source_box.item_selected.connect(func(idx): main.set_floater_source(SOURCES[idx]))
	vbox.add_child(source_box)

	var count_label := Label.new()
	count_label.text = "Count: %d" % main.floater_target_count
	vbox.add_child(count_label)
	var count_slider := HSlider.new()
	count_slider.min_value = 0
	count_slider.max_value = 10
	count_slider.value = main.floater_target_count
	count_slider.value_changed.connect(func(v):
		main.set_floater_count(int(v))
		count_label.text = "Count: %d" % int(v)
	)
	vbox.add_child(count_slider)

	var opacity_label := Label.new()
	opacity_label.text = "Opacity: %d%%" % int(main.floater_opacity * 100)
	vbox.add_child(opacity_label)
	var opacity_slider := HSlider.new()
	opacity_slider.min_value = 10
	opacity_slider.max_value = 100
	opacity_slider.value = main.floater_opacity * 100
	opacity_slider.value_changed.connect(func(v):
		main.set_floater_opacity(v / 100.0)
		opacity_label.text = "Opacity: %d%%" % int(v)
	)
	vbox.add_child(opacity_slider)

	vbox.add_child(_header("Overrides"))
	var skip_btn := Button.new()
	skip_btn.text = "Skip All"
	skip_btn.pressed.connect(func(): ApiClient.skip())
	vbox.add_child(skip_btn)

	var lock_btn := Button.new()
	lock_btn.text = "Lock"
	lock_btn.pressed.connect(func(): ApiClient.lock())
	vbox.add_child(lock_btn)


func _header(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", Color(0.79, 0.6, 1.0))
	return l
