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
    if (document.visibilityState === 'visible' && typeof state !== 'undefined' && state.recording && !wakeLock) {
      requestWakeLock();
    }
  });

  window.addEventListener('beforeunload', event => {
    if (typeof state !== 'undefined' && state.recording) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('offline', () => {
    if (typeof toast === 'function') toast('Jsi offline. Nahrávání může pokračovat, ale zpracování bude potřebovat internet.');
  });

  window.addEventListener('online', () => {
    if (typeof toast === 'function') toast('Připojení k internetu je zpět.');
  });
})();
