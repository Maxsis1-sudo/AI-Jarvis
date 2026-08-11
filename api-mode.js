(() => {
  const API_URL_KEY='hopi-api-base-v1';
  const REQUEST_TIMEOUT_MS=5*60*1000;
  const byId=id=>document.getElementById(id);
  const sameOriginApi=()=>location.hostname.endsWith('.onrender.com')||location.hostname==='localhost';
  const normalizeBase=v=>String(v||'').trim().replace(/\/+$/,'');
  const apiBase=()=>sameOriginApi()?'':normalizeBase(localStorage.getItem(API_URL_KEY));
  const endpoint=path=>`${apiBase()}${path}`;

  function setMode(text){if(byId('modeLabel'))byId('modeLabel').textContent=text}
  async function checkHealth(showToast=false){try{const response=await fetch(endpoint('/health'),{cache:'no-store'});const data=await response.json();if(response.ok&&data.ok&&data.aiConfigured){setMode('Připraveno');if(showToast)HOPI_APP.toast('Zpracování je připravené.');return true}setMode('Zpracování není připravené');return false}catch{setMode('Připravuji zpracování…');if(showToast)HOPI_APP.toast('Služba se ještě připravuje.');return false}}
  function ext(mime){if(/mp4|m4a/i.test(mime))return'm4a';if(/ogg/i.test(mime))return'ogg';if(/wav/i.test(mime))return'wav';return'webm'}
  function setStep(id,done,text){const el=byId(id);if(el)el.innerHTML=`${done?'✓':'◌'} <span>${text}</span>`}

  async function processMeeting(){
    const state=HOPI_APP.state;
    HOPI_APP.showView('processView');
    setStep('processUpload',false,'Ukončuji nahrávku…');
    const audio=await HOPI_APP.finishRecording();
    if(!audio?.size)throw new Error('Audio záznam je prázdný.');
    setStep('processUpload',true,'Nahrávka připravena');
    setStep('processTranscript',false,'Přepisuji meeting…');
    setStep('processSummaryStep',false,'Připravuji Meeting Brief…');

    const customer=byId('customerName')?.value.trim()||'';
    const form=new FormData();
    form.append('audio',audio,`meeting.${ext(audio.type)}`);
    form.append('language','cs');
    form.append('customer',customer);
    form.append('markers',JSON.stringify(state.markers||[]));
    const previous=HOPI_APP.previousContext(customer);
    if(previous)form.append('previousContext',JSON.stringify(previous));

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    try{
      const response=await fetch(endpoint('/process-meeting'),{method:'POST',body:form,signal:controller.signal});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||`Chyba zpracování ${response.status}`);
      state.transcript=String(payload.transcript||'').trim();
      state.analysis=payload.summary||null;
      setStep('processTranscript',true,'Přepis hotový');
      setStep('processSummaryStep',true,'Meeting Brief hotový');
      HOPI_APP.renderBrief();
    }catch(err){
      if(err?.name==='AbortError')throw new Error('Zpracování překročilo časový limit.');
      throw err;
    }finally{clearTimeout(timer)}
  }

  const stop=byId('stopBtn');
  if(stop)stop.onclick=async()=>{stop.disabled=true;try{await processMeeting()}catch(err){console.error(err);HOPI_APP.toast(`Zpracování se nepodařilo: ${err.message||err}`);HOPI_APP.showView('homeView')}finally{stop.disabled=false}};

  const settings=byId('settingsView');
  if(settings&&!byId('connectionCard')){
    const card=document.createElement('div');card.id='connectionCard';card.className='settings-card';card.innerHTML=`<h3>↔ Připravenost</h3><p id="connectionText">Kontroluji…</p><button id="connectionTestBtn" class="primary">Otestovat spojení</button>`;settings.insertBefore(card,byId('clearHistoryBtn'));
    byId('connectionTestBtn').onclick=async()=>{const ok=await checkHealth(true);byId('connectionText').textContent=ok?'✓ Připraveno':'Služba není připravená.'};
  }
  checkHealth();setTimeout(checkHealth,5000);
  window.HOPI_PROCESSING={checkHealth};
})();
