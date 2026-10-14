shader_type canvas_item;

// Soft circular falloff applied as real alpha - this is the thing Qt
// could never do reliably for video content: here it's one GPU
// fragment shader op, composited correctly against whatever else is
// in the scene by Godot's own renderer, no native-window tricks.
uniform float feather_start : hint_range(0.0, 1.0) = 0.65;
uniform float edge : hint_range(0.0, 1.0) = 1.0;
// Darkens toward the edge within the visible disc, same intent as the
// Qt version's vignette tint - purely cosmetic, independent of the
// alpha falloff above which is what actually kills the square corners.
uniform float tint_strength : hint_range(0.0, 1.0) = 0.6;

void fragment() {
	vec2 centered = UV - vec2(0.5);
	float dist = length(centered) * 2.0;
	float alpha = 1.0 - smoothstep(feather_start, edge, dist);
	vec4 tex = texture(TEXTURE, UV);
	float tint_amount = smoothstep(0.45, edge, dist) * tint_strength;
	vec3 tinted = mix(tex.rgb, vec3(0.02, 0.01, 0.04), tint_amount);
	COLOR = vec4(tinted, tex.a * alpha);
}
