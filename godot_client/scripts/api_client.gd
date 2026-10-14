extends Node
## Autoload singleton: talks to the existing Flask engine exactly like the
## browser and the old native Python app did, over the same /api/* routes.
## Establishes the mm_session cookie via one GET /api/status, then keeps a
## persistent GET /api/stream open and parses `data: {...}\n\n` SSE frames
## by hand (Godot's HTTPRequest can't stream an infinite response, so this
## uses the lower-level HTTPClient, polled from _process).

signal snapshot_received(data: Dictionary)
signal connected
signal connection_lost

const HOST := "127.0.0.1"
const PORT := 5000
const BASE_URL := "http://127.0.0.1:5000"

var _cookie: String = ""
var _stream_client: HTTPClient
var _buf := PackedByteArray()
var _sep := "\n\n".to_utf8_buffer()
var is_connected := false


func _ready() -> void:
	_bootstrap()


func _bootstrap() -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(result, code, headers, body):
		_extract_cookie(headers)
		http.queue_free()
		is_connected = true
		connected.emit()
		_start_stream()
	)
	http.request(BASE_URL + "/api/status")


func _extract_cookie(headers: PackedStringArray) -> void:
	for h in headers:
		if h.findn("Set-Cookie:") == 0:
			var value := h.substr(len("Set-Cookie:")).strip_edges()
			var first := value.split(";")[0]
			if first.begins_with("mm_session="):
				_cookie = first


func _cookie_headers() -> PackedStringArray:
	if _cookie == "":
		return PackedStringArray()
	return PackedStringArray(["Cookie: " + _cookie])


func _start_stream() -> void:
	_buf.clear()
	_stream_client = HTTPClient.new()
	var err := _stream_client.connect_to_host(HOST, PORT)
	if err != OK:
		push_error("ApiClient: connect_to_host failed: %s" % err)
		return
	set_process(true)


func _process(_delta: float) -> void:
	if _stream_client == null:
		return
	_stream_client.poll()
	match _stream_client.get_status():
		HTTPClient.STATUS_CONNECTED:
			_stream_client.request(HTTPClient.METHOD_GET, "/api/stream", _cookie_headers())
		HTTPClient.STATUS_BODY:
			var chunk := _stream_client.read_response_body_chunk()
			if chunk.size() > 0:
				_buf.append_array(chunk)
				_drain_buffer()
		HTTPClient.STATUS_DISCONNECTED, HTTPClient.STATUS_CONNECTION_ERROR, \
		HTTPClient.STATUS_CANT_CONNECT, HTTPClient.STATUS_CANT_RESOLVE:
			set_process(false)
			connection_lost.emit()
			await get_tree().create_timer(2.0).timeout
			_start_stream()


func _drain_buffer() -> void:
	while true:
		var idx := _find_bytes(_buf, _sep)
		if idx == -1:
			break
		var event_bytes := _buf.slice(0, idx)
		_buf = _buf.slice(idx + _sep.size())
		var text := event_bytes.get_string_from_utf8()
		for line in text.split("\n"):
			if line.begins_with("data: "):
				var parsed = JSON.parse_string(line.substr(6))
				if parsed != null:
					snapshot_received.emit(parsed)


func _find_bytes(haystack: PackedByteArray, needle: PackedByteArray) -> int:
	var n := needle.size()
	var h := haystack.size()
	if n == 0 or h < n:
		return -1
	for i in range(h - n + 1):
		var ok := true
		for j in range(n):
			if haystack[i + j] != needle[j]:
				ok = false
				break
		if ok:
			return i
	return -1


func _fire(path: String) -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(_r, _c, _h, _b): http.queue_free())
	http.request(BASE_URL + path, _cookie_headers())


func _fire_json(path: String, callback: Callable) -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(_r, _c, _h, body):
		var parsed = JSON.parse_string(body.get_string_from_utf8())
		http.queue_free()
		callback.call(parsed)
	)
	http.request(BASE_URL + path, _cookie_headers())


func skip() -> void: _fire("/api/skip")
func lock() -> void: _fire("/api/lock")
func next_audio() -> void: _fire("/api/next_audio")
func rotate(screen: int) -> void: _fire("/api/rotate?screen=%d" % screen)
func set_folder(folder: String) -> void: _fire("/api/folder?folder=%s" % folder.uri_encode())
func set_layout(mode: String) -> void: _fire("/api/layout?mode=%s" % mode)
func set_pace(mode: int) -> void: _fire("/api/pace?mode=%d" % mode)
func set_vector(key: String, val: float) -> void: _fire("/api/vector?key=%s&val=%f" % [key, val])
func cycle_tone() -> void: _fire("/api/cycle_tone")
func rate(screen: int, direction: String) -> void: _fire("/api/rate?screen=%d&dir=%s" % [screen, direction])
func set_preload(enabled: bool) -> void: _fire("/api/preload?enabled=%s" % ("true" if enabled else "false"))
func set_intensity(barrage: float, jackpot: float) -> void: _fire("/api/intensity?barrage=%f&jackpot=%f" % [barrage, jackpot])
func set_novelty(bonus: float) -> void: _fire("/api/novelty?bonus=%f" % bonus)


func list_folders(callback: Callable) -> void:
	_fire_json("/api/folders", func(parsed):
		callback.call(parsed["folders"] if parsed and parsed.has("folders") else [])
	)


func list_overlay_fx(source: String, callback: Callable) -> void:
	_fire_json("/api/overlay_fx/list?source=%s" % source, func(parsed):
		callback.call(parsed["items"] if parsed and parsed.has("items") else [])
	)
