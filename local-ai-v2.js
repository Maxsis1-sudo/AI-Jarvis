(() => {
  const CDN_URL = 'https://esm.run/@mlc-ai/web-llm';
  const ENABLE_KEY = 'hopi-local-ai-enabled-v2';
  const PRIMARY_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
  const LIGHT_MODEL = 'SmolLM2-360M-Instruct-q4f32_1-MLC';
  const LOAD_TIMEOUT_MS = 90000;
  const GENERATE_TIMEOUT_MS = 60000;

  const ai = {
    enabled: localStorage.getItem(ENABLE_KEY) === '1',
    engine: null,
    worker: null,
    module: null,
    model: null,
    loading: null,
    summaryPromise: null,
    lastError: ''
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const supportsWebGPU = () => !!navigator.gpu;

  function setStatus(text, tone='green') {
    const chip = document.querySelector('.status-chip');
    const mode = document.getElementById('modeLabel');
    const homeStatus = document.getElementById('localAiHomeStatus');
    if (chip) { chip.textContent = text; chip.dataset.tone = tone; }
    if (mode) mode.textContent = ai.enabled ? 'Lokální AI · bez externího API' : 'Lokální režim · bez externího API';
    if (homeStatus && text) homeStatus.textContent = text.replace(/^✦\s*/, '');
  }

  function processMessage(text) {
    const process = document.querySelector('#processView .process-screen');
    if (!process) return;
    let box = document.getElementById('processAiBoxV2');
    if (!box) {
      box = document.createElement('div');
      box.id = 'processAiBoxV2';
      box.className = 'info-box';
      box.style.marginTop = '12px';
      process.appendChild(box);
    }
    box.textContent = text;
  }

  function resetEngine() {
    try { ai.worker?.terminate(); } catch {}
    ai.worker = null;
    ai.engine = null;
    ai.loading = null;
    ai.model = null;
  }

  function timeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} trvá příliš dlouho.`)), ms);
      })
    ]).finally(() => clearTimeout(timer));
  }

  async function createEngine(model) {
    ai.module ||= await import(CDN_URL);
    ai.worker = new Worker('./local-ai-worker.js', { type: 'module' });
    processMessage(`Načítám lokální AI (${model === PRIMARY_MODEL ? 'standard' : 'lehký model'})…`);
    const engine = await ai.module.CreateWebWorkerMLCEngine(
      ai.worker,
      model,
      {
        initProgressCallback: report => {
          const pct = Math.round((Number(report?.progress || 0)) * 100);
          processMessage(`${report?.text || 'Načítám model…'}${pct ? ` · ${pct} %` : ''}`);
        }
      }
    );
    ai.engine = engine;
    ai.model = model;
    return engine;
  }

  async function ensureEngine() {
    if (ai.engine) return ai.engine;
    if (ai.loading) return ai.loading;
    if (!supportsWebGPU()) throw new Error('WebGPU není dostupné.');

    ai.loading = (async () => {
      try {
        return await timeout(createEngine(PRIMARY_MODEL), LOAD_TIMEOUT_MS, 'Načtení AI');
      } catch (firstErr) {
        console.warn('Primary local AI failed, trying light model:', firstErr);
        resetEngine();
        processMessage('Standardní model byl pro telefon příliš náročný. Zkouším lehčí model…');
        return await timeout(createEngine(LIGHT_MODEL), LOAD_TIMEOUT_MS, 'Načtení lehké AI');
      }
    })();

    try { return await ai.loading; }
    finally { ai.loading = null; }
  }

  function parseJSON(text) {
    const raw = String(text || '').trim();
    try { return JSON.parse(raw); } catch {}
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
    throw new Error('AI nevrátila validní JSON.');
  }

  async function streamJSON(system, user, maxTokens = 420) {
    const engine = await ensureEngine();
    const job = (async () => {
      const chunks = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        stream: true
      });
      let out = '';
      let last = 0;
      for await (const chunk of chunks) {
        out += chunk.choices?.[0]?.delta?.content || '';
        if (out.length - last > 80) {
          last = out.length;
          processMessage(`Lokální AI tvoří Meeting Brief… ${Math.min(95, Math.round(out.length / 8))} %`);
          await sleep(0);
        }
      }
      return parseJSON(out);
    })();

    try {
      return await timeout(job, GENERATE_TIMEOUT_MS, 'Generování Meeting Briefu');
    } catch (err) {
      resetEngine();
      throw err;
    }
  }

  function chunksFor(text, maxChars = 4200) {
    const sentences = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + sentence.length + 1 > maxChars) {
        chunks.push(current);
        current = sentence;
      } else current += (current ? ' ' : '') + sentence;
    }
    if (current) chunks.push(current);
    return chunks;
  }

  const FINAL_SYSTEM = `Jsi seniorní KAM meeting assistant pro logistickou společnost. V češtině vytvoř pouze stručný manažerský Meeting Brief. Neopisuj meeting slovo od slova. Nic nevymýšlej. Vrať pouze validní JSON: {"executive":"2-4 věty","decisions":[],"tasks":[{"task":"","owner":"","deadline":""}],"requests":[],"hopi":[],"risks":[],"followup":[],"recommendation":""}. executive vysvětluje, o čem meeting byl a kam se posunul. recommendation je pouze interní doporučení pro KAM.`;
  const PART_SYSTEM = `Z tohoto úseku obchodního/logistického meetingu vytáhni jen fakta důležitá pro další práci. Nic nevymýšlej. Vrať pouze JSON: {"summary":"","decisions":[],"tasks":[{"task":"","owner":"","deadline":""}],"requests":[],"hopi":[],"risks":[],"followup":[]}.`;

  function normalize(final, source) {
    return {
      executive: String(final.executive || '').trim() || 'Meeting byl zpracován lokální AI.',
      decisions: Array.isArray(final.decisions) ? final.decisions.filter(Boolean).slice(0, 6) : [],
      tasks: Array.isArray(final.tasks) ? final.tasks.slice(0, 7).map(t => ({
        task: String(t?.task || '').trim(),
        owner: String(t?.owner || '').trim(),
        deadline: String(t?.deadline || '').trim()
      })).filter(t => t.task) : [],
      requests: Array.isArray(final.requests) ? final.requests.filter(Boolean).slice(0, 6) : [],
      hopi: Array.isArray(final.hopi) ? final.hopi.filter(Boolean).slice(0, 6) : [],
      risks: Array.isArray(final.risks) ? final.risks.filter(Boolean).slice(0, 6) : [],
      followup: Array.isArray(final.followup) ? final.followup.filter(Boolean).slice(0, 6) : [],
      recommendation: String(final.recommendation || '').trim() || 'Potvrdit vlastníky úkolů a termíny před odesláním follow-upu.',
      source: typeof splitSentences === 'function' ? splitSentences(source) : [source],
      aiGenerated: true,
      aiModel: ai.model
    };
  }

  async function summarize(transcript) {
    const clean = String(transcript || '').trim();
    if (clean.length < 30) throw new Error('Přepis je příliš krátký pro AI shrnutí.');
    processMessage('Lokální AI analyzuje meeting…');
    const parts = chunksFor(clean);

    // Běžný mobilní meeting: jeden průchod = výrazně menší riziko zaseknutí.
    if (parts.length <= 1) {
      const final = await streamJSON(FINAL_SYSTEM, `NÁZEV: ${document.getElementById('meetingName')?.value || 'Meeting'}\n\nPŘEPIS:\n${clean}`, 420);
      return normalize(final, clean);
    }

    // Delší meeting: stručné mezivýstupy, pak finální konsolidace.
    const extracted = [];
    for (let i = 0; i < parts.length; i++) {
      processMessage(`Lokální AI analyzuje část ${i + 1} z ${parts.length}…`);
      extracted.push(await streamJSON(PART_SYSTEM, parts[i], 260));
    }
    processMessage('Lokální AI skládá finální Meeting Brief…');
    const final = await streamJSON(FINAL_SYSTEM, `NÁZEV: ${document.getElementById('meetingName')?.value || 'Meeting'}\n\nPODKLADY:\n${JSON.stringify(extracted)}`, 420);
    return normalize(final, clean);
  }

  async function prepare() {
    if (!ai.enabled || !supportsWebGPU() || state?.demo) return null;
    if (!String(state?.transcript || '').trim()) return null;
    if (ai.summaryPromise) return ai.summaryPromise;

    ai.summaryPromise = (async () => {
      try {
        const result = await summarize(state.transcript);
        state.analysis = result;
        setStatus('✦ AI shrnutí hotovo');
        return result;
      } catch (err) {
        console.error('Local AI v2 failed:', err);
        ai.lastError = String(err?.message || err);
        processMessage('Lokální AI byla příliš pomalá nebo nedostupná. Pokračuji rychlým lokálním shrnutím.');
        setStatus('✓ Rychlé lokální shrnutí', 'amber');
        return null;
      } finally {
        ai.summaryPromise = null;
      }
    })();
    return ai.summaryPromise;
  }

  function injectSettings() {
    const settings = document.getElementById('settingsView');
    if (!settings || document.getElementById('localAiV2Card')) return;
    const card = document.createElement('div');
    card.id = 'localAiV2Card';
    card.className = 'settings-card';
    card.innerHTML = `
      <h3>✦ Lokální AI shrnutí</h3>
      <p>Generativní model běží v samostatném vlákně, aby nezamrzlo rozhraní. Pokud je standardní model pro iPhone příliš náročný, aplikace automaticky zkusí lehčí variantu a při dlouhém čekání přejde na rychlý fallback.</p>
      <button id="localAiV2Toggle" class="primary">${ai.enabled ? 'Načíst AI' : 'Aktivovat AI'}</button>`;
    settings.insertBefore(card, document.getElementById('clearHistoryBtn'));

    document.getElementById('localAiV2Toggle').onclick = async () => {
      ai.enabled = true;
      localStorage.setItem(ENABLE_KEY, '1');
      setStatus('✦ Načítám lokální AI', 'amber');
      try {
        await ensureEngine();
        setStatus(`✦ AI připravena (${ai.model === PRIMARY_MODEL ? 'standard' : 'lehká'})`);
        if (typeof toast === 'function') toast('Lokální AI je připravena.');
      } catch (err) {
        ai.lastError = String(err?.message || err);
        setStatus('✓ Rychlé lokální shrnutí', 'amber');
        if (typeof toast === 'function') toast('AI model se nepodařilo načíst. Fallback zůstává funkční.');
      }
    };

    const homeBtn = document.getElementById('localAiHomeBtn');
    if (homeBtn) homeBtn.onclick = document.getElementById('localAiV2Toggle').onclick;
  }

  function patchFlow() {
    const showBriefBtn = document.getElementById('showBriefBtn');
    const quickMailBtn = document.getElementById('quickMailBtn');
    if (!showBriefBtn) return;

    const originalBrief = showBriefBtn.onclick;
    showBriefBtn.onclick = async event => {
      if (ai.enabled && supportsWebGPU() && !state?.demo) {
        showView('processView');
        document.getElementById('processSummaryStep').innerHTML = '◌ <span>Lokální AI tvoří Meeting Brief</span>';
        await prepare();
        document.getElementById('processSummaryStep').innerHTML = '✓ <span>Meeting Brief připraven</span>';
      }
      originalBrief?.call(showBriefBtn, event);
      addBadge();
    };

    if (quickMailBtn) {
      const originalQuick = quickMailBtn.onclick;
      quickMailBtn.onclick = async event => {
        if (ai.enabled && supportsWebGPU() && !state?.demo) await prepare();
        originalQuick?.call(quickMailBtn, event);
      };
    }
  }

  function addBadge() {
    const tab = document.getElementById('summaryTab');
    if (!tab) return;
    document.getElementById('briefAiNoteV2')?.remove();
    const div = document.createElement('div');
    div.id = 'briefAiNoteV2';
    div.className = 'info-box';
    div.style.marginBottom = '10px';
    div.textContent = state?.analysis?.aiGenerated
      ? `✦ Shrnutí vytvořila lokální AI (${state.analysis.aiModel === PRIMARY_MODEL ? 'Llama 1B' : 'lehký model'}).`
      : '✓ Použit rychlý lokální fallback.';
    tab.prepend(div);
  }

  window.HOPI_LOCAL_AI = {
    enable: async () => {
      ai.enabled = true;
      localStorage.setItem(ENABLE_KEY, '1');
      return ensureEngine();
    },
    summarize,
    reset: resetEngine,
    status: () => ({ enabled: ai.enabled, loaded: !!ai.engine, model: ai.model, error: ai.lastError })
  };

  injectSettings();
  patchFlow();
  if (ai.enabled) setStatus('✦ Lokální AI zapnuta');
})();
