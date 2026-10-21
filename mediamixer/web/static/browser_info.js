// What this browser/device can do for video - logged once per dashboard
// session (dashboard_telemetry.js) and added to the /debug export, so
// playback problems can be read against the machine they happened on.
// Shared by dashboard.html and debug.html.

function collectBrowserInfo() {
  const info = {
    ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency || null,
    memoryGB: navigator.deviceMemory || null, // Chrome rounds this, and caps it at 8
    screen: [screen.width, screen.height, window.devicePixelRatio],
    host: location.host,
    loopbackShards: /^(localhost|127\.0\.0\.1)$/.test(location.hostname), // see mediaOrigin()
    connection: navigator.connection ? { type: navigator.connection.effectiveType, downlinkMbps: navigator.connection.downlink } : null,
  };
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) info.gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  } catch (e) {}
  if (!navigator.mediaCapabilities) return Promise.resolve(info);
  // powerEfficient = decoded by the graphics hardware rather than the CPU.
  const probe = (label, contentType, width, height, bitrate, framerate) => navigator.mediaCapabilities
    .decodingInfo({ type: 'file', video: { contentType, width, height, bitrate, framerate } })
    .then((r) => [label, { supported: r.supported, smooth: r.smooth, hardware: r.powerEfficient }])
    .catch(() => [label, null]);
  return Promise.all([
    probe('proxy 640p30 h264', 'video/mp4; codecs="avc1.42E01E"', 640, 360, 1200000, 30),
    probe('1080p30 h264', 'video/mp4; codecs="avc1.640028"', 1920, 1080, 8000000, 30),
    probe('1080p60 h264 10-bit', 'video/mp4; codecs="avc1.6E0028"', 1920, 1080, 8000000, 60),
    probe('1080p30 hevc', 'video/mp4; codecs="hvc1.1.6.L120.90"', 1920, 1080, 8000000, 30),
  ]).then((rows) => Object.assign(info, { decode: Object.fromEntries(rows) }));
}
