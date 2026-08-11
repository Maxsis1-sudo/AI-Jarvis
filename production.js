(() => {
  let wakeLock = null;

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    } catch (err) {
      console.warn('Wake lock unavailable:', err);
    }
  }

  async function releaseWakeLock() {
    try { await wakeLock?.release(); } catch {}
    wakeLock = null;
  }

  const start = document.getElementById('startBtn');
  if (start) {
    const originalStart = start.onclick;
    start.onclick = async event => {
      await requestWakeLock();
      return originalStart?.call(start, event);
    };
  }

  document.getElementById('stopBtn')?.addEventListener('click', () => {
    setTimeout(releaseWakeLock, 200);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.HOPI_APP?.state?.recording && !wakeLock) {
      requestWakeLock();
    }
  });

  window.addEventListener('beforeunload', event => {
    if (window.HOPI_APP?.state?.recording) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('offline', () => {
    window.HOPI_APP?.toast?.('Jsi offline. Nahrávání může pokračovat, ale zpracování bude potřebovat internet.');
  });

  window.addEventListener('online', () => {
    window.HOPI_APP?.toast?.('Připojení k internetu je zpět.');
  });

  // iOS/Safari-safe recorder shutdown. Some Safari versions do not deliver
  // the MediaRecorder stop event reliably, which previously left the UI stuck.
  if (window.HOPI_APP) {
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
      await new Promise(resolve => setTimeout(resolve, 120));
      state.audioBlob = new Blob(state.chunks || [], { type: mime });
      if (!state.audioBlob.size) throw new Error('Nahrávku se nepodařilo dokončit. Zkus meeting spustit znovu.');
      return state.audioBlob;
    };
  }

  const stop = document.getElementById('stopBtn');
  if (stop) {
    stop.type = 'button';
    stop.style.position = 'relative';
    stop.style.zIndex = '20';
    stop.style.pointerEvents = 'auto';
  }
})();
