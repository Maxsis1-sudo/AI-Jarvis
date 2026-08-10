(() => {
  const ENABLE_KEY = 'hopi-speaker-ai-enabled-v1';
  const MODEL_ID = 'Xenova/wavlm-base-plus-sv';
  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
  const MAX_VOICE_SAMPLES = 20;
  const SIMILARITY_THRESHOLD = 0.79;
  const MAX_SPEAKERS = 6;

  const spk = {
    enabled: localStorage.getItem(ENABLE_KEY) === '1',
    module: null,
    processor: null,
    model: null,
    loading: null,
    running: false,
    audioContext: null,
    source: null,
    processorNode: null,
    silentGain: null,
    ring: new Float32Array(16000 * 4),
    ringPos: 0,
    ringFilled: 0,
    inputSampleRate: 48000,
    error: ''
  };

  function helper(text) {
    const el = document.querySelector('#speakersView .helper');
    if (el) el.textContent = text;
  }

  function homeStatus(text) {
    let card = document.getElementById('speakerAiHome');
    const hero = document.querySelector('#homeView .hero-card');
    if (!hero) return;
    if (!card) {
      card = document.createElement('div');
      card.id = 'speakerAiHome';
      card.className = 'local-ai-home';
      const aiCard = document.querySelector('#homeView .local-ai-home');
      (aiCard || document.getElementById('startBtn'))?.insertAdjacentElement('afterend', card);
    }
    card.innerHTML = `<div><strong>👥 Lokální rozpoznání hlasů</strong><small>${text}</small></div><button id="speakerAiHomeBtn" type="button">${spk.enabled ? 'Zapnuto' : 'Aktivovat'}</button>`;
    document.getElementById('speakerAiHomeBtn').onclick = async () => {
      spk.enabled = true;
      localStorage.setItem(ENABLE_KEY, '1');
      homeStatus('Zapnuto. Model se načte až po meetingu; poprvé stáhne přibližně 102 MB.');
      if (typeof toast === 'function') toast('Lokální rozpoznání hlasů je zapnuté.');
    };
  }

  function injectSettings() {
    const settings = document.getElementById('settingsView');
    if (!settings || document.getElementById('speakerAiCard')) return;
    const card = document.createElement('div');
    card.id = 'speakerAiCard';
    card.className = 'settings-card';
    card.innerHTML = `
      <h3>👥 Lokální rozpoznání hlasů</h3>
      <p>Po meetingu aplikace vytvoří hlasové embeddingy z krátkých úseků řeči a lokálně je seskupí podle podobnosti. Používá kvantovaný WavLM speaker-verification model. Nic se neposílá na náš server.</p>
      <button id="speakerAiToggle" class="primary">${spk.enabled ? 'Rozpoznání hlasů je zapnuté' : 'Aktivovat rozpoznání hlasů'}</button>
      <p style="font-size:10px;color:#758079;margin-bottom:0">První použití stáhne přibližně 102 MB modelu. Výsledek je návrh; před odesláním vždy potvrdíš jména řečníků.</p>`;
    settings.insertBefore(card, document.getElementById('clearHistoryBtn'));
    document.getElementById('speakerAiToggle').onclick = () => {
      spk.enabled = true;
      localStorage.setItem(ENABLE_KEY, '1');
      document.getElementById('speakerAiToggle').textContent = 'Rozpoznání hlasů je zapnuté';
      homeStatus('Zapnuto. Model se načte až po meetingu; poprvé stáhne přibližně 102 MB.');
      if (typeof toast === 'function') toast('Rozpoznání hlasů zapnuto.');
    };
  }

  function appendRing(samples) {
    for (let i = 0; i < samples.length; i++) {
      spk.ring[spk.ringPos] = samples[i];
      spk.ringPos = (spk.ringPos + 1) % spk.ring.length;
      spk.ringFilled = Math.min(spk.ring.length, spk.ringFilled + 1);
    }
  }

  function downsample(input, fromRate, toRate = 16000) {
    if (fromRate === toRate) return Float32Array.from(input);
    const ratio = fromRate / toRate;
    const length = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      out[i] = sum / Math.max(1, end - start);
    }
    return out;
  }

  function ringSnapshot(seconds = 3.2) {
    const n = Math.min(spk.ringFilled, Math.floor(16000 * seconds));
    const out = new Float32Array(n);
    const start = (spk.ringPos - n + spk.ring.length) % spk.ring.length;
    for (let i = 0; i < n; i++) out[i] = spk.ring[(start + i) % spk.ring.length];
    return out;
  }

  function patchTurnPush() {
    if (!state?.turns || state.turns._speakerPatched) return;
    const arr = state.turns;
    const nativePush = Array.prototype.push;
    arr.push = function(...items) {
      items.forEach(item => {
        if (item && !item.voiceAudio && spk.ringFilled > 16000) item.voiceAudio = ringSnapshot();
      });
      return nativePush.apply(this, items);
    };
    arr._speakerPatched = true;
  }

  async function startAudioTap() {
    stopAudioTap();
    if (!state?.stream) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      spk.audioContext = ctx;
      spk.inputSampleRate = ctx.sampleRate || 48000;
      spk.ring.fill(0); spk.ringPos = 0; spk.ringFilled = 0;
      const source = ctx.createMediaStreamSource(state.stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const gain = ctx.createGain(); gain.gain.value = 0;
      node.onaudioprocess = e => appendRing(downsample(e.inputBuffer.getChannelData(0), spk.inputSampleRate));
      source.connect(node); node.connect(gain); gain.connect(ctx.destination);
      spk.source = source; spk.processorNode = node; spk.silentGain = gain;
      patchTurnPush();
    } catch (err) {
      console.warn('Speaker audio tap failed:', err);
    }
  }

  function stopAudioTap() {
    try { spk.processorNode?.disconnect(); } catch {}
    try { spk.source?.disconnect(); } catch {}
    try { spk.silentGain?.disconnect(); } catch {}
    try { spk.audioContext?.close(); } catch {}
    spk.processorNode = null; spk.source = null; spk.silentGain = null; spk.audioContext = null;
  }

  function normalize(vec) {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    const out = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
    return out;
  }

  function cosine(a, b) {
    let sum = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) sum += a[i] * b[i];
    return sum;
  }

  function meanVectors(vectors) {
    const out = new Float32Array(vectors[0].length);
    for (const v of vectors) for (let i = 0; i < out.length; i++) out[i] += v[i];
    for (let i = 0; i < out.length; i++) out[i] /= vectors.length;
    return normalize(out);
  }

  function clusterEmbeddings(items) {
    const clusters = [];
    for (const item of items) {
      let best = -1, bestSim = -Infinity;
      clusters.forEach((c, idx) => {
        const sim = cosine(item.embedding, c.centroid);
        if (sim > bestSim) { bestSim = sim; best = idx; }
      });
      if (best < 0 || (bestSim < SIMILARITY_THRESHOLD && clusters.length < MAX_SPEAKERS)) {
        clusters.push({ vectors: [item.embedding], centroid: item.embedding });
        item.cluster = clusters.length - 1;
      } else {
        item.cluster = best;
        clusters[best].vectors.push(item.embedding);
        clusters[best].centroid = meanVectors(clusters[best].vectors);
      }
    }
    return clusters;
  }

  async function ensureSpeakerModel() {
    if (spk.model && spk.processor) return;
    if (spk.loading) return spk.loading;
    spk.loading = (async () => {
      helper('Poprvé stahuji lokální hlasový model (~102 MB)…');
      spk.module ||= await import(TRANSFORMERS_URL);
      const progress_callback = p => {
        if (typeof p?.progress === 'number') helper(`Načítám hlasový model… ${Math.round(p.progress)} %`);
      };
      spk.processor = await spk.module.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
      spk.model = await spk.module.AutoModel.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback
      });
    })();
    try { await spk.loading; }
    finally { spk.loading = null; }
  }

  async function embedding(audio) {
    const inputs = await spk.processor(audio);
    const output = await spk.model(inputs);
    const tensor = output.embeddings || output.logits;
    if (!tensor?.data) throw new Error('Hlasový model nevrátil embedding.');
    return normalize(Float32Array.from(tensor.data));
  }

  function selectedTurns() {
    const usable = (state?.turns || []).map((turn, index) => ({ turn, index })).filter(x => x.turn.voiceAudio?.length > 16000);
    if (usable.length <= MAX_VOICE_SAMPLES) return usable;
    const picked = [];
    for (let i = 0; i < MAX_VOICE_SAMPLES; i++) picked.push(usable[Math.round(i * (usable.length - 1) / (MAX_VOICE_SAMPLES - 1))]);
    return picked;
  }

  function applyNearestLabels(sampled) {
    for (let i = 0; i < state.turns.length; i++) {
      if (state.turns[i].speakerIndex != null) continue;
      let nearest = sampled[0], dist = Infinity;
      for (const x of sampled) {
        const d = Math.abs((state.turns[i].time || 0) - (x.turn.time || 0));
        if (d < dist) { dist = d; nearest = x; }
      }
      state.turns[i].speakerIndex = nearest?.cluster ?? 0;
    }
  }

  function renderDetectedSpeakers() {
    const list = document.getElementById('speakerList');
    if (!list) return;
    list.innerHTML = '';
    for (let i = 0; i < state.speakerCount; i++) {
      const sample = state.turns.find(t => t.speakerIndex === i)?.text || 'Bez textové ukázky.';
      const card = document.createElement('div');
      card.className = 'speaker-card';
      card.innerHTML = `<div class="speaker-row"><div class="speaker-avatar">${i + 1}</div><div><div class="speaker-meta">Řečník ${i + 1}</div><input class="speaker-name" data-index="${i}" value="${typeof esc === 'function' ? esc(state.names[i] || '') : ''}" placeholder="Jméno, např. Roman"></div><div class="speaker-meta">AI hlas</div></div><p class="speaker-sample">„${typeof esc === 'function' ? esc(sample) : sample}“</p>`;
      list.appendChild(card);
    }
    const label = document.getElementById('speakerCountLabel');
    if (label) label.textContent = `${state.speakerCount} ${state.speakerCount === 1 ? 'řečník' : state.speakerCount < 5 ? 'řečníci' : 'řečníků'}`;
    helper(`Lokální hlasový model našel ${state.speakerCount} různé hlasové skupiny. Teď jen potvrď jména. Výsledek je návrh, ne biometrické ověření identity.`);
  }

  async function analyzeSpeakers() {
    if (!spk.enabled || spk.running || state?.demo) return null;
    const samples = selectedTurns();
    if (samples.length < 2) {
      helper('Pro automatické rozlišení hlasů nemám dost krátkých hlasových vzorků. Jména můžeš doplnit ručně.');
      return null;
    }
    spk.running = true;
    const apply = document.getElementById('applySpeakersBtn');
    if (apply) apply.disabled = true;
    try {
      await ensureSpeakerModel();
      const embedded = [];
      for (let i = 0; i < samples.length; i++) {
        helper(`Rozpoznávám hlasy lokálně… ${i + 1}/${samples.length}`);
        const emb = await embedding(samples[i].turn.voiceAudio);
        embedded.push({ ...samples[i], embedding: emb });
      }
      const clusters = clusterEmbeddings(embedded);
      embedded.forEach(x => { state.turns[x.index].speakerIndex = x.cluster; });
      applyNearestLabels(embedded);
      state.speakerCount = Math.max(1, Math.min(MAX_SPEAKERS, clusters.length));
      renderDetectedSpeakers();
      return clusters;
    } catch (err) {
      console.error('Local speaker recognition failed:', err);
      spk.error = String(err?.message || err);
      helper('Lokální rozpoznání hlasů se nepodařilo. Pokračuj ručním pojmenováním řečníků; meeting a shrnutí zůstávají funkční.');
      return null;
    } finally {
      spk.running = false;
      if (apply) apply.disabled = false;
      // Uvolnit RAM před generativní AI; model zůstává stažený v browser cache.
      try { await spk.model?.dispose?.(); } catch {}
      spk.model = null; spk.processor = null;
    }
  }

  function rebuildSourceLabels() {
    const src = document.getElementById('sourceTranscript');
    if (!src || !state?.turns?.length) return;
    src.innerHTML = '';
    state.turns.forEach((turn, i) => {
      const idx = Number.isInteger(turn.speakerIndex) ? turn.speakerIndex : (i % state.speakerCount);
      const name = state.names[idx] || `Řečník ${idx + 1}`;
      const d = document.createElement('div');
      d.className = 'source-block';
      d.innerHTML = `<b>${typeof esc === 'function' ? esc(name) : name} · ${typeof fmtTime === 'function' ? fmtTime(turn.time) : ''}</b><p>${typeof esc === 'function' ? esc(turn.text) : turn.text}</p>`;
      src.appendChild(d);
    });
  }

  function patchFlow() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const showBriefBtn = document.getElementById('showBriefBtn');
    if (startBtn) {
      const originalStart = startBtn.onclick;
      startBtn.onclick = async e => {
        const out = originalStart?.call(startBtn, e);
        if (out?.then) await out;
        if (spk.enabled && state?.stream) await startAudioTap();
      };
    }
    if (stopBtn) {
      const originalStop = stopBtn.onclick;
      stopBtn.onclick = async e => {
        const out = originalStop?.call(stopBtn, e);
        if (out?.then) await out;
        stopAudioTap();
        if (spk.enabled) {
          setTimeout(() => {
            helper('Připravuji lokální rozpoznání hlasů…');
            analyzeSpeakers();
          }, 1500);
        }
      };
    }
    if (showBriefBtn) {
      const originalBrief = showBriefBtn.onclick;
      showBriefBtn.onclick = async e => {
        if (spk.running) {
          if (typeof toast === 'function') toast('Ještě dokončuji rozpoznání hlasů…');
          while (spk.running) await new Promise(r => setTimeout(r, 250));
        }
        originalBrief?.call(showBriefBtn, e);
        setTimeout(rebuildSourceLabels, 0);
      };
    }
  }

  window.HOPI_SPEAKER_AI = {
    enable: () => { spk.enabled = true; localStorage.setItem(ENABLE_KEY, '1'); homeStatus('Zapnuto. Model se načte až po meetingu; poprvé stáhne přibližně 102 MB.'); },
    analyze: analyzeSpeakers,
    status: () => ({ enabled: spk.enabled, running: spk.running, error: spk.error, model: MODEL_ID })
  };

  injectSettings();
  homeStatus(spk.enabled ? 'Zapnuto. Po meetingu automaticky navrhnu rozdělení Řečník 1 / 2 / 3.' : 'Volitelné: lokálně rozlišit hlasy bez API (~102 MB při prvním použití).');
  patchFlow();
})();
