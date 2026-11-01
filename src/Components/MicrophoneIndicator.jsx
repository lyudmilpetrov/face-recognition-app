import { useEffect, useRef } from "react";

const states = {
  idle: { label: "Idle", hint: "Press Start microphone to begin a new recording." },
  starting: { label: "Starting microphone…", hint: "Preparing your microphone. Allow access if your browser asks." },
  listening: { label: "Listening", hint: "Speak now. The waveform follows your microphone input." },
  stopped: { label: "Stopped", hint: "The microphone is off. Press Start microphone for a new recording." },
};

export default function MicrophoneIndicator({ state = "idle", analyser = null }) {
  const canvasRef = useRef(null);
  const listening = state === "listening";
  const details = states[state] || states.idle;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!listening || !analyser || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const samples = new Uint8Array(Math.min(analyser.fftSize || 2048, 2048));
    let active = true;
    let frame;

    const draw = () => {
      if (!active) return;
      const width = Math.max(1, canvas.clientWidth || 600);
      const height = Math.max(1, canvas.clientHeight || 80);
      const scale = globalThis.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * scale);
      const pixelHeight = Math.round(height * scale);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = getComputedStyle(canvas).color;
      context.lineWidth = 2;
      analyser.getByteTimeDomainData(samples);
      context.beginPath();
      for (let index = 0; index < samples.length; index += 1) {
        const x = index * width / (samples.length - 1);
        // Magnify quiet microphone input for display without altering the audio.
        const amplitude = Math.max(-1, Math.min(1, (samples[index] - 128) / 128 * 4));
        const y = height / 2 + amplitude * Math.max(0, height / 2 - 4);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      frame = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [listening, analyser]);

  return (
    <div role="group" aria-label="Microphone status" className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={`mt-0.5 size-5 shrink-0 ${listening ? "text-indigo-600 dark:text-indigo-300" : "text-slate-500 dark:text-slate-400"}`}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M6 10v1a6 6 0 0 0 12 0v-1M12 17v4M9 21h6" strokeLinecap="round" />
        </svg>
        <div aria-live="polite" aria-atomic="true" className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${listening ? "bg-indigo-600 dark:bg-indigo-300" : "bg-slate-400 dark:bg-slate-500"}`} />
            {details.label}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{listening && !analyser ? "Speak now. Microphone is active." : details.hint}</p>
        </div>
      </div>
      {listening && analyser && <canvas ref={canvasRef} aria-hidden="true" className="mt-3 block h-16 w-full rounded-lg bg-white text-indigo-600 sm:h-20 dark:bg-slate-800 dark:text-indigo-300" />}
    </div>
  );
}
