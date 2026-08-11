(() => {
  const API_URL_KEY = 'hopi-api-base-v1';
  const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
  const api = { lastData: null, available: false, configured: false };

  const byId = id => document.getElementById(id);
  const sameOriginApi = () => location.hostname.endsWith('.onrender.com') || location.hostname === 'localhost';
  const normalizeBase = value => String(value || '').trim().replace(/\/+$/, '');
  const apiBase = () => sameOriginApi() ? '' : normalizeBase(localStorage.getItem(API_URL_KEY));
  const endpoint = path => `${apiBase()}${path}`;

  function setMode(text, tone = 'green') {
    const mode = byId('modeLabel');
    const chip = document.querySelector('.status-chip');
    if (mode) mode.textContent = text;
    if (chip) {
      chip.textContent = tone === 'green' ? '✓ Připraveno' : text;
      chip.dataset.tone = tone;
    }
  }

  function setProcess(step, text) {
    const summaryStep = byId('processSummaryStep');
    if (summaryStep) summaryStep.innerHTML = `${step === 'done' ? '✓' : '◌'} <span>${text}</span>`;
    const screen = document.querySelector('#processView .process-screen');
    if (!screen) return;
    let box = byId('apiProcessMessage');
    if (!box) {
      box = document.createElement('div');
      box.id = 'apiProcessMessage';
      box.className = 'info-box';
      box.style.marginTop = '12px';
      screen.appendChild(box);
    }
    box.textContent = text;
  }

  function injectConnectionSettings() {
    const settings = byId('settingsView');
    if (!settings || byId('apiSettingsCard')) return;
    const card = document.createElement('div');
    card.id = 'apiSettingsCard';
    card.className = 'settings-card';
    const configuredBase = apiBase();
    card.innerHTML = `
      <h3>↔ Připojení ke zpracování</h3>
      <p id="apiHealthText">Kontroluji připravenost…</p>
      ${sameOriginApi() ? '<p style="font-size:11px;color:#758079">Aplikace je připojená automaticky. Není potřeba nic nastavovat.</p>' : `
        <label class="field"><span>Adresa zpracování</span><input id="apiBaseInput" value="${configuredBase}" placeholder="https://...onrender.com"></label>
        <p style="font-size:11px;color:#758079">Toto nastavení je potřeba jen při používání verze z GitHub Pages.</p>`}
      <button id="apiTestBtn" class="primary">Otestovat spojení</button>`;
    settings.insertBefore(card, byId('clearHistoryBtn'));
    byId('apiBaseInput')?.addEventListener('change', e => {
      localStorage.setItem(API_URL_KEY, normalizeBase(e.target.value));
    });
    byId('apiTestBtn').onclick = () => checkHealth(true);
  }

  async function checkHealth(showToast = false) {
    const text = byId('apiHealthText');
    const base = apiBase();
    if (!sameOriginApi() && !base) {
      if (text) text.textContent = 'Není nastavená adresa zpracování.';
      setMode('Dokonči nastavení', 'amber');
      return false;
    }
    try {
      if (text) text.textContent = 'Kontroluji připravenost…';
      const response = await fetch(endpoint('/health'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      api.available = !!data.ok;
      api.configured = !!data.aiConfigured;
      if (api.available && api.configured) {
        if (text) text.textContent = '✓ Zpracování je připravené.';
        setMode('Připraveno');
        if (showToast && typeof toast === 'function') toast('Spojení je v pořádku.');
        return true;
      }
      if (text) text.textContent = 'Služba běží, ale zpracování ještě není nakonfigurované.';
      setMode('Zpracování není připravené', 'amber');
      return false;
    } catch (err) {
      console.warn('Processing health failed:', err);
      api.available = false;
      if (text) text.textContent = 'Služba se probouzí nebo je dočasně nedostupná.';
      setMode('Připravuji zpracování…', 'amber');
      if (showToast && typeof toast === 'function') toast('Spojení zatím není dostupné. Zkus test za chvíli znovu.');
      return false;
    }
  }

  function mimeExtension(mime) {
    if (/mp4|m4a/i.test(mime)) return 'm4a';
    if (/ogg/i.test(mime)) return 'ogg';
    if (/wav/i.test(mime)) return 'wav';
    return 'webm';
  }

  async function finishRecorder() {
    state.recording = false;
    clearInterval(state.timerId);
    try { state.recognition?.stop(); } catch {}
    const mime = state.recorder?.mimeType || state.chunks?.[0]?.type || 'audio/webm';
    if (state.recorder && state.recorder.state !== 'inactive') {
      await new Promise(resolve => {
        state.recorder.addEventListener('stop', resolve, { once: true });
        state.recorder.stop();
      });
    }
    state.stream?.getTracks().forEach(t => t.stop());
    return new Blob(state.chunks || [], { type: mime });
  }

  function mapSummary(summary, segments) {
    const s = summary || {};
    return {
      executive: String(s.executive || '').trim() || 'Meeting byl zpracován.',
      decisions: Array.isArray(s.decisions) ? s.decisions : [],
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
      requests: Array.isArray(s.customerRequests) ? s.customerRequests : [],
      hopi: Array.isArray(s.hopiPosition) ? s.hopiPosition : [],
      risks: Array.isArray(s.risks) ? s.risks : [],
      numbers: Array.isArray(s.numbers) ? s.numbers : [],
      followup: Array.isArray(s.followUp) ? s.followUp : [],
      recommendation: String(s.recommendation || '').trim(),
      source: (segments || []).map(x => x.text).filter(Boolean),
      aiGenerated: true,
      apiGenerated: true
    };
  }

  function hydrateFromApi(data) {
    api.lastData = data;
    const speakers = Array.isArray(data.speakers) ? data.speakers : [];
    const segments = Array.isArray(data.segments) ? data.segments : [];
    state.speakerCount = Math.max(1, speakers.length || 1);
    state.names = {};
    const idToIndex = Object.fromEntries(speakers.map((s, i) => [s.id, i]));
    state.turns = segments.map(seg => ({
      text: seg.text,
      time: Number(seg.start || 0),
      end: Number(seg.end || 0),
      speakerId: seg.speakerId,
      speakerIndex: Number.isInteger(idToIndex[seg.speakerId]) ? idToIndex[seg.speakerId] : 0
    }));
    state.transcript = segments.map(s => s.text).join(' ');
    state.analysis = mapSummary(data.summary, segments);
  }

  function enhanceSpeakerCards() {
    const speakers = api.lastData?.speakers || [];
    document.querySelectorAll('#speakerList .speaker-card').forEach((card, i) => {
      const s = speakers[i];
      if (!s) return;
      const quote = card.querySelector('.speaker-sample');
      if (quote && s.quote) quote.textContent = `„${s.quote}“`;
      const metas = card.querySelectorAll('.speaker-meta');
      if (metas.length > 1) metas[metas.length - 1].textContent = `${Math.round(Number(s.seconds || 0))} s`;
    });
    const helper = document.querySelector('#speakersView .helper');
    if (helper) helper.textContent = `Rozpoznáno ${speakers.length || state.speakerCount} řečníků. Doplň jména; propíšou se do úkolů i přepisu.`;
  }

  function mapNamedOwners() {
    if (!state.analysis) return;
    const namesById = {};
    for (let i = 0; i < state.speakerCount; i++) namesById[`speaker_${i + 1}`] = state.names[i] || `Řečník ${i + 1}`;
    state.analysis.tasks = (state.analysis.tasks || []).map(task => ({
      ...task,
      owner: namesById[task.owner] || task.owner || ''
    }));
    state.turns.forEach(turn => {
      turn.speakerName = state.names[turn.speakerIndex] || `Řečník ${turn.speakerIndex + 1}`;
    });
  }

  function patchBriefAfterRender() {
    const src = byId('sourceTranscript');
    if (src && state.turns?.length) {
      src.innerHTML = '';
      state.turns.forEach(turn => {
        const div = document.createElement('div');
        div.className = 'source-block';
        const name = turn.speakerName || state.names[turn.speakerIndex] || `Řečník ${turn.speakerIndex + 1}`;
        div.innerHTML = `<b>${esc(name)} · ${fmtTime(turn.time)}</b><p>${esc(turn.text)}</p>`;
        src.appendChild(div);
      });
    }

    document.getElementById('apiNumbersSection')?.remove();
    if (state.analysis?.numbers?.length) {
      const internal = document.querySelector('#summaryTab .internal');
      const section = document.createElement('section');
      section.id = 'apiNumbersSection';
      section.className = 'brief-section';
      section.innerHTML = '<h3>● Důležitá čísla</h3><ul></ul>';
      const ul = section.querySelector('ul');
      state.analysis.numbers.forEach(x => { const li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
      internal?.insertAdjacentElement('beforebegin', section);
    }

    document.getElementById('apiBriefBadge')?.remove();
    const summary = byId('summaryTab');
    if (summary) {
      const note = document.createElement('div');
      note.id = 'apiBriefBadge';
      note.className = 'info-box';
      note.style.marginBottom = '10px';
      note.textContent = '✓ Meeting byl zpracován a připraven ke kontrole.';
      summary.prepend(note);
    }
  }

  async function processMeetingWithApi() {
    const base = apiBase();
    if (!sameOriginApi() && !base) throw new Error('Není nastavená adresa zpracování.');
    showView('processView');
    setProcess('working', 'Ukončuji nahrávku…');
    const audio = await finishRecorder();
    if (!audio.size) throw new Error('Audio záznam je prázdný.');

    setProcess('working', 'Nahrávám meeting ke zpracování…');
    const form = new FormData();
    form.append('audio', audio, `meeting.${mimeExtension(audio.type)}`);
    form.append('meetingName', byId('meetingName')?.value || 'Meeting');
    form.append('language', 'cs');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      setProcess('working', 'Přepisuji řeč a rozpoznávám řečníky…');
      const response = await fetch(endpoint('/process-meeting'), {
        method: 'POST',
        body: form,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Chyba zpracování ${response.status}`);
      hydrateFromApi(payload);
      setProcess('done', 'Přepis, řečníci a Meeting Brief jsou hotové');
      renderSpeakers();
      enhanceSpeakerCards();
      showView('speakersView');
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('Zpracování překročilo časový limit. Zkus kratší nahrávku nebo požadavek zopakuj.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function fallbackAfterError(err) {
    console.error('Meeting processing failed:', err);
    try {
      if (!state.analysis) state.analysis = buildLocalAnalysis(state.transcript || '');
      state.speakerCount = Math.max(1, state.speakerCount || 1);
      renderSpeakers();
      showView('speakersView');
      if (typeof toast === 'function') toast(`Zpracování se nepodařilo: ${err.message || err}. Použit náhradní výstup z kontrolního přepisu.`);
    } catch (fallbackErr) {
      console.error(fallbackErr);
      showView('homeView');
      if (typeof toast === 'function') toast('Zpracování se nepodařilo. Zkus kratší testovací nahrávku.');
    }
  }

  function patchFlow() {
    const stop = byId('stopBtn');
    const apply = byId('applySpeakersBtn');
    const brief = byId('showBriefBtn');
    const quickMail = byId('quickMailBtn');
    if (!stop) return;

    stop.onclick = async () => {
      stop.disabled = true;
      try { await processMeetingWithApi(); }
      catch (err) { fallbackAfterError(err); }
      finally { stop.disabled = false; }
    };

    if (apply) {
      const originalApply = apply.onclick;
      apply.onclick = event => {
        collectNames();
        mapNamedOwners();
        originalApply?.call(apply, event);
      };
    }

    if (brief) {
      const originalBrief = brief.onclick;
      brief.onclick = event => {
        mapNamedOwners();
        originalBrief?.call(brief, event);
        patchBriefAfterRender();
      };
    }

    if (quickMail) {
      const originalQuick = quickMail.onclick;
      quickMail.onclick = event => {
        mapNamedOwners();
        originalQuick?.call(quickMail, event);
      };
    }
  }

  injectConnectionSettings();
  patchFlow();
  checkHealth();
  setTimeout(() => { if (!api.available) checkHealth(); }, 5000);
  window.HOPI_PROCESSING = { checkHealth, status: () => ({ ...api, base: apiBase() }) };
})();
