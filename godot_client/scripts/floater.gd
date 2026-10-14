extends VideoStreamPlayer
class_name Floater
## Port of mediamixer/native/floater.py's FloaterSprite - same soft
## circular mask, proven in the Phase 0 spike, but now one GPU shader
## instead of a hand-rolled QPainter composite. Genuinely transparent
## and layered correctly over the grid because it's all one scene graph.

signal finished_drifting(floater: Floater)

var _tween: Tween


func setup(base: String, rel_path: String, diameter: float, start: Vector2, end: Vector2, duration_s: float, shader: Shader, tint_strength: float = 0.6) -> void:
	custom_minimum_size = Vector2(diameter, diameter)
	size = Vector2(diameter, diameter)
	position = start
	autoplay = false
	volume_db = -80.0

	var mat := ShaderMaterial.new()
	mat.shader = shader
	mat.set_shader_parameter("tint_strength", tint_strength)
	material = mat

	MediaCache.get_video(base, rel_path, func(local_path: String):
		if local_path == "":
			finished_drifting.emit(self)
			return
		var stream = load(local_path)
		if stream:
			self.stream = stream
			play()
	)

	_tween = create_tween()
	_tween.tween_property(self, "position", end, duration_s).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_tween.finished.connect(func(): finished_drifting.emit(self))
