// An analyser reads the existing input without routing microphone audio to output.
export function createAudioAnalyser(context, source) {
  let analyser;
  try {
    if (typeof context?.createAnalyser !== "function" || typeof source?.connect !== "function") return null;
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    let disposed = false;
    return {
      analyser,
      dispose() {
        if (disposed) return;
        disposed = true;
        try { source.disconnect(analyser); } catch { /* The audio graph may already be closed. */ }
        try { analyser.disconnect(); } catch { /* Visualization cleanup must not affect recognition. */ }
      },
    };
  } catch {
    try { analyser?.disconnect(); } catch { /* An optional analyser can fail independently. */ }
    return null;
  }
}

export async function startMicrophoneVisualization({ signal, onAudioSource } = {}) {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (signal?.aborted || typeof navigator.mediaDevices?.getUserMedia !== "function" || typeof AudioContext !== "function") return null;

  let stream;
  let context;
  let source;
  let tap;
  let stopped = false;
  let resolveCancellation;
  const cancelled = new Promise((resolve) => { resolveCancellation = resolve; });
  const stopTracks = (input) => input?.getTracks().forEach((track) => track.stop());
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener("abort", stop);
    stopTracks(stream);
    tap?.dispose();
    try { source?.disconnect(); } catch { /* A closed graph is already released. */ }
    try {
      if (context && context.state !== "closed") void Promise.resolve(context.close()).catch(() => {});
    } catch { /* Optional visualization must not interrupt speech recognition. */ }
    resolveCancellation(null);
  };
  signal?.addEventListener("abort", stop, { once: true });

  try {
    const request = navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((input) => {
      // Permission dialogs cannot be dismissed by JavaScript. Release a stream
      // granted after this optional monitor has already been cancelled.
      if (stopped) { stopTracks(input); return null; }
      stream = input;
      return input;
    });
    if (!await Promise.race([request, cancelled]) || stopped) return null;
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    tap = createAudioAnalyser(context, source);
    if (!tap) { stop(); return null; }
    await Promise.race([context.resume(), cancelled]);
    if (stopped) return null;
    stream.getAudioTracks().forEach((track) => track.addEventListener("ended", stop, { once: true }));
    onAudioSource?.(tap.analyser);
    return { stop };
  } catch {
    stop();
    return null;
  }
}
