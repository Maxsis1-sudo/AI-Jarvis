(() => {
  if (!window.HOPI_APP) return;

  const state = HOPI_APP.state;

  HOPI_APP.finishRecording = async function finishRecordingSafe() {
    if (!state.recording && state.audioBlob?.size) return state.audioBlob;

    state.recording = false;
    clearInterval(state.timerId);
    state.timerId = null;

    try { state.recognition?.abort?.(); } catch {}

    const recorder = state.recorder;
    const mime = recorder?.mimeType || state.chunks?.[0]?.type || 'audio/webm';

    if (recorder && recorder.state !== 'inactive') {
      try { recorder.requestData?.(); } catch {}

      await new Promise(resolve => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(done, 1800);
        try { recorder.addEventListener('stop', done, { once: true }); } catch {}
        try { recorder.stop(); } catch { done(); }
      });
    }

    try { state.stream?.getTracks().forEach(track => track.stop()); } catch {}
    state.stream = null;

    // Give Safari a brief moment to deliver the final dataavailable chunk.
    await new Promise(resolve => setTimeout(resolve, 120));

    state.audioBlob = new Blob(state.chunks || [], { type: mime });
    if (!state.audioBlob.size) throw new Error('Nahrávku se nepodařilo dokončit. Zkus meeting spustit znovu.');
    return state.audioBlob;
  };

  const stop = document.getElementById('stopBtn');
  if (stop) {
    stop.style.position = 'relative';
    stop.style.zIndex = '20';
    stop.style.pointerEvents = 'auto';
    stop.setAttribute('type', 'button');
  }
})();
