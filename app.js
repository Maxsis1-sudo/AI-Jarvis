const $ = id => document.getElementById(id);
const API_BASE = location.hostname.endsWith('.onrender.com') ? '' : 'https://hopi-meeting-assistant.onrender.com';
const STORAGE_KEY = 'hopi-kam-meetings-v3';
const DONE_KEY = 'hopi-kam-promises-done-v2';

const state = {
  recorder: null,
  stream: null,
  chunks: [],
  startedAt: 0,
  timerId: null,
  recording: false,
  stopping: false,
  audioBlob: null,
  markers: [],
  analysis: null,
  transcript: '',
  currentId: null
};

function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $(id)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===id));
  const nav=document.querySelector('.bottom-nav');
  if(nav) nav.style.display=(id==='recordView'||id==='processView')?'none':'grid';
  window.scrollTo({top:0,behavior:'smooth'});
  if(id==='tasksView') renderPromises();
  if(id==='customersView') renderCustomers();
}
function toast(msg){
  const t=$('toast'); if(!t) return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._x); t._x=setTimeout(()=>t.classList.remove('show'),3200);
}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}
function fmtTime(sec){sec=Math.max(0,Math.floor(sec||0));return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}
function dateLabel(ts=Date.now()){return new Intl.DateTimeFormat('cs-CZ',{dateStyle:'medium',timeStyle:'short'}).format(new Date(ts))}
function elapsed(){return state.startedAt?(Date.now()-state.startedAt)/1000:0}

function resetMeeting(){
  try{state.stream?.getTracks().forEach(t=>t.stop())}catch{}
  clearInterval(state.timerId);
  state.recorder=null; state.stream=null; state.chunks=[]; state.startedAt=0; state.timerId=null;
  state.recording=false; state.stopping=false; state.audioBlob=null; state.markers=[]; state.analysis=null; state.transcript=''; state.currentId=null;
  if($('timer')) $('timer').textContent='00:00';
  if($('markerCount')) $('markerCount').textContent='0 označených momentů';
  if($('recordStatus')) $('recordStatus').textContent='Nahrávání je aktivní.';
}

async function startMeeting(){
  resetMeeting();
  const customer=$('customerName')?.value.trim()||'';
  $('recordTitle').textContent=customer||'Meeting';
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofon není v tomto prohlížeči dostupný.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    state.stream=stream;
    if(!window.MediaRecorder) throw new Error('Nahrávání audia není podporované.');

    const types=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
    const mime=types.find(t=>MediaRecorder.isTypeSupported?.(t));
    state.recorder = mime ? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream);

    state.chunks=[];
    state.recorder.ondataavailable=e=>{ if(e.data && e.data.size>0) state.chunks.push(e.data); };
    state.recorder.onerror=e=>{
      console.error('MediaRecorder error',e);
      toast('Nahrávání hlásí chybu.');
    };
    state.recorder.start(1000);

    state.recording=true;
    state.startedAt=Date.now();
    state.timerId=setInterval(()=>{ if($('timer')) $('timer').textContent=fmtTime(elapsed()); },500);
    showView('recordView');
  }catch(err){
    try{state.stream?.getTracks().forEach(t=>t.stop())}catch{}
    state.stream=null;
    toast(err?.message||'Nepodařilo se spustit mikrofon.');
  }
}

function addImportantMarker(){
  if(!state.recording) return;
  state.markers.push(Math.round(elapsed()));
  $('markerCount').textContent=state.markers.length+' označených momentů';
  toast('Označeno '+fmtTime(state.markers[state.markers.length-1]));
}

async function stopRecorder(){
  if(state.audioBlob?.size) return state.audioBlob;
  const recorder=state.recorder;
  const mime=recorder?.mimeType || state.chunks?.[0]?.type || 'audio/webm';

  state.recording=false;
  clearInterval(state.timerId); state.timerId=null;

  if(!recorder){
    try{state.stream?.getTracks().forEach(t=>t.stop())}catch{}
    throw new Error('Recorder není aktivní.');
  }

  const stopped = new Promise(resolve=>{
    let resolved=false;
    const done=()=>{ if(resolved) return; resolved=true; resolve(); };
    recorder.addEventListener?.('stop',done,{once:true});
    setTimeout(done,1800);
  });

  try{ if(recorder.state!=='inactive') recorder.requestData?.(); }catch{}
  try{ if(recorder.state!=='inactive') recorder.stop(); }catch(err){ console.warn('recorder.stop()',err); }

  await stopped;
  try{state.stream?.getTracks().forEach(t=>t.stop())}catch{}
  state.stream=null;
  await new Promise(r=>setTimeout(r,120));

  state.audioBlob=new Blob(state.chunks,{type:mime});
  if(!state.audioBlob.size) throw new Error('Nahrávka je prázdná.');
  return state.audioBlob;
}

function setProcess(id,done,text){
  const el=$(id); if(el) el.innerHTML=(done?'✓':'◌')+' <span>'+text+'</span>';
}

async function uploadMeeting(audio){
  setProcess('processUpload',true,'Nahrávka připravena');
  setProcess('processTranscript',false,'Přepisuji meeting…');
  setProcess('processSummaryStep',false,'Připravuji Meeting Brief…');

  const form=new FormData();
  form.append('audio',audio,'meeting.'+(/mp4|m4a/i.test(audio.type)?'m4a':'webm'));
  form.append('language','cs');
  const customer=$('customerName')?.value.trim()||'';
  form.append('customer',customer);
  form.append('markers',JSON.stringify(state.markers||[]));
  const previous=previousContext(customer);
  if(previous) form.append('previousContext',JSON.stringify(previous));

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5*60*1000);
  try{
    const response=await fetch(API_BASE+'/process-meeting',{method:'POST',body:form,signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||('Chyba zpracování '+response.status));
    state.transcript=String(payload.transcript||'').trim();
    state.analysis=payload.summary||null;
    setProcess('processTranscript',true,'Přepis hotový');
    setProcess('processSummaryStep',true,'Meeting Brief hotový');
    renderBrief();
  }finally{clearTimeout(timeout)}
}

async function stopMeeting(){
  if(state.stopping) return;
  state.stopping=true;
  const btn=$('stopBtn');
  if(btn){btn.disabled=true;btn.textContent='Ukončuji…';}
  if($('recordStatus')) $('recordStatus').textContent='Ukončuji nahrávání…';
  showView('processView');
  setProcess('processUpload',false,'Ukončuji nahrávku…');

  try{
    const audio=await stopRecorder();
    await uploadMeeting(audio);
  }catch(err){
    console.error(err);
    toast('Zpracování se nepodařilo: '+(err?.message||err));
    showView('homeView');
  }finally{
    state.stopping=false;
    if(btn){btn.disabled=false;btn.textContent='■ Ukončit a zpracovat';}
  }
}

function history(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return[]}}
function saveHistory(items){localStorage.setItem(STORAGE_KEY,JSON.stringify(items.slice(0,100)))}
function latestForCustomer(customer){
  const key=String(customer||'').trim().toLocaleLowerCase('cs-CZ');
  if(!key) return null;
  return history().find(x=>String(x.customer||'').trim().toLocaleLowerCase('cs-CZ')===key)||null;
}
function previousContext(customer){
  const item=latestForCustomer(customer); if(!item) return null;
  const a=item.analysis||{};
  return {date:item.date,title:a.title||item.title,executive:a.executive,decisions:a.decisions,openPoints:a.openPoints,tasks:a.tasks,numbers:a.numbers,customerRequests:a.customerRequests,hopiPosition:a.hopiPosition,risks:a.risks,followUp:a.followUp};
}
function saveCurrentMeeting(){
  if(!state.analysis) return;
  const h=history(), id=state.currentId||String(Date.now());
  const existing=h.find(x=>x.id===id);
  state.currentId=id;
  const item={id,date:existing?.date||Date.now(),customer:$('customerName')?.value.trim()||'',email:$('emailTo')?.value.trim()||'',title:state.analysis.title||'Meeting',analysis:state.analysis,transcript:state.transcript};
  const idx=h.findIndex(x=>x.id===id); if(idx>=0)h[idx]=item;else h.unshift(item);
  saveHistory(h);
}

function fillList(id,items,empty='Bez zachycených bodů.'){
  const el=$(id); if(!el) return; el.innerHTML='';
  (items?.length?items:[empty]).forEach(x=>{const li=document.createElement('li');li.textContent=x;el.appendChild(li)});
}
function renderBrief(){
  const a=state.analysis;if(!a)return;
  $('briefTitle').textContent=a.title||'Meeting Brief';
  $('executiveSummary').textContent=a.executive||'Bez hlavního závěru.';
  fillList('decisionsList',a.decisions);fillList('openPointsList',a.openPoints,'Žádné otevřené body.');
  fillList('promisesList',a.myPromises,'Žádný jednoznačný závazek HOPI.');
  fillList('changesList',a.changes,'Bez dostupného předchozího meetingu nebo bez změn.');
  fillList('numbersList',a.numbers,'Bez důležitých čísel.');fillList('requestsList',a.customerRequests);
  fillList('hopiList',a.hopiPosition);fillList('risksList',a.risks,'Bez zachyceného rizika.');fillList('followupList',a.followUp);
  $('recommendation').textContent=a.recommendation||'Bez interního doporučení.';
  const tt=$('tasksTable');tt.innerHTML='';
  if(!a.tasks?.length)tt.innerHTML='<div class="task-row"><div>Bez konkrétního úkolu</div><div class="task-owner">—</div><div class="task-deadline">—</div></div>';
  else a.tasks.forEach(t=>{const row=document.createElement('div');row.className='task-row';row.innerHTML='<div>'+esc(t.task)+'<div class="task-side '+esc(t.side||'UNKNOWN')+'">'+(t.side==='HOPI'?'HOPI':t.side==='CUSTOMER'?'Zákazník':'Neurčeno')+'</div></div><div class="task-owner">'+esc(t.owner||'doplnit')+'</div><div class="task-deadline">'+esc(t.deadline||'doplnit')+'</div>';tt.appendChild(row)});
  $('sourceTranscript').innerHTML='<div class="source-block"><p>'+esc(state.transcript||'Přepis není dostupný.')+'</p></div>';
  saveCurrentMeeting(); renderPromises(); renderCustomers(); showView('briefView');
}
function plainSummary(){
  const a=state.analysis||{},out=[(a.title||'Meeting')+' – Meeting Brief',dateLabel(),'','HLAVNÍ ZÁVĚR',a.executive||''];
  const add=(title,arr)=>{if(arr?.length){out.push('',title,...arr.map(x=>'• '+x))}};
  add('DOHODNUTO',a.decisions);add('OTEVŘENÉ BODY',a.openPoints);
  if(a.tasks?.length)out.push('','ÚKOLY',...a.tasks.map(t=>'• '+t.task+' — '+(t.owner||t.side||'doplnit')+' — '+(t.deadline||'doplnit')));
  add('CO JSEM SLÍBIL',a.myPromises);add('DŮLEŽITÁ ČÍSLA',a.numbers);add('POŽADAVKY ZÁKAZNÍKA',a.customerRequests);add('POZICE HOPI',a.hopiPosition);add('RIZIKA',a.risks);add('FOLLOW-UP',a.followUp);
  return out.join('\n');
}
function customerEmail(){
  const a=state.analysis||{}, customer=$('customerName')?.value.trim()||'';
  const out=['Dobrý den,','',`děkuji za dnešní jednání${customer?' se společností '+customer:''}. Níže zasílám stručné shrnutí:`,''];
  if(a.decisions?.length){out.push('Dohodnuto:');a.decisions.forEach(x=>out.push('• '+x));out.push('')}
  if(a.tasks?.length){out.push('Další kroky:');a.tasks.forEach(t=>out.push('• '+t.task+(t.owner?' – '+t.owner:'')+(t.deadline?' – '+t.deadline:'')));out.push('')}
  if(a.openPoints?.length){out.push('Otevřené body:');a.openPoints.forEach(x=>out.push('• '+x));out.push('')}
  out.push('Děkuji a přeji hezký den.','','S pozdravem');return out.join('\n');
}
function openMail(){if(!state.analysis)return toast('Nejdřív vytvoř Meeting Brief.');const to=$('emailTo')?.value.trim()||'';location.href='mailto:'+encodeURIComponent(to)+'?subject='+encodeURIComponent('Shrnutí jednání – '+(state.analysis.title||'Meeting'))+'&body='+encodeURIComponent(customerEmail())}
async function copySummary(){try{await navigator.clipboard.writeText(plainSummary());toast('Shrnutí zkopírováno.')}catch{toast('Kopírování se nepodařilo.')}}
async function shareSummary(){if(navigator.share){try{await navigator.share({title:state.analysis?.title||'Meeting Brief',text:plainSummary()})}catch{}}else copySummary()}

function doneMap(){try{return JSON.parse(localStorage.getItem(DONE_KEY)||'{}')}catch{return{}}}
function setPromiseDone(key,value){const d=doneMap();d[key]=value;localStorage.setItem(DONE_KEY,JSON.stringify(d));renderPromises()}
function renderPromises(){
  const box=$('promiseList');if(!box)return;const d=doneMap(),rows=[];
  history().forEach(m=>(m.analysis?.myPromises||[]).forEach((p,i)=>rows.push({key:`${m.id}:${i}:${p}`,text:p,customer:m.customer,date:m.date,done:!!d[`${m.id}:${i}:${p}`]})));
  $('promiseCount').textContent=String(rows.filter(x=>!x.done).length);box.innerHTML='';
  if(!rows.length){box.innerHTML='<div class="empty">Zatím tu nejsou žádné zachycené závazky.</div>';return}
  rows.sort((a,b)=>Number(a.done)-Number(b.done)||b.date-a.date).forEach(r=>{const c=document.createElement('div');c.className='compact-card promise-item';c.innerHTML='<input type="checkbox" '+(r.done?'checked':'')+'><div><strong>'+esc(r.text)+'</strong><small>'+esc(r.customer||'Bez zákazníka')+' · '+esc(dateLabel(r.date))+'</small></div>';c.querySelector('input').onchange=e=>setPromiseDone(r.key,e.target.checked);box.appendChild(c)});
}
function renderCustomers(){
  const box=$('customerHistory');if(!box)return;const h=history();$('historyCount').textContent=String(h.length);box.innerHTML='';
  if(!h.length){box.innerHTML='<div class="empty">Zatím tu nejsou žádné uložené meetingy.</div>';return}
  const groups={};h.forEach(m=>{const k=m.customer||'Bez zákazníka';(groups[k]||(groups[k]=[])).push(m)});
  Object.entries(groups).forEach(([customer,items])=>{const g=document.createElement('div');g.className='customer-group';g.innerHTML='<h3>'+esc(customer)+' <small>('+items.length+')</small></h3><div class="compact-list"></div>';const list=g.querySelector('.compact-list');items.forEach(item=>{const c=document.createElement('div');c.className='compact-card';c.innerHTML='<strong>'+esc(item.title||'Meeting')+'</strong><small>'+esc(dateLabel(item.date))+'</small><p>'+esc(item.analysis?.executive||'')+'</p>';c.onclick=()=>loadHistory(item);list.appendChild(c)});box.appendChild(g)});
}
function loadHistory(item){resetMeeting();state.currentId=item.id;state.analysis=item.analysis;state.transcript=item.transcript||'';$('customerName').value=item.customer||'';$('emailTo').value=item.email||'';renderBrief()}

$('startBtn').onclick=startMeeting;
$('stopBtn').onclick=stopMeeting;
$('importantBtn').onclick=addImportantMarker;
$('briefBackBtn').onclick=()=>showView('homeView');
$('emailBtn').onclick=openMail;$('copyBtn').onclick=copySummary;$('shareBtn').onclick=shareSummary;$('pdfBtn').onclick=()=>window.print();
$('settingsTopBtn').onclick=()=>showView('settingsView');
$('clearHistoryBtn').onclick=()=>{if(confirm('Opravdu smazat historii meetingů v tomto zařízení?')){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(DONE_KEY);renderPromises();renderCustomers();toast('Historie byla smazána.')}};
document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab==='summary'?'summaryTab':'sourceTab').classList.add('active')});

renderPromises();renderCustomers();
fetch(API_BASE+'/health',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(d?.ok&&d?.aiConfigured)$('modeLabel').textContent='Připraveno';else $('modeLabel').textContent='Zpracování není připravené';}).catch(()=>{$('modeLabel').textContent='Služba se připravuje…';});
