(() => {
  const CDN_URL = 'https://esm.run/@mlc-ai/web-llm';
  const ENABLE_KEY = 'hopi-local-ai-enabled-v2';

  // Mobile-first: do not try Llama 1B on iPhone first.
  // SmolLM2 360M needs substantially less GPU memory and is used only to
  // turn already extracted facts into a concise management brief.
  const PRIMARY_MODEL = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
  const FALLBACK_MODEL = 'SmolLM2-360M-Instruct-q4f32_1-MLC';
  const LOAD_TIMEOUT_MS = 60000;
  const GENERATE_TIMEOUT_MS = 30000;

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
    if (mode) mode.textContent = ai.enabled ? 'Rychlá lokální AI · bez API' : 'Lokální režim · bez externího API';
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
    processMessage(`Načítám rychlou lokální AI…`);
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
        return await timeout(createEngine(PRIMARY_MODEL), LOAD_TIMEOUT_MS, 'Načtení rychlé AI');
      } catch (firstErr) {
        console.warn('SmolLM2 q4f16 failed, trying q4f32:', firstErr);
        resetEngine();
        processMessage('První varianta modelu není podporovaná. Zkouším kompatibilní variantu…');
        return await timeout(createEngine(FALLBACK_MODEL), LOAD_TIMEOUT_MS, 'Načtení kompatibilní AI');
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

  async function streamJSON(system, user, maxTokens = 320) {
    const engine = await ensureEngine();
    const job = (async () => {
      const chunks = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.05,
        top_p: 0.85,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        stream: true
      });
      let out = '';
      let last = 0;
      for await (const chunk of chunks) {
        out += chunk.choices?.[0]?.delta?.content || '';
        if (out.length - last > 70) {
          last = out.length;
          processMessage('Rychlá AI skládá Meeting Brief…');
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

  const FINAL_SYSTEM = `Jsi seniorní KAM meeting assistant pro logistickou společnost. Odpovídej česky. Z předzpracovaných faktů vytvoř stručný manažerský Meeting Brief. Neopisuj meeting slovo od slova a nic nevymýšlej. Vrať pouze validní JSON: {"executive":"max 3 krátké věty","decisions":[],"tasks":[{"task":"","owner":"","deadline":""}],"requests":[],"hopi":[],"risks":[],"followup":[],"recommendation":""}. Každé pole maximálně 5 položek. recommendation je pouze interní doporučení pro KAM.`;

  function normalize(final, source, fallback) {
    const list = (value, backup=[]) => Array.isArray(value) && value.length ? value.filter(Boolean).slice(0,5) : (backup || []).slice(0,5);
    const tasks = Array.isArray(final.tasks) && final.tasks.length
      ? final.tasks.slice(0,6).map(t => ({
          task: String(t?.task || '').trim(),
          owner: String(t?.owner || '').trim(),
          deadline: String(t?.deadline || '').trim()
        })).filter(t => t.task)
      : (fallback?.tasks || []).slice(0,6);

    return {
      executive: String(final.executive || '').trim() || fallback?.executive || 'Meeting byl zpracován.',
      decisions: list(final.decisions, fallback?.decisions),
      tasks,
      requests: list(final.requests, fallback?.requests),
      hopi: list(final.hopi, fallback?.hopi),
      risks: list(final.risks, fallback?.risks),
      followup: list(final.followup, fallback?.followup),
      recommendation: String(final.recommendation || '').trim() || fallback?.recommendation || 'Potvrdit vlastníky úkolů a termíny před odesláním follow-upu.',
      source: typeof splitSentences === 'function' ? splitSentences(source) : [source],
      aiGenerated: true,
      aiModel: ai.model
    };
  }

  function compactEvidence(clean) {
    // First do the cheap deterministic extraction already present in app.js.
    // The LLM only rewrites these facts. This dramatically reduces prompt size
    // and avoids multi-pass generation on the phone.
    const fallback = typeof buildLocalAnalysis === 'function' ? buildLocalAnalysis(clean) : null;
    if (!fallback) {
      return { fallback: null, evidence: clean.slice(0, 5500) };
    }
    const evidence = {
      preliminaryConclusion: fallback.executive,
      decisions: (fallback.decisions || []).slice(0,6),
      tasks: (fallback.tasks || []).slice(0,7),
      customerRequests: (fallback.requests || []).slice(0,6),
      hopiPosition: (fallback.hopi || []).slice(0,6),
      risks: (fallback.risks || []).slice(0,6),
      followup: (fallback.followup || []).slice(0,6),
      selectedQuotes: (fallback.source || []).filter(x => String(x).length > 25).slice(0,10)
    };
    return { fallback, evidence: JSON.stringify(evidence) };
  }

  async function summarize(transcript) {
    const clean = String(transcript || '').trim();
    if (clean.length < 30) throw new Error('Přepis je příliš krátký pro AI shrnutí.');

    processMessage('Připravuji důležité body…');
    const { fallback, evidence } = compactEvidence(clean);
    processMessage('Rychlá lokální AI tvoří Meeting Brief…');

    // Always one generation only on mobile.
    const final = await streamJSON(
      FINAL_SYSTEM,
      `NÁZEV MEETINGU: ${document.getElementById('meetingName')?.value || 'Meeting'}\n\nPŘEDZPRACOVANÉ FAKTY:\n${evidence}`,
      320
    );
    return normalize(final, clean, fallback);
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
        console.error('Fast local AI failed:', err);
        ai.lastError = String(err?.message || err);
        processMessage('AI na tomto telefonu nestihla limit. Pokračuji okamžitě rychlým lokálním shrnutím.');
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
      <h3>✦ Rychlá lokální AI</h3>
      <p>Mobilní režim používá malý SmolLM2 360M model a pouze jeden AI průchod. Nejprve aplikace lokálně vytáhne fakta a AI je pak jen převede do stručného Meeting Briefu. Pokud telefon AI nezvládne do 30 sekund, pokračuje bez čekání fallbackem.</p>
      <button id="localAiV2Toggle" class="primary">${ai.enabled ? 'Načíst rychlou AI' : 'Aktivovat rychlou AI'}</button>`;
    settings.insertBefore(card, document.getElementById('clearHistoryBtn'));

    document.getElementById('localAiV2Toggle').onclick = async () => {
      ai.enabled = true;
      localStorage.setItem(ENABLE_KEY, '1');
      setStatus('✦ Načítám rychlou AI', 'amber');
      try {
        await ensureEngine();
        setStatus('✦ Rychlá AI připravena');
        if (typeof toast === 'function') toast('Rychlá lokální AI je připravena.');
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
        document.getElementById('processSummaryStep').innerHTML = '◌ <span>Rychlá AI tvoří Meeting Brief</span>';
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
      ? '✦ Shrnutí vytvořila rychlá lokální AI (SmolLM2 360M).'
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
  if (ai.enabled) setStatus('✦ Rychlá lokální AI zapnuta');
})();