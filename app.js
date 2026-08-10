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
  audioUrl: null
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const supportsSpeech = !!SpeechRecognition;
const supportsRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

function show(id){ $(id).classList.remove('hidden'); }
function hide(id){ $(id).classList.add('hidden'); }
function toast(message){
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(()=>el.classList.remove('show'), 2200);
}
function escapeHtml(str=''){
  return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
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
function wordCount(text){ return (text.trim().match(/\S+/g)||[]).length; }

async function requestWakeLock(){
  try{
    if('wakeLock' in navigator){
      state.wakeLock = await navigator.wakeLock.request('screen');
      $('wakeBtn').textContent = 'Displej zapnutý';
    } else {
      $('wakeBtn').textContent = 'Displej dle systému';
    }
  }catch{
    $('wakeBtn').textContent = 'Displej dle systému';
  }
}

async function startMeeting(){
  const meetingName = $('meetingName').value.trim() || 'Meeting';
  $('activeMeetingName').textContent = meetingName;
  $('resultTitle').textContent = meetingName;
  state.transcript=''; state.interim=''; state.chunks=[]; state.audioUrl=null;
  $('liveTranscript').textContent='Čekám na první slova…';
  $('wordCount').textContent='0 slov';

  try{
    if(supportsRecorder){
      state.stream = await navigator.mediaDevices.getUserMedia({audio:true});
      state.recorder = new MediaRecorder(state.stream);
      state.recorder.ondataavailable = e => { if(e.data && e.data.size) state.chunks.push(e.data); };
      state.recorder.start(1000);
    } else if(!supportsSpeech){
      throw new Error('Mikrofon není v tomto prohlížeči dostupný.');
    }

    if(supportsSpeech){
      startRecognition();
    } else {
      show('supportCard');
    }

    hide('setupCard'); hide('resultCard'); hide('processingCard');
    show('recordingCard');
    state.startedAt=Date.now();
    state.timerId=setInterval(updateTimer,1000);
    updateTimer();
    requestWakeLock();
  }catch(err){
    toast(err.message || 'Nepodařilo se spustit mikrofon.');
  }
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
      } else interim += (interim?' ':'') + text;
    }
    state.interim=interim;
    renderTranscript();
  };
  recognition.onerror = (event) => {
    if(!['no-speech','aborted'].includes(event.error)) $('recStatus').textContent='Přepis může být dočasně přerušen.';
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
  const elapsed = state.startedAt ? (Date.now()-state.startedAt)/1000 : 0;
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

  hide('recordingCard'); show('processingCard');
  setTimeout(()=>buildResult(elapsed),650);
}

function sentences(text){
  const normalized=text.replace(/\s+/g,' ').trim();
  if(!normalized) return [];
  return normalized.split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(x=>x.length>8);
}
function unique(items){
  const seen=new Set();
  return items.filter(x=>{const k=x.toLocaleLowerCase('cs-CZ');if(seen.has(k))return false;seen.add(k);return true;});
}
function selectByRegex(all, regex, limit){ return unique(all.filter(x=>regex.test(x))).slice(0,limit); }
function fallbackHighlights(all,limit=5){ return all.filter(x=>x.length>35).slice(0,limit); }
function createSummaryModel(text){
  const all=sentences(text);
  const decisions=selectByRegex(all,/(dohod|domluv|rozhod|schvál|potvrd|platí|shodl|odsouhlas|budeme|bude|souhlas)/i,8);
  const tasks=selectByRegex(all,/(pošl|zašl|prověř|ověř|spočít|dopočít|připrav|dodá|zajistí|zjist|dopln|uděl|úkol|termín|deadline|do\s+\d)/i,10);
  const open=selectByRegex(all,/(otevřen|dořešit|problém|rizik|čekáme|není|nevíme|otázk|prověřit|diskuse|nesoulad)/i,8);
  const highlights=unique([...decisions,...fallbackHighlights(all,6)]).slice(0,6);
  return {
    highlights: highlights.length?highlights:['Přepis neobsahuje dostatek textu pro automatické shrnutí.'],
    decisions: decisions.length?decisions:['Nebylo automaticky rozpoznáno jednoznačné rozhodnutí.'],
    tasks: tasks.length?tasks:['Nebyl automaticky rozpoznán konkrétní úkol nebo termín.'],
    open: open.length?open:['Bez automaticky rozpoznaných otevřených bodů.']
  };
}
function sectionHtml(title, items){
  return `<section class="summary-section"><h3>${escapeHtml(title)}</h3><ul>${items.map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul></section>`;
}
function summaryText(model){
  const name=$('meetingName').value.trim()||'Meeting';
  return `${name} – zápis z jednání\n${todayLabel()}\n\nSHRNUTÍ\n${model.highlights.map(x=>'• '+x).join('\n')}\n\nDOHODNUTÁ ROZHODNUTÍ\n${model.decisions.map(x=>'• '+x).join('\n')}\n\nÚKOLY A DALŠÍ KROKY\n${model.tasks.map(x=>'• '+x).join('\n')}\n\nOTEVŘENÉ BODY / RIZIKA\n${model.open.map(x=>'• '+x).join('\n')}\n\n---\nVytvořeno pomocí HOPI Meeting Listener`;
}

function buildResult(elapsed){
  const text=(state.transcript+' '+state.interim).trim();
  const model=createSummaryModel(text);
  $('summary').innerHTML = sectionHtml('SHRNUTÍ',model.highlights)+sectionHtml('DOHODNUTÁ ROZHODNUTÍ',model.decisions)+sectionHtml('ÚKOLY A DALŠÍ KROKY',model.tasks)+sectionHtml('OTEVŘENÉ BODY / RIZIKA',model.open);
  $('summary').dataset.plain=summaryText(model);
  $('fullTranscript').textContent=text||'Živý přepis nebyl v tomto prohlížeči dostupný.';
  $('resultWordCount').textContent=`${wordCount(text)} slov`;
  $('resultMeta').textContent=`${todayLabel()} · délka ${secondsLabel(elapsed)}`;

  if(state.chunks.length){
    const blob=new Blob(state.chunks,{type:state.chunks[0].type||'audio/webm'});
    state.audioUrl=URL.createObjectURL(blob);
    $('audioPlayback').src=state.audioUrl;
    show('audioBox');
  } else hide('audioBox');

  hide('processingCard'); show('resultCard');
}

function sendEmail(){
  const to=$('emailTo').value.trim();
  const name=$('meetingName').value.trim()||'Meeting';
  const body=$('summary').dataset.plain||'';
  if(!body){ toast('Nejdřív vytvoř zápis.'); return; }
  const subject=`Zápis z jednání – ${name}`;
  window.location.href=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
async function copySummary(){
  try{ await navigator.clipboard.writeText($('summary').dataset.plain||''); toast('Zápis zkopírován.'); }
  catch{ toast('Kopírování se nepodařilo.'); }
}
async function shareSummary(){
  const text=$('summary').dataset.plain||'';
  if(navigator.share){
    try{ await navigator.share({title:$('meetingName').value.trim()||'Zápis z jednání',text}); }catch{}
  } else copySummary();
}
function newMeeting(){
  if(state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.transcript='';state.interim='';state.chunks=[];state.startedAt=null;
  hide('resultCard'); hide('processingCard'); hide('recordingCard'); show('setupCard');
  $('summary').innerHTML=''; $('fullTranscript').textContent=''; $('timer').textContent='00:00:00';
}

function updateNetwork(){
  const online=navigator.onLine;
  $('onlinePill').textContent=online?'online':'offline';
  $('onlinePill').style.color=online?'var(--hopi)':'#7b5b21';
}

$('startBtn').addEventListener('click',startMeeting);
$('stopBtn').addEventListener('click',stopMeeting);
$('emailBtn').addEventListener('click',sendEmail);
$('copyBtn').addEventListener('click',copySummary);
$('shareBtn').addEventListener('click',shareSummary);
$('newBtn').addEventListener('click',newMeeting);
$('wakeBtn').addEventListener('click',requestWakeLock);
window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);updateNetwork();

if(!supportsSpeech) show('supportCard');
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));