extends Control
class_name VideoTile
## One grid cell: a VideoStreamPlayer plus rate buttons. Mirrors
## mediamixer/native/tile.py's VideoTile but with Godot's own video
## pipeline instead of an embedded native mpv window.

signal rated(index: int, direction: String)

var index: int = -1
var current_path: String = ""
var player: VideoStreamPlayer


func _ready() -> void:
	player = VideoStreamPlayer.new()
	player.set_anchors_preset(Control.PRESET_FULL_RECT)
	player.expand = true
	player.autoplay = false
	player.finished.connect(func(): player.play())
	add_child(player)

	var buttons := HBoxContainer.new()
	buttons.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	buttons.position.y -= 36
	buttons.add_theme_constant_override("separation", 4)
	add_child(buttons)

	var up := Button.new()
	up.text = "👍"
	up.pressed.connect(func(): rated.emit(index, "up"))
	buttons.add_child(up)

	var down := Button.new()
	down.text = "👎"
	down.pressed.connect(func(): rated.emit(index, "down"))
	buttons.add_child(down)


func set_source(rel_path: String) -> void:
	if rel_path == current_path:
		return
	current_path = rel_path
	MediaCache.get_video("/media/", rel_path, func(local_path: String):
		if local_path == "" or current_path != rel_path:
			return
		var stream = load(local_path)
		if stream:
			player.stream = stream
			player.play()
	)


func set_volume_db(db: float) -> void:
	player.volume_db = db


func aspect_ratio() -> float:
	if player and player.stream:
		var tex := player.get_video_texture()
		if tex:
			var size := tex.get_size()
			if size.y > 0:
				return float(size.x) / float(size.y)
	return 16.0 / 9.0
