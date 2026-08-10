const $ = id => document.getElementById(id);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const STORAGE_KEY = 'hopi-meeting-history-v1';

const state = {
  recognition:null, recorder:null, stream:null, chunks:[], audioUrl:null,
  startedAt:0, timerId:null, transcript:'', interim:'', turns:[], recording:false,
  analysis:null, speakerCount:3, names:{}, currentId:null, demo:false
};

function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $(id)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===id));
  window.scrollTo({top:0,behavior:'smooth'});
}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.remove('show'),2200)}
function wc(text){return (String(text||'').trim().match(/\S+/g)||[]).length}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}
function fmtTime(sec){sec=Math.max(0,Math.floor(sec||0));const m=String(Math.floor(sec/60)).padStart(2,'0');const s=String(sec%60).padStart(2,'0');return `${m}:${s}`}
function dateLabel(ts=Date.now()){return new Intl.DateTimeFormat('cs-CZ',{dateStyle:'medium',timeStyle:'short'}).format(new Date(ts))}
function elapsed(){return state.startedAt?(Date.now()-state.startedAt)/1000:0}

function resetMeeting(){
  try{if(state.audioUrl)URL.revokeObjectURL(state.audioUrl)}catch{}
  state.chunks=[];state.audioUrl=null;state.transcript='';state.interim='';state.turns=[];state.analysis=null;state.names={};state.speakerCount=3;state.currentId=null;state.demo=false;
  $('liveTranscript').textContent='Čekám na první slova…';$('wordCount').textContent='0 slov';$('timer').textContent='00:00';
}

async function startMeeting(){
  resetMeeting();
  const name=$('meetingName').value.trim()||'Meeting';
  $('recordTitle').textContent=name;
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofon není v tomto prohlížeči dostupný.');
    state.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(window.MediaRecorder){
      const types=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
      const mime=types.find(t=>MediaRecorder.isTypeSupported?.(t));
      state.recorder=mime?new MediaRecorder(state.stream,{mimeType:mime}):new MediaRecorder(state.stream);
      state.recorder.ondataavailable=e=>{if(e.data?.size)state.chunks.push(e.data)};
      state.recorder.start(1000);
    }
    state.recording=true;state.startedAt=Date.now();state.timerId=setInterval(()=>$('timer').textContent=fmtTime(elapsed()),500);
    if(SpeechRecognition) startRecognition();
    else toast('Živý přepis není v tomto prohlížeči dostupný. Audio se ale nahrává.');
    showView('recordView');
  }catch(e){toast(e.message||'Nepodařilo se spustit mikrofon.')}
}

function startRecognition(){
  const r=new SpeechRecognition();
  r.lang='cs-CZ';r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
  r.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const text=e.results[i][0].transcript.trim();
      if(e.results[i].isFinal&&text){
        const clean=text+( /[.!?]$/.test(text)?'':'.');
        state.transcript+=(state.transcript?' ':'')+clean;
        state.turns.push({text:clean,time:elapsed()});
      }else if(text) interim+=(interim?' ':'')+text;
    }
    state.interim=interim;
    const all=[state.transcript,interim].filter(Boolean).join(' ');
    $('liveTranscript').textContent=all||'Čekám na první slova…';$('wordCount').textContent=`${wc(all)} slov`;
  };
  r.onerror=e=>{if(!['no-speech','aborted'].includes(e.error))toast('Kontrolní přepis je dočasně přerušen.')};
  r.onend=()=>{if(state.recording){try{r.start()}catch{}}};
  try{r.start();state.recognition=r}catch{}
}

async function stopMeeting(){
  state.recording=false;clearInterval(state.timerId);try{state.recognition?.stop()}catch{}
  if(state.recorder&&state.recorder.state!=='inactive') await new Promise(resolve=>{state.recorder.addEventListener('stop',resolve,{once:true});state.recorder.stop()});
  state.stream?.getTracks().forEach(t=>t.stop());
  showView('processView');
  $('processSummaryStep').innerHTML='◌ <span>Analýza a shrnutí</span>';
  setTimeout(()=>{
    state.analysis=buildLocalAnalysis(state.transcript);
    $('processSummaryStep').innerHTML='✓ <span>Analýza a shrnutí</span>';$('processSummaryStep').classList.add('done');
    setTimeout(()=>{renderSpeakers();showView('speakersView')},500);
  },900);
}

function splitSentences(text){const x=String(text||'').replace(/\s+/g,' ').trim();return x?x.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(s=>s.length>7):[]}
function uniq(items){const seen=new Set();return items.filter(x=>{const k=x.toLowerCase();if(seen.has(k))return false;seen.add(k);return true})}
function pick(all,re,limit=5){return uniq(all.filter(s=>re.test(s))).slice(0,limit)}
function buildLocalAnalysis(text){
  const all=splitSentences(text);
  const decisions=pick(all,/(dohod|domluv|rozhod|potvrd|schvál|souhlas|platí|bude\s|budeme\s)/i,5);
  const tasksRaw=pick(all,/(pošl|zašl|připrav|prověř|ověř|spočít|dopočít|dodá|zajistí|zjist|dopln|uděl|termín|deadline|do\s+\d)/i,6);
  const requests=pick(all,/(potřebujem|chceme|požad|očekáv|prosím|chtěl|zákazník|transparent|garanc|flexibil)/i,5);
  const hopi=pick(all,/(hopi|za nás|můžeme|nemůžeme|nabídn|naše stanovisko|z naší strany)/i,5);
  const risks=pick(all,/(rizik|problém|pokles|ztrát|zpožd|sankc|nedostatek|nevychází|nestíh|otevřen|nevíme|není potvrzen)/i,5);
  const follow=pick(all,/(příšt|další meeting|naváž|follow|ozv|pošl|potvrd|dořeš)/i,5);
  const important=uniq([...decisions,...tasksRaw,...requests,...all.filter(s=>s.length>55)]).slice(0,4);
  const executive=important.length?important.slice(0,2).join(' '):'Meeting byl zaznamenán. Lokální přepis zatím neobsahuje dostatek jednoznačných bodů pro kvalitní shrnutí.';
  const tasks=tasksRaw.map(t=>({task:t,owner:'',deadline:(t.match(/\b\d{1,2}[.\/]\s*\d{1,2}(?:[.\/]\s*\d{2,4})?/ )||[])[0]||''}));
  const recommendation=risks.length?'Před dalším krokem doporučuji potvrdit otevřené body a rizika a až poté uzavírat finální závazky.':'Doporučuji potvrdit vlastníky úkolů a termíny a poslat stručný follow-up všem účastníkům.';
  return {executive,decisions:decisions.length?decisions:['Bez jednoznačně zachyceného rozhodnutí.'],tasks,requests,hopi,risks,followup:follow.length?follow:['Potvrdit úkoly a termíny po meetingu.'],recommendation,source:all};
}

function renderSpeakers(){
  const samples=state.turns.length?state.turns:state.analysis.source.map((text,i)=>({text,time:i*15}));
  const list=$('speakerList');list.innerHTML='';
  for(let i=0;i<state.speakerCount;i++){
    const sample=samples[i]?.text||'Ukázka hlasu není v lokálním režimu spolehlivě dostupná.';
    const card=document.createElement('div');card.className='speaker-card';
    card.innerHTML=`<div class="speaker-row"><div class="speaker-avatar">${i+1}</div><div><div class="speaker-meta">Řečník ${i+1}</div><input class="speaker-name" data-index="${i}" value="${esc(state.names[i]||'')}" placeholder="Jméno, např. Roman"></div><div class="speaker-meta">${fmtTime(samples[i]?.time||0)}</div></div><p class="speaker-sample">„${esc(sample)}“</p>`;
    list.appendChild(card);
  }
  $('speakerCountLabel').textContent=`${state.speakerCount} ${state.speakerCount===1?'řečník':state.speakerCount<5?'řečníci':'řečníků'}`;
}
function collectNames(){document.querySelectorAll('.speaker-name').forEach(inp=>state.names[Number(inp.dataset.index)]=inp.value.trim()||`Řečník ${Number(inp.dataset.index)+1}`)}
function applySpeakers(){collectNames();showView('doneView')}

function renderBrief(){
  const a=state.analysis; if(!a)return;
  $('executiveSummary').textContent=a.executive;
  fillList('decisionsList',a.decisions);fillList('requestsList',a.requests);fillList('hopiList',a.hopi);fillList('risksList',a.risks);fillList('followupList',a.followup);
  $('recommendation').textContent=a.recommendation;
  const tt=$('tasksTable');tt.innerHTML='';
  if(!a.tasks.length)tt.innerHTML='<div class="task-row"><div>Bez konkrétního úkolu</div><div class="task-owner">—</div><div class="task-deadline">—</div></div>';
  a.tasks.forEach((t,i)=>{const row=document.createElement('div');row.className='task-row';const owner=t.owner||state.names[0]||'Doplnit';row.innerHTML=`<div>${esc(t.task)}</div><div class="task-owner">${esc(owner)}</div><div class="task-deadline">${esc(t.deadline||'doplnit')}</div>`;tt.appendChild(row)});
  const src=$('sourceTranscript');src.innerHTML='';
  if(state.turns.length){state.turns.forEach((t,i)=>{const d=document.createElement('div');d.className='source-block';d.innerHTML=`<b>${esc(state.names[i%state.speakerCount]||`Řečník ${(i%state.speakerCount)+1}`)} · ${fmtTime(t.time)}</b><p>${esc(t.text)}</p>`;src.appendChild(d)})}
  else a.source.forEach((t,i)=>{const d=document.createElement('div');d.className='source-block';d.innerHTML=`<b>Blok ${i+1}</b><p>${esc(t)}</p>`;src.appendChild(d)});
  saveCurrentMeeting();
  showView('briefView');
}
function fillList(id,items){const el=$(id);el.innerHTML='';(items?.length?items:['Bez zachycených bodů.']).forEach(x=>{const li=document.createElement('li');li.textContent=x;el.appendChild(li)})}

function plainSummary(){
  const a=state.analysis,name=$('meetingName').value.trim()||'Meeting';
  const out=[`${name} – Meeting Brief`,dateLabel(),'','HLAVNÍ ZÁVĚR',a.executive,''];
  const add=(title,arr)=>{if(arr?.length){out.push(title,...arr.map(x=>'• '+x),'')}};
  add('DOHODNUTO',a.decisions);
  if(a.tasks.length){out.push('ÚKOLY');a.tasks.forEach(t=>out.push(`• ${t.task} — ${t.owner||state.names[0]||'Doplnit'} — ${t.deadline||'doplnit'}`));out.push('')}
  add('POŽADAVKY ZÁKAZNÍKA',a.requests);add('POZICE HOPI',a.hopi);add('RIZIKA',a.risks);add('FOLLOW-UP',a.followup);
  return out.join('\n');
}
function customerEmail(){
  const a=state.analysis,name=$('meetingName').value.trim()||'Meeting';
  const out=['Dobrý den,','',`děkuji za dnešní jednání k tématu ${name}. Níže zasílám stručné shrnutí dohodnutých bodů:`,''];
  if(a.decisions.length){out.push('Dohodnuto:');a.decisions.forEach(x=>out.push('• '+x));out.push('')}
  if(a.tasks.length){out.push('Další kroky:');a.tasks.forEach(t=>out.push(`• ${t.task}${t.deadline?' – '+t.deadline:''}`));out.push('')}
  if(a.followup.length){out.push('Navazující témata:');a.followup.forEach(x=>out.push('• '+x));out.push('')}
  out.push('Děkuji a přeji hezký den.','','S pozdravem');return out.join('\n');
}
function openMail(){if(!state.analysis){toast('Nejdřív vytvoř shrnutí.');return}const to=$('emailTo').value.trim(),subject=`Shrnutí jednání – ${$('meetingName').value.trim()||'Meeting'}`;location.href=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(customerEmail())}`}
async function copySummary(){try{await navigator.clipboard.writeText(plainSummary());toast('Shrnutí zkopírováno.')}catch{toast('Kopírování se nepodařilo.')}}
async function shareSummary(){if(navigator.share){try{await navigator.share({title:$('meetingName').value.trim()||'Meeting Brief',text:plainSummary()})}catch{}}else copySummary()}

function history(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return[]}}
function saveCurrentMeeting(){
  const h=history(),id=state.currentId||String(Date.now());state.currentId=id;
  const item={id,name:$('meetingName').value.trim()||'Meeting',email:$('emailTo').value.trim(),date:Date.now(),analysis:state.analysis,names:state.names,speakerCount:state.speakerCount,turns:state.turns};
  const idx=h.findIndex(x=>x.id===id);if(idx>=0)h[idx]=item;else h.unshift(item);localStorage.setItem(STORAGE_KEY,JSON.stringify(h.slice(0,30)));renderHistory();
}
function renderHistory(){
  const h=history();$('historyCount').textContent=String(h.length);const box=$('meetingHistory');box.innerHTML='';
  if(!h.length){box.innerHTML='<div class="empty">Zatím tu nejsou žádné uložené meetingy.</div>';return}
  h.forEach(item=>{const c=document.createElement('div');c.className='history-card';c.innerHTML=`<div class="history-card-top"><h3>${esc(item.name)}</h3><small>${esc(dateLabel(item.date))}</small></div><p>${esc(item.analysis?.executive||'Meeting Brief')}</p>`;c.onclick=()=>loadHistoryItem(item);box.appendChild(c)})
}
function loadHistoryItem(item){resetMeeting();state.currentId=item.id;state.analysis=item.analysis;state.names=item.names||{};state.speakerCount=item.speakerCount||3;state.turns=item.turns||[];$('meetingName').value=item.name||'Meeting';$('emailTo').value=item.email||'';renderBrief()}

function startDemo(){
  resetMeeting();state.demo=true;state.speakerCount=3;$('meetingName').value='MINIT BOHEMIA';
  state.turns=[
    {time:72,text:'Od září očekáváme nižší objem přeprav a potřebujeme potvrdit, jak se to promítne do ceny.'},
    {time:115,text:'Za HOPI připravíme nový sjednocený ceník po potvrzení forecastu.'},
    {time:180,text:'Penny Dobřany a Smiřice vyhodnotíme samostatně, protože nejde o standardní multi-stop.'},
    {time:280,text:'MINIT dodá forecast do 13. 8. a HOPI připraví kalkulaci do 14. 8.'}
  ];
  state.transcript=state.turns.map(x=>x.text).join(' ');
  state.analysis={executive:'MINIT očekává nižší objem přeprav. Finální cenový model bude uzavřen až po potvrzení forecastu a samostatném vyhodnocení nestandardních tras.',decisions:['MINIT dodá forecast.','HOPI připraví nový sjednocený ceník.','Penny Dobřany + Smiřice se vyhodnotí samostatně.'],tasks:[{task:'Dodat forecast',owner:'David',deadline:'13. 8.'},{task:'Připravit kalkulaci',owner:'Roman',deadline:'14. 8.'},{task:'Vyhodnotit PD + SM',owner:'Josef',deadline:'15. 8.'}],requests:['Transparentní cenový model.','Garance kvality služeb.','Flexibilita při změně objemů.'],hopi:['Udržet dlouhodobé partnerství a nabídnout stabilní a konkurenceschopné řešení.'],risks:['Nižší objem může zhoršit ekonomiku distribučního modelu.'],followup:['Po potvrzení forecastu uzavřít cenu a provozní model.'],recommendation:'Neuzavírat finální cenový závazek před potvrzením forecastu. Nejprve objem → provozní model → závazek → cena.',source:state.turns.map(x=>x.text)};
  state.names={0:'David',1:'Roman',2:'Josef'};showView('processView');setTimeout(()=>{renderSpeakers();showView('speakersView')},700)
}

// UI events
$('startBtn').onclick=startMeeting;$('stopBtn').onclick=stopMeeting;$('demoBtn').onclick=startDemo;
$('addSpeakerBtn').onclick=()=>{collectNames();state.speakerCount=Math.min(6,state.speakerCount+1);renderSpeakers()};
$('removeSpeakerBtn').onclick=()=>{collectNames();state.speakerCount=Math.max(1,state.speakerCount-1);renderSpeakers()};
$('applySpeakersBtn').onclick=applySpeakers;$('showBriefBtn').onclick=renderBrief;$('quickMailBtn').onclick=()=>{renderBrief();setTimeout(openMail,50)};
$('briefBackBtn').onclick=()=>showView('doneView');$('emailBtn').onclick=openMail;$('copyBtn').onclick=copySummary;$('shareBtn').onclick=shareSummary;$('pdfBtn').onclick=()=>window.print();
$('settingsTopBtn').onclick=()=>showView('settingsView');$('clearHistoryBtn').onclick=()=>{if(confirm('Opravdu smazat historii meetingů v tomto zařízení?')){localStorage.removeItem(STORAGE_KEY);renderHistory();toast('Historie byla smazána.')}};
document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab==='summary'?'summaryTab':'sourceTab').classList.add('active')});

renderHistory();
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));