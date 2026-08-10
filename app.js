const $ = (id) => document.getElementById(id);

const state = {
  recognition: null,
  recorder: null,
  stream: null,
  chunks: [],
  transcript: '',
  interim: '',
  startedAt: null,
  timerId: null,
  wakeLock: null,
  audioUrl: null,
  elapsed: 0,
  analysis: null,
  names: {}
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const supportsSpeech = !!SpeechRecognition;
const supportsRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
const apiUrl = (window.HOPI_CONFIG?.apiUrl || '').replace(/\/$/, '');

function show(id){ $(id).classList.remove('hidden'); }
function hide(id){ $(id).classList.add('hidden'); }
function toast(message){
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(()=>el.classList.remove('show'), 2300);
}
function escapeHtml(str=''){
  return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
}
function todayLabel(){
  return new Intl.DateTimeFormat('cs-CZ',{dateStyle:'medium',timeStyle:'short'}).format(new Date());
}
function secondsLabel(total){
  const h = String(Math.floor(total/3600)).padStart(2,'0');
  const m = String(Math.floor((total%3600)/60)).padStart(2,'0');
  const s = String(Math.floor(total%60)).padStart(2,'0');
  return `${h}:${m}:${s}`;
}
function shortTime(total){
  const m = Math.floor(total/60);
  const s = Math.floor(total%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
function wordCount(text){ return (String(text).trim().match(/\S+/g)||[]).length; }
function sentences(text){
  const normalized=String(text||'').replace(/\s+/g,' ').trim();
  if(!normalized) return [];
  return normalized.split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(x=>x.length>8);
}
function unique(items){
  const seen=new Set();
  return items.filter(x=>{
    const k=String(x).toLocaleLowerCase('cs-CZ');
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function requestWakeLock(){
  try{
    if('wakeLock' in navigator){
      state.wakeLock = await navigator.wakeLock.request('screen');
      $('wakeBtn').textContent = 'Displej zapnutý';
    } else $('wakeBtn').textContent = 'Displej dle systému';
  }catch{
    $('wakeBtn').textContent = 'Displej dle systému';
  }
}

async function startMeeting(){
  const meetingName = $('meetingName').value.trim() || 'Meeting';
  $('activeMeetingName').textContent = meetingName;
  $('resultTitle').textContent = meetingName;
  resetStateForMeeting();

  try{
    if(supportsRecorder){
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
      });
      const preferred = ['audio/webm;codecs=opus','audio/mp4','audio/webm']
        .find(t => MediaRecorder.isTypeSupported?.(t));
      state.recorder = preferred ? new MediaRecorder(state.stream,{mimeType:preferred}) : new MediaRecorder(state.stream);
      state.recorder.ondataavailable = e => { if(e.data && e.data.size) state.chunks.push(e.data); };
      state.recorder.start(1000);
    } else if(!supportsSpeech){
      throw new Error('Mikrofon není v tomto prohlížeči dostupný.');
    }

    if(supportsSpeech) startRecognition();
    else show('supportCard');

    hide('setupCard'); hide('resultCard'); hide('processingCard'); hide('speakersCard');
    show('recordingCard');
    state.startedAt=Date.now();
    state.timerId=setInterval(updateTimer,1000);
    updateTimer();
    requestWakeLock();
  }catch(err){
    toast(err.message || 'Nepodařilo se spustit mikrofon.');
  }
}

function resetStateForMeeting(){
  state.transcript='';
  state.interim='';
  state.chunks=[];
  state.audioUrl=null;
  state.analysis=null;
  state.names={};
  state.elapsed=0;
  $('liveTranscript').textContent='Čekám na první slova…';
  $('wordCount').textContent='0 slov';
  $('timer').textContent='00:00:00';
}

function startRecognition(){
  const recognition = new SpeechRecognition();
  recognition.lang='cs-CZ';
  recognition.continuous=true;
  recognition.interimResults=true;
  recognition.maxAlternatives=1;

  recognition.onresult = (event) => {
    let interim='';
    for(let i=event.resultIndex;i<event.results.length;i++){
      const text=event.results[i][0].transcript.trim();
      if(event.results[i].isFinal){
        if(text) state.transcript += (state.transcript ? ' ' : '') + text + (/[.!?]$/.test(text)?'':'.');
      } else if(text) interim += (interim?' ':'') + text;
    }
    state.interim=interim;
    renderTranscript();
  };

  recognition.onerror = (event) => {
    if(!['no-speech','aborted'].includes(event.error)){
      $('recStatus').textContent='Kontrolní přepis je dočasně přerušen, audio se dál nahrává.';
    }
  };

  recognition.onend = () => {
    if(!$('recordingCard').classList.contains('hidden')){
      try{ recognition.start(); }catch{}
    }
  };

  recognition.start();
  state.recognition=recognition;
}

function renderTranscript(){
  const text=[state.transcript,state.interim].filter(Boolean).join(' ');
  $('liveTranscript').textContent=text || 'Čekám na první slova…';
  $('wordCount').textContent=`${wordCount(text)} slov`;
  $('liveTranscript').scrollTop=$('liveTranscript').scrollHeight;
}

function updateTimer(){
  if(!state.startedAt) return;
  $('timer').textContent=secondsLabel((Date.now()-state.startedAt)/1000);
}

async function stopMeeting(){
  state.elapsed = state.startedAt ? (Date.now()-state.startedAt)/1000 : 0;
  clearInterval(state.timerId);
  try{ state.recognition?.stop(); }catch{}

  if(state.recorder && state.recorder.state !== 'inactive'){
    await new Promise(resolve => {
      state.recorder.addEventListener('stop', resolve, {once:true});
      state.recorder.stop();
    });
  }
  state.stream?.getTracks().forEach(t=>t.stop());
  try{ await state.wakeLock?.release(); }catch{}
  state.wakeLock=null;

  hide('recordingCard');
  show('processingCard');
  $('processingText').textContent = apiUrl
    ? 'Odesílám audio zabezpečenému AI backendu a rozpoznávám jednotlivé řečníky.'
    : 'Připravuji lokální výstup. Skutečné rozlišení více hlasů bude aktivní po připojení AI backendu.';

  try{
    state.analysis = apiUrl ? await processWithBackend() : buildLocalFallback();
  }catch(err){
    console.error(err);
    toast('AI backend není dostupný, používám lokální náhradní režim.');
    state.analysis = buildLocalFallback();
  }
  renderSpeakers();
  hide('processingCard');
  show('speakersCard');
}

function currentAudioBlob(){
  if(!state.chunks.length) return null;
  return new Blob(state.chunks,{type:state.chunks[0].type || state.recorder?.mimeType || 'audio/webm'});
}

async function processWithBackend(){
  const blob=currentAudioBlob();
  if(!blob) throw new Error('Chybí audio záznam.');
  const form=new FormData();
  form.append('audio',blob,'meeting-audio');
  form.append('meetingName',$('meetingName').value.trim()||'Meeting');
  form.append('language','cs');

  const res=await fetch(`${apiUrl}/process-meeting`,{method:'POST',body:form});
  if(!res.ok) throw new Error(`Backend ${res.status}`);
  return normalizeAnalysis(await res.json());
}

function normalizeAnalysis(raw){
  const speakers=(raw.speakers||[]).map((s,i)=>({
    id:s.id||`speaker_${i+1}`,
    label:s.label||`Řečník ${i+1}`,
    seconds:Number(s.seconds||0),
    quote:s.quote||''
  }));
  const segments=(raw.segments||[]).map((s,i)=>({
    speakerId:s.speakerId||s.speaker_id||speakers[0]?.id||'speaker_1',
    start:Number(s.start||0),
    end:Number(s.end||0),
    text:s.text||''
  }));
  return {
    speakers:speakers.length?speakers:[{id:'speaker_1',label:'Řečník 1',seconds:state.elapsed,quote:''}],
    segments,
    summary:{
      executive:raw.summary?.executive||'Meeting byl zpracován.',
      decisions:raw.summary?.decisions||[],
      tasks:raw.summary?.tasks||[],
      customerRequests:raw.summary?.customerRequests||raw.summary?.customer_requests||[],
      hopiPosition:raw.summary?.hopiPosition||raw.summary?.hopi_position||[],
      risks:raw.summary?.risks||[],
      numbers:raw.summary?.numbers||[],
      followUp:raw.summary?.followUp||raw.summary?.follow_up||[],
      recommendation:raw.summary?.recommendation||''
    }
  };
}

function buildLocalFallback(){
  const text=(state.transcript+' '+state.interim).trim();
  const all=sentences(text);
  const pick=(regex,limit)=>unique(all.filter(x=>regex.test(x))).slice(0,limit);
  const decisions=pick(/(dohod|domluv|rozhod|schvál|potvrd|shodl|odsouhlas|platí)/i,5);
  const taskLines=pick(/(pošl|zašl|prověř|ověř|spočít|dopočít|připrav|dodá|zajistí|zjist|dopln|uděl|termín|deadline)/i,6);
  const risks=pick(/(rizik|problém|pokles|ztrát|není|nevíme|nesoulad|čekáme)/i,4);
  const numbers=pick(/(\d+[%€]|%|\b\d+[,.]?\d*\s*(Kč|EUR|pal|palet|LKW|kamion|hod|dn|měs))/i,5);
  const highlights=unique([...decisions,...all.filter(x=>x.length>40)]).slice(0,4);
  const quote=all[0]||text.slice(0,140)||'Lokální přepis neobsahuje dostatek textu.';
  return {
    speakers:[{id:'speaker_1',label:'Řečník 1',seconds:state.elapsed,quote}],
    segments:text?[{speakerId:'speaker_1',start:0,end:state.elapsed,text}]:[],
    summary:{
      executive:highlights[0]||'Meeting byl zaznamenán. Pro kvalitní AI shrnutí a rozlišení více hlasů připoj zabezpečený backend.',
      decisions:decisions.length?decisions:['Bez jednoznačně rozpoznaného rozhodnutí.'],
      tasks:taskLines.map(x=>({task:x,owner:'speaker_1',deadline:'doplnit'})),
      customerRequests:[],
      hopiPosition:[],
      risks,
      numbers,
      followUp:['Zkontrolovat výstup a doplnit vlastníky a termíny.'],
      recommendation:'Lokální režim je pouze náhradní. Po připojení diarizačního AI backendu aplikace rozliší více řečníků a připraví kvalitnější manažerské shrnutí.'
    }
  };
}

function demoAnalysis(){
  return {
    speakers:[
      {id:'speaker_1',label:'Řečník 1',seconds:870,quote:'Od září počítáme s nižším objemem, než byl původní plán. Potřebujeme si potvrdit, jak se to promítne do ceny.'},
      {id:'speaker_2',label:'Řečník 2',seconds:640,quote:'Za HOPI potřebujeme nejdříve stabilní forecast. Lepší podmínky umíme navázat na objem a délku spolupráce.'},
      {id:'speaker_3',label:'Řečník 3',seconds:265,quote:'Penny Dobřany a Smiřice musíme posuzovat samostatně, protože to není standardní navazující multi-stop.'}
    ],
    segments:[
      {speakerId:'speaker_1',start:62,end:90,text:'Od září počítáme s nižším objemem, než byl původní plán. Potřebujeme si potvrdit, jak se to promítne do ceny.'},
      {speakerId:'speaker_2',start:91,end:128,text:'Za HOPI potřebujeme nejdříve stabilní forecast. Lepší obchodní podmínky umíme navázat na garantovaný objem a délku spolupráce.'},
      {speakerId:'speaker_1',start:220,end:252,text:'Forecast září až prosinec pošleme do středy. Pak můžeme uzavřít variantu spolupráce.'},
      {speakerId:'speaker_3',start:401,end:438,text:'Penny Dobřany a Smiřice musíme posuzovat samostatně, protože to není standardní navazující multi-stop a vzniká tam jiná ekonomika.'},
      {speakerId:'speaker_2',start:710,end:750,text:'HOPI připraví aktualizovaný sjednocený ceník CZ a SK včetně Holubic po potvrzení objemu.'},
      {speakerId:'speaker_1',start:1020,end:1058,text:'Za nás dává smysl roční model, pokud se dostaneme na cenu, která bude odpovídat reálnému objemu.'}
    ],
    summary:{
      executive:'MINIT očekává nižší objem než v původním plánu. Obě strany se shodly, že finální cenový model má být uzavřen až po potvrzení forecastu a provozního rozsahu.',
      decisions:[
        'Finální cenová varianta bude připravena až po potvrzení forecastu MINIT.',
        'Ceník CZ/SK bude sjednocen a doplněn o Holubice.',
        'Penny Dobřany + Smiřice bude vyhodnoceno samostatně mimo standardní multi-stop.'
      ],
      tasks:[
        {task:'Potvrdit forecast září–prosinec 2026.',owner:'speaker_1',deadline:'13. 8. 2026'},
        {task:'Připravit aktualizovanou cenovou variantu CZ/SK.',owner:'speaker_2',deadline:'14. 8. 2026'},
        {task:'Dopočítat ekonomiku Penny Dobřany + Smiřice.',owner:'speaker_3',deadline:'14. 8. 2026'}
      ],
      customerRequests:[
        'Zohlednit nižší očekávaný objem v nové cenové variantě.',
        'Mít jednoduchý a sjednocený model cen pro CZ a SK.'
      ],
      hopiPosition:[
        'Lepší obchodní podmínky musí být navázány na predikovatelný objem nebo závazek.',
        'Nestandardní provozní kombinace nelze automaticky oceňovat jako běžný multi-stop.'
      ],
      risks:[
        'Další pokles objemu může zhoršit ekonomiku navrženého distribučního modelu.',
        'Uzavření ceny před potvrzením forecastu by vytvořilo jednostranné obchodní riziko pro HOPI.'
      ],
      numbers:[
        'Modelová roční hodnota spolupráce: 16,8 mil. Kč.',
        'Poslední známý dopad cenové změny: +3,95 %.',
        'Diskutovaný rozsah: 5 LKW/den v hlavní sezóně.'
      ],
      followUp:[
        'Po obdržení forecastu porovnat flexibilní, standardní a hybridní variantu.',
        'Na příštím jednání uzavřít rozsah, cenu a pravidla pro nestandardní multi-stop.'
      ],
      recommendation:'Nevstupovat do finálního cenového závazku před potvrzením forecastu. Vyjednávání držet v pořadí objem → provozní model → závazek → cena.'
    }
  };
}

function startDemo(){
  $('meetingName').value='MINIT BOHEMIA';
  state.elapsed=1775;
  state.analysis=demoAnalysis();
  state.names={};
  hide('setupCard'); hide('resultCard'); hide('recordingCard');
  show('processingCard');
  $('processingText').textContent='Demo: rozpoznávám tři řečníky a vytahuji pouze obchodně důležité body.';
  setTimeout(()=>{
    renderSpeakers();
    hide('processingCard');
    show('speakersCard');
  },750);
}

function renderSpeakers(){
  const analysis=state.analysis;
  const list=$('speakerList');
  list.innerHTML='';
  analysis.speakers.forEach((speaker,index)=>{
    const firstQuote=speaker.quote || analysis.segments.find(s=>s.speakerId===speaker.id)?.text || 'Bez ukázky.';
    const card=document.createElement('div');
    card.className='speaker-card';
    card.innerHTML=`
      <div class="speaker-top">
        <div class="speaker-avatar">${index+1}</div>
        <div>
          <div class="speaker-id">${escapeHtml(speaker.label)}</div>
          <input class="speaker-name" data-speaker="${escapeHtml(speaker.id)}" value="${escapeHtml(state.names[speaker.id]||'')}" placeholder="Napiš jméno, např. Roman Froněk" />
        </div>
        <div class="speaker-time">${speaker.seconds?Math.max(1,Math.round(speaker.seconds/60))+' min':'hlas'}</div>
      </div>
      <p class="speaker-quote">„${escapeHtml(firstQuote)}“</p>`;
    list.appendChild(card);
  });
  $('speakerCountBadge').textContent=`${analysis.speakers.length} ${analysis.speakers.length===1?'hlas':'hlasy'}`;
}

function collectSpeakerNames(){
  document.querySelectorAll('.speaker-name').forEach(input=>{
    if(input.value.trim()) state.names[input.dataset.speaker]=input.value.trim();
  });
}

function speakerName(id){
  const speaker=state.analysis?.speakers.find(s=>s.id===id);
  return state.names[id] || speaker?.label || id || 'Neurčeno';
}

function showResult(useNames=true){
  if(useNames) collectSpeakerNames();
  hide('speakersCard');
  renderResult();
  show('resultCard');
}

function renderResult(){
  const a=state.analysis;
  const s=a.summary;
  const name=$('meetingName').value.trim()||'Meeting';
  $('resultTitle').textContent=name;
  $('resultMeta').textContent=`${todayLabel()} · délka ${secondsLabel(state.elapsed)} · ${a.speakers.length} řečníci`;
  $('executiveSummary').textContent=s.executive;

  const taskCount=(s.tasks||[]).length;
  const decisionCount=(s.decisions||[]).length;
  $('metrics').innerHTML=`
    <div class="metric"><b>${a.speakers.length}</b><span>ŘEČNÍCI</span></div>
    <div class="metric"><b>${decisionCount}</b><span>ROZHODNUTÍ</span></div>
    <div class="metric"><b>${taskCount}</b><span>ÚKOLY</span></div>`;

  const sections=[];
  if(s.decisions?.length) sections.push(sectionHtml('DOHODNUTO',s.decisions));
  if(s.tasks?.length) sections.push(tasksHtml(s.tasks));
  if(s.customerRequests?.length) sections.push(sectionHtml('POŽADAVKY ZÁKAZNÍKA',s.customerRequests));
  if(s.hopiPosition?.length) sections.push(sectionHtml('POZICE HOPI',s.hopiPosition));
  if(s.risks?.length) sections.push(sectionHtml('RIZIKA / OTEVŘENÉ BODY',s.risks));
  if(s.numbers?.length) sections.push(sectionHtml('ČÍSLA Z MEETINGU',s.numbers));
  if(s.followUp?.length) sections.push(sectionHtml('DALŠÍ FOLLOW-UP',s.followUp));
  $('summary').innerHTML=sections.join('');
  $('aiRecommendation').textContent=s.recommendation||'Bez interního doporučení.';

  renderSpeakerTranscript();
  const transcriptText=a.segments.map(x=>x.text).join(' ');
  $('resultWordCount').textContent=`${wordCount(transcriptText)} slov`;

  const blob=currentAudioBlob();
  if(blob){
    if(state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl=URL.createObjectURL(blob);
    $('audioPlayback').src=state.audioUrl;
    show('audioBox');
  } else hide('audioBox');

  $('summary').dataset.plain=buildPlainSummary();
}

function sectionHtml(title,items){
  return `<section class="summary-section"><h3>${escapeHtml(title)}</h3><ul>${items.map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul></section>`;
}

function tasksHtml(tasks){
  return `<section class="summary-section"><h3>ÚKOLY / OWNER / DEADLINE</h3><div class="task-table">${
    tasks.map(t=>`<div class="task-row"><div>${escapeHtml(t.task||String(t))}</div><div class="task-owner">${escapeHtml(t.owner?speakerName(t.owner):'Doplnit')}</div><div class="task-date">${escapeHtml(t.deadline||'doplnit')}</div></div>`).join('')
  }</div></section>`;
}

function renderSpeakerTranscript(){
  const wrap=$('speakerTranscript');
  wrap.innerHTML='';
  if(!state.analysis.segments.length){
    wrap.innerHTML='<div class="muted">Detailní přepis není k dispozici.</div>';
    return;
  }
  state.analysis.segments.forEach(seg=>{
    const row=document.createElement('div');
    row.className='segment';
    row.innerHTML=`
      <div class="segment-speaker">${escapeHtml(speakerName(seg.speakerId))}<span class="segment-time">${shortTime(seg.start)}–${shortTime(seg.end)}</span></div>
      <div class="segment-text">${escapeHtml(seg.text)}</div>`;
    wrap.appendChild(row);
  });
}

function buildPlainSummary(){
  const s=state.analysis.summary;
  const name=$('meetingName').value.trim()||'Meeting';
  const lines=[
    `${name} – shrnutí jednání`,
    todayLabel(),
    '',
    'HLAVNÍ ZÁVĚR',
    s.executive,
    ''
  ];
  const add=(title,items)=>{
    if(!items?.length) return;
    lines.push(title,...items.map(x=>'• '+x),'');
  };
  add('DOHODNUTO',s.decisions);
  if(s.tasks?.length){
    lines.push('ÚKOLY');
    s.tasks.forEach(t=>lines.push(`• ${t.task} — ${t.owner?speakerName(t.owner):'Doplnit'} — ${t.deadline||'doplnit'}`));
    lines.push('');
  }
  add('POŽADAVKY ZÁKAZNÍKA',s.customerRequests);
  add('RIZIKA / OTEVŘENÉ BODY',s.risks);
  add('DALŠÍ FOLLOW-UP',s.followUp);
  return lines.join('\n');
}

function buildCustomerEmail(){
  const s=state.analysis.summary;
  const name=$('meetingName').value.trim()||'Meeting';
  const lines=[
    'Dobrý den,',
    '',
    `děkuji za dnešní jednání k tématu ${name}. Níže zasílám stručné shrnutí hlavních bodů:`,
    '',
    'Dohodnuto:'
  ];
  (s.decisions||[]).forEach(x=>lines.push(`• ${x}`));
  if(s.tasks?.length){
    lines.push('','Další kroky:');
    s.tasks.forEach(t=>lines.push(`• ${t.task} – ${t.owner?speakerName(t.owner):'odpovědná strana bude doplněna'}${t.deadline?' – '+t.deadline:''}`));
  }
  if(s.followUp?.length){
    lines.push('','Navazující témata:');
    s.followUp.forEach(x=>lines.push(`• ${x}`));
  }
  lines.push('','Děkuji a přeji hezký den.','','S pozdravem');
  return lines.join('\n');
}

function sendEmail(){
  const to=$('emailTo').value.trim();
  const name=$('meetingName').value.trim()||'Meeting';
  const body=buildCustomerEmail();
  const subject=`Shrnutí jednání – ${name}`;
  window.location.href=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
async function copySummary(){
  try{ await navigator.clipboard.writeText($('summary').dataset.plain||buildPlainSummary()); toast('Shrnutí zkopírováno.'); }
  catch{ toast('Kopírování se nepodařilo.'); }
}
async function shareSummary(){
  const text=$('summary').dataset.plain||buildPlainSummary();
  if(navigator.share){
    try{ await navigator.share({title:$('meetingName').value.trim()||'Shrnutí jednání',text}); }catch{}
  } else copySummary();
}
function newMeeting(){
  if(state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  resetStateForMeeting();
  hide('resultCard'); hide('processingCard'); hide('recordingCard'); hide('speakersCard');
  show('setupCard');
}
function updateNetwork(){
  const online=navigator.onLine;
  $('onlinePill').textContent=online?'online':'offline';
  $('onlinePill').style.color=online?'var(--hopi)':'#7b5b21';
}

$('startBtn').addEventListener('click',startMeeting);
$('demoBtn').addEventListener('click',startDemo);
$('stopBtn').addEventListener('click',stopMeeting);
$('applySpeakersBtn').addEventListener('click',()=>showResult(true));
$('skipSpeakersBtn').addEventListener('click',()=>showResult(false));
$('emailBtn').addEventListener('click',sendEmail);
$('copyBtn').addEventListener('click',copySummary);
$('shareBtn').addEventListener('click',shareSummary);
$('newBtn').addEventListener('click',newMeeting);
$('wakeBtn').addEventListener('click',requestWakeLock);
window.addEventListener('online',updateNetwork);
window.addEventListener('offline',updateNetwork);
updateNetwork();

if(!apiUrl) show('supportCard');
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));