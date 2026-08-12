(() => {
  if (!window.HOPI_APP?.state) return;

  const state = window.HOPI_APP.state;

  async function robustFinishRecording() {
    state.recording = false;
    clearInterval(state.timerId);
    state.timerId = null;

    try { state.recognition?.stop?.(); } catch {}

    const recorder = state.recorder;
    const mime = recorder?.mimeType || state.chunks?.[0]?.type || 'audio/webm';

    if (recorder && recorder.state !== 'inactive') {
      try { recorder.requestData?.(); } catch {}

      await new Promise(resolve => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallback);
          resolve();
        };

        const fallback = setTimeout(done, 1800);
        try { recorder.addEventListener('stop', done, { once: true }); } catch {}
        try { recorder.stop(); } catch { done(); }
      });
    }

    try { state.stream?.getTracks?.().forEach(track => track.stop()); } catch {}

    // Safari can deliver the final dataavailable shortly after stop.
    await new Promise(resolve => setTimeout(resolve, 120));

    const chunks = Array.isArray(state.chunks) ? state.chunks.filter(Boolean) : [];
    const blob = new Blob(chunks, { type: mime });
    state.audioBlob = blob;
    return blob;
  }

  window.HOPI_APP.finishRecording = robustFinishRecording;

  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) {
    stopBtn.style.touchAction = 'manipulation';
    stopBtn.style.pointerEvents = 'auto';
    stopBtn.setAttribute('aria-label', 'Ukončit nahrávání');
  }
})();
