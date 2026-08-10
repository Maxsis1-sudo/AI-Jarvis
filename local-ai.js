(() => {
  const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
  const ENABLE_KEY = 'hopi-local-ai-enabled-v1';
  const CDN_URL = 'https://esm.run/@mlc-ai/web-llm';

  const ai = {
    engine: null,
    module: null,
    loading: null,
    summaryPromise: null,
    enabled: localStorage.getItem(ENABLE_KEY) === '1',
    lastError: '',
    progress: 0,
    progressText: ''
  };

  function supportsWebGPU() {
    return !!navigator.gpu;
  }

  function setHomeStatus(text, tone = 'green') {
    const chip = document.querySelector('.status-chip');
    const mode = document.getElementById('modeLabel');
    if (chip) {
      chip.textContent = text;
      chip.dataset.tone = tone;
    }
    if (mode) mode.textContent = ai.enabled ? 'Lokální AI · bez externího API' : 'Lokální režim · bez externího API';
  }

  function injectUI() {
    const settings = document.getElementById('settingsView');
    if (!settings || document.getElementById('localAiCard')) return;

    const card = document.createElement('div');
    card.id = 'localAiCard';
    card.className = 'settings-card local-ai-card';
    card.innerHTML = `
      <div class="local-ai-head">
        <div>
          <h3>✦ Lokální AI shrnutí</h3>
          <p id="localAiDescription">Skutečný generativní model běží přímo v telefonu. Bez OpenAI API, bez Renderu a bez odesílání přepisu na náš server.</p>
        </div>
        <span id="localAiBadge" class="badge green">${ai.enabled ? 'zapnuto' : 'vypnuto'}</span>
      </div>
      <div id="localAiSupport" class="ai-support"></div>
      <div id="localAiProgressWrap" class="ai-progress-wrap hidden-ai">
        <div class="ai-progress-row"><span id="localAiProgressText">Připravuji model…</span><b id="localAiProgressPct">0 %</b></div>
        <div class="ai-progress"><i id="localAiProgressBar"></i></div>
      </div>
      <button id="localAiToggle" class="primary ai-toggle">${ai.enabled ? 'Načíst lokální AI' : 'Aktivovat lokální AI'}</button>
      <p class="ai-footnote">Při prvním použití se stáhne model do cache prohlížeče. Model Llama 3.2 1B potřebuje přibližně 879 MB VRAM; dostupnost závisí na iPhonu a verzi Safari.</p>`;

    const clear = document.getElementById('clearHistoryBtn');
    settings.insertBefore(card, clear || null);

    const style = document.createElement('style');
    style.textContent = `
      .local-ai-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.local-ai-head h3{margin-top:0}.ai-support{font-size:12px;line-height:1.45;margin:10px 0 12px;padding:10px 12px;border-radius:12px;background:#f3f7f4;color:#476052}.ai-support.ok{background:#eaf5ee;color:#176234}.ai-support.bad{background:#fff3ed;color:#8a4e2b}.ai-toggle{margin-top:10px}.ai-footnote{font-size:10px!important;color:#7b867f!important;line-height:1.45!important;margin:10px 0 0!important}.ai-progress-wrap{margin:12px 0}.hidden-ai{display:none!important}.ai-progress-row{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#58665d;margin-bottom:7px}.ai-progress{height:8px;background:#e6ece8;border-radius:999px;overflow:hidden}.ai-progress i{display:block;height:100%;width:0;background:#00843d;border-radius:inherit;transition:width .2s}.status-chip[data-tone="amber"]{background:#fff4db;color:#72591b}.status-chip[data-tone="red"]{background:#fff0ee;color:#a43c31}.brief-ai-note{display:flex;align-items:center;gap:8px;font-size:11px;color:#176234;background:#eaf5ee;border-radius:12px;padding:9px 11px;margin:0 0 10px}.process-ai-progress{margin-top:14px;width:min(320px,100%);margin-left:auto;margin-right:auto}.local-ai-home{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#eef8f2;border:1px solid #cfe7d8;border-radius:15px;padding:12px 13px;margin:12px 0}.local-ai-home strong{display:block;font-size:12px;color:#075f2f}.local-ai-home small{display:block;font-size:10px;color:#5d6d63;margin-top:3px;line-height:1.35}.local-ai-home button{flex:0 0 auto;border:0;border-radius:11px;padding:10px 12px;background:#00843d;color:#fff;font:inherit;font-size:11px;font-weight:850}.local-ai-home button:disabled{opacity:.55}`;
    document.head.appendChild(style);

    document.getElementById('localAiToggle').addEventListener('click', async () => {
      if (!supportsWebGPU()) {
        if (typeof toast === 'function') toast('WebGPU není na tomto zařízení dostupné.');
        return;
      }
      ai.enabled = true;
      localStorage.setItem(ENABLE_KEY, '1');
      updateSupportUI();
      try {
        await ensureEngine();
        if (typeof toast === 'function') toast('Lokální AI je připravena.');
      } catch (err) {
        console.error(err);
        ai.lastError = String(err?.message || err);
        updateSupportUI();
        if (typeof toast === 'function') toast('Model se nepodařilo načíst. Použiji lokální fallback.');
      }
    });

    const homeBtn = document.getElementById('localAiHomeBtn');
    homeBtn?.addEventListener('click', async () => {
      if (!supportsWebGPU()) {
        if (typeof toast === 'function') toast('WebGPU není na tomto zařízení dostupné.');
        return;
      }
      ai.enabled = true;
      localStorage.setItem(ENABLE_KEY, '1');
      updateSupportUI();
      try {
        await ensureEngine();
        if (typeof toast === 'function') toast('Lokální AI je připravena.');
      } catch (err) {
        console.error(err);
        ai.lastError = String(err?.message || err);
        updateSupportUI();
        if (typeof toast === 'function') toast('Model se nepodařilo načíst. Použiji lokální fallback.');
      }
    });

    updateSupportUI();
  }

  function updateSupportUI() {
    const support = document.getElementById('localAiSupport');
    const badge = document.getElementById('localAiBadge');
    const button = document.getElementById('localAiToggle');
    const homeBtn = document.getElementById('localAiHomeBtn');
    const homeStatus = document.getElementById('localAiHomeStatus');
    if (!support || !badge || !button) return;

    if (!supportsWebGPU()) {
      support.className = 'ai-support bad';
      support.textContent = 'Tento prohlížeč nemá WebGPU. AI shrnutí poběží v náhradním lokálním režimu.';
      badge.textContent = 'fallback';
      button.disabled = true;
      button.textContent = 'WebGPU není dostupné';
      if (homeStatus) homeStatus.textContent = 'WebGPU není dostupné – použije se náhradní shrnutí.';
      if (homeBtn) { homeBtn.disabled = true; homeBtn.textContent = 'Nedostupné'; }
      setHomeStatus('✓ Lokální zpracování', 'amber');
      return;
    }

    support.className = 'ai-support ok';
    if (ai.engine) {
      support.textContent = 'Lokální generativní AI je načtená a připravená pro meetingy.';
      badge.textContent = 'AI ready';
      button.textContent = 'Lokální AI je připravena';
      if (homeStatus) homeStatus.textContent = 'Model je načtený. Meetingy se budou shrnovat generativní AI.';
      if (homeBtn) { homeBtn.disabled = true; homeBtn.textContent = 'AI připravena'; }
      setHomeStatus('✦ Lokální AI připravena');
    } else if (ai.loading) {
      support.textContent = 'Model se právě načítá do telefonu.';
      badge.textContent = 'načítám';
      button.textContent = 'Načítám model…';
      if (homeStatus) homeStatus.textContent = 'Stahuji a připravuji model v telefonu…';
      if (homeBtn) { homeBtn.disabled = true; homeBtn.textContent = 'Načítám…'; }
      setHomeStatus('✦ Načítám lokální AI', 'amber');
    } else if (ai.enabled) {
      support.textContent = 'AI je zapnutá. Model se načte při prvním zpracování nebo tlačítkem níže.';
      badge.textContent = 'zapnuto';
      button.textContent = 'Načíst lokální AI';
      if (homeStatus) homeStatus.textContent = 'AI je zapnutá; model se načte při prvním použití.';
      if (homeBtn) { homeBtn.disabled = false; homeBtn.textContent = 'Načíst AI'; }
      setHomeStatus('✦ Lokální AI zapnuta');
    } else {
      support.textContent = 'WebGPU je dostupné. Můžeš aktivovat generativní AI přímo v telefonu.';
      badge.textContent = 'vypnuto';
      button.textContent = 'Aktivovat lokální AI';
      if (homeStatus) homeStatus.textContent = 'Jednorázově aktivuj lokální model pro skutečné AI shrnutí.';
      if (homeBtn) { homeBtn.disabled = false; homeBtn.textContent = 'Aktivovat AI'; }
      setHomeStatus('✓ Lokální zpracování');
    }
  }

  function updateProgress(report) {
    const progress = Math.max(0, Math.min(1, Number(report?.progress || 0)));
    ai.progress = progress;
    ai.progressText = report?.text || 'Načítám lokální AI…';
    const wrap = document.getElementById('localAiProgressWrap');
    const text = document.getElementById('localAiProgressText');
    const pct = document.getElementById('localAiProgressPct');
    const bar = document.getElementById('localAiProgressBar');
    wrap?.classList.remove('hidden-ai');
    if (text) text.textContent = ai.progressText;
    if (pct) pct.textContent = `${Math.round(progress * 100)} %`;
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    updateProcessAIProgress(ai.progressText, progress);
  }

  async function ensureEngine() {
    if (ai.engine) return ai.engine;
    if (ai.loading) return ai.loading;
    if (!supportsWebGPU()) throw new Error('WebGPU is not available.');

    ai.loading = (async () => {
      updateSupportUI();
      ai.module ||= await import(CDN_URL);
      const engine = await ai.module.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: updateProgress
      });
      ai.engine = engine;
      const wrap = document.getElementById('localAiProgressWrap');
      wrap?.classList.add('hidden-ai');
      updateSupportUI();
      return engine;
    })();

    try {
      return await ai.loading;
    } finally {
      ai.loading = null;
      updateSupportUI();
    }
  }

  function updateProcessAIProgress(text, progress = null) {
    const process = document.querySelector('#processView .process-screen');
    if (!process) return;
    let box = document.getElementById('processAiBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'processAiBox';
      box.className = 'info-box process-ai-progress';
      process.appendChild(box);
    }
    const pct = progress === null ? '' : ` · ${Math.round(progress * 100)} %`;
    box.textContent = `${text}${pct}`;
  }

  function chunksFor(text, maxChars = 7200) {
    const sentences = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + sentence.length + 1 > maxChars) {
        chunks.push(current);
        current = sentence;
      } else {
        current += (current ? ' ' : '') + sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks.length ? chunks : [String(text || '').trim()];
  }

  function parseJSONObject(text) {
    const raw = String(text || '').trim();
    try { return JSON.parse(raw); } catch {}
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('AI nevrátila validní JSON.');
  }

  async function chatJSON(system, user, maxTokens = 700) {
    const engine = await ensureEngine();
    const response = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.12,
      top_p: 0.9,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    });
    return parseJSONObject(response?.choices?.[0]?.message?.content || '');
  }

  const extractorSystem = `Jsi přesný asistent pro zápisy z obchodních a logistických meetingů. Pracuješ v češtině. Z textu vytahuj pouze fakta, která skutečně zazněla. Nic nevymýšlej. Nepřepisuj meeting slovo od slova. Vrať pouze JSON s klíči summary, decisions, tasks, requests, hopi, risks, followup. tasks je pole objektů {task,owner,deadline}; neznámé owner/deadline nech prázdné. Každá položka má být stručná a akční.`;

  const finalSystem = `Jsi seniorní KAM meeting assistant pro logistickou společnost. Vytvoř stručný manažerský Meeting Brief v češtině. Nepopisuj meeting chronologicky a neopakuj stenozáznam. Rozlišuj fakta a interní doporučení. Nic nevymýšlej. Vrať pouze validní JSON ve tvaru {"executive":"2-4 věty","decisions":[],"tasks":[{"task":"","owner":"","deadline":""}],"requests":[],"hopi":[],"risks":[],"followup":[],"recommendation":""}. executive musí odpovědět hlavně na otázku: O čem meeting byl a kam jsme se posunuli? recommendation je interní doporučení pro KAM a nesmí obsahovat vymyšlená fakta.`;

  async function summarizeWithAI(transcript) {
    const clean = String(transcript || '').trim();
    if (clean.length < 30) throw new Error('Přepis je příliš krátký pro AI shrnutí.');

    updateProcessAIProgress('Lokální AI analyzuje meeting…');
    const chunks = chunksFor(clean);
    let evidence;

    if (chunks.length === 1) {
      evidence = await chatJSON(extractorSystem, `PŘEPIS MEETINGU:\n${chunks[0]}`, 650);
    } else {
      const partials = [];
      for (let i = 0; i < chunks.length; i++) {
        updateProcessAIProgress(`Lokální AI analyzuje část ${i + 1} z ${chunks.length}…`);
        partials.push(await chatJSON(extractorSystem, `ČÁST ${i + 1}/${chunks.length}:\n${chunks[i]}`, 430));
      }
      evidence = { parts: partials };
    }

    updateProcessAIProgress('Lokální AI tvoří finální Meeting Brief…');
    const final = await chatJSON(finalSystem, `NÁZEV MEETINGU: ${document.getElementById('meetingName')?.value || 'Meeting'}\n\nEXTRAHOVANÉ PODKLADY:\n${JSON.stringify(evidence)}`, 850);

    return {
      executive: String(final.executive || '').trim() || 'Meeting byl zpracován lokální AI.',
      decisions: Array.isArray(final.decisions) ? final.decisions.filter(Boolean).slice(0, 7) : [],
      tasks: Array.isArray(final.tasks) ? final.tasks.slice(0, 8).map(t => ({
        task: String(t?.task || '').trim(),
        owner: String(t?.owner || '').trim() || 'Doplnit',
        deadline: String(t?.deadline || '').trim()
      })).filter(t => t.task) : [],
      requests: Array.isArray(final.requests) ? final.requests.filter(Boolean).slice(0, 7) : [],
      hopi: Array.isArray(final.hopi) ? final.hopi.filter(Boolean).slice(0, 7) : [],
      risks: Array.isArray(final.risks) ? final.risks.filter(Boolean).slice(0, 7) : [],
      followup: Array.isArray(final.followup) ? final.followup.filter(Boolean).slice(0, 7) : [],
      recommendation: String(final.recommendation || '').trim() || 'Potvrdit vlastníky úkolů a termíny před odesláním follow-upu.',
      source: typeof splitSentences === 'function' ? splitSentences(clean) : [clean],
      aiGenerated: true,
      aiModel: MODEL_ID
    };
  }

  async function prepareAIForCurrentMeeting() {
    if (!ai.enabled || !supportsWebGPU() || state?.demo) return null;
    if (!String(state?.transcript || '').trim()) return null;
    if (ai.summaryPromise) return ai.summaryPromise;

    ai.summaryPromise = (async () => {
      try {
        const result = await summarizeWithAI(state.transcript);
        state.analysis = result;
        setHomeStatus('✦ Shrnutí vytvořeno lokální AI');
        return result;
      } catch (err) {
        console.error('Local AI summary failed:', err);
        ai.lastError = String(err?.message || err);
        setHomeStatus('✓ Lokální fallback', 'amber');
        updateProcessAIProgress('AI nebyla dostupná. Používám lokální náhradní shrnutí.');
        return null;
      } finally {
        ai.summaryPromise = null;
      }
    })();
    return ai.summaryPromise;
  }

  function patchMeetingFlow() {
    const stopBtn = document.getElementById('stopBtn');
    const showBriefBtn = document.getElementById('showBriefBtn');
    const quickMailBtn = document.getElementById('quickMailBtn');
    if (!stopBtn || !showBriefBtn) return;

    const originalStop = stopBtn.onclick;
    stopBtn.onclick = async (event) => {
      const out = originalStop?.call(stopBtn, event);
      if (out?.then) await out;
      if (ai.enabled && supportsWebGPU()) {
        const wait = async () => {
          for (let i = 0; i < 20; i++) {
            if (state?.transcript?.trim() && state?.analysis) break;
            await new Promise(r => setTimeout(r, 120));
          }
          return prepareAIForCurrentMeeting();
        };
        wait();
      }
    };

    const originalBrief = showBriefBtn.onclick;
    showBriefBtn.onclick = async (event) => {
      if (ai.enabled && supportsWebGPU() && !state?.demo) {
        showView('processView');
        document.getElementById('processSummaryStep').innerHTML = '◌ <span>Lokální AI tvoří Meeting Brief</span>';
        await prepareAIForCurrentMeeting();
        document.getElementById('processSummaryStep').innerHTML = '✓ <span>Lokální AI shrnutí hotovo</span>';
      }
      originalBrief?.call(showBriefBtn, event);
      addAIBriefBadge();
    };

    if (quickMailBtn) {
      const originalQuickMail = quickMailBtn.onclick;
      quickMailBtn.onclick = async (event) => {
        if (ai.enabled && supportsWebGPU() && !state?.demo) await prepareAIForCurrentMeeting();
        originalQuickMail?.call(quickMailBtn, event);
      };
    }
  }

  function addAIBriefBadge() {
    const summaryTab = document.getElementById('summaryTab');
    if (!summaryTab || document.getElementById('briefAiNote')) return;
    const note = document.createElement('div');
    note.id = 'briefAiNote';
    note.className = 'brief-ai-note';
    note.textContent = state?.analysis?.aiGenerated
      ? '✦ Shrnutí vytvořila lokální generativní AI přímo v tomto zařízení.'
      : '✓ Použit lokální náhradní režim bez generativního modelu.';
    summaryTab.prepend(note);
  }

  window.HOPI_LOCAL_AI = {
    enable: async () => {
      ai.enabled = true;
      localStorage.setItem(ENABLE_KEY, '1');
      updateSupportUI();
      return ensureEngine();
    },
    summarize: summarizeWithAI,
    status: () => ({ enabled: ai.enabled, loaded: !!ai.engine, supported: supportsWebGPU(), model: MODEL_ID, error: ai.lastError })
  };

  injectUI();
  patchMeetingFlow();
  updateSupportUI();
})();