(() => {
  // Migrate the previous local-AI preference to the new resilient implementation.
  if (localStorage.getItem('hopi-local-ai-enabled-v1') === '1' && localStorage.getItem('hopi-local-ai-enabled-v2') === null) {
    localStorage.setItem('hopi-local-ai-enabled-v2', '1');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Nepodařilo se načíst ${src}`));
      document.head.appendChild(script);
    });
  }

  // Speaker grouping first, generative summary second. Keeping them separate lets
  // the speaker model release RAM before WebLLM starts generating the brief.
  loadScript('./speaker-diarization.js')
    .then(() => loadScript('./local-ai-v2.js'))
    .catch(error => {
      console.error('HOPI local modules failed to load:', error);
      const chip = document.querySelector('.status-chip');
      if (chip) chip.textContent = '✓ Rychlé lokální shrnutí';
    });
})();
