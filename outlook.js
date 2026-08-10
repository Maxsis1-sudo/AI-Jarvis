(() => {
  const emailBtn = document.getElementById('emailBtn');
  if (!emailBtn) return;

  emailBtn.textContent = '✉ OTEVŘÍT KONCEPT V OUTLOOKU';

  const style = document.createElement('style');
  style.textContent = `
    .outlook-modal{position:fixed;inset:0;z-index:1000;background:rgba(10,24,15,.58);backdrop-filter:blur(8px);display:grid;place-items:end center;padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom))}
    .outlook-modal.hidden{display:none!important}
    .outlook-sheet{width:min(680px,100%);max-height:min(84vh,820px);overflow:auto;background:#fff;border-radius:24px;border:1px solid #dfe7e1;box-shadow:0 24px 80px rgba(10,40,22,.24);padding:20px}
    .outlook-sheet-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:16px}
    .outlook-sheet-head h3{margin:2px 0 4px;font-size:22px;letter-spacing:-.4px}
    .outlook-sheet-head p{margin:0;color:#6b776f;font-size:12px;line-height:1.45}
    .outlook-close{border:0;background:#f0f5f2;color:#284032;width:36px;height:36px;border-radius:50%;font-size:20px;cursor:pointer}
    .outlook-safe{display:flex;gap:9px;align-items:flex-start;background:#eaf5ee;color:#245c38;border:1px solid #cee5d6;border-radius:14px;padding:11px 12px;font-size:12px;line-height:1.4;margin-bottom:14px}
    .outlook-form{display:grid;gap:11px}.outlook-form label{display:grid;gap:6px;font-size:11px;font-weight:850;color:#39443d}
    .outlook-form input,.outlook-form textarea{width:100%;border:1px solid #dfe7e1;border-radius:13px;background:#fbfcfb;padding:12px 13px;font:inherit;outline:none}
    .outlook-form input:focus,.outlook-form textarea:focus{border-color:#84bd99;box-shadow:0 0 0 4px rgba(0,132,61,.08)}
    .outlook-form textarea{min-height:270px;resize:vertical;line-height:1.52;font-size:13px}
    .outlook-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}
    .outlook-open,.outlook-copy{border:0;border-radius:14px;padding:14px;font:inherit;font-weight:900;cursor:pointer}
    .outlook-open{background:#00843d;color:#fff;grid-column:1/-1}.outlook-copy{background:#eef4f0;color:#284032}
    .outlook-hint{margin:11px 2px 0;color:#79847d;font-size:10px;line-height:1.45;text-align:center}
    @media(min-width:700px){.outlook-modal{place-items:center}.outlook-sheet{padding:24px}}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.id = 'outlookModal';
  modal.className = 'outlook-modal hidden';
  modal.innerHTML = `
    <section class="outlook-sheet" role="dialog" aria-modal="true" aria-labelledby="outlookTitle">
      <div class="outlook-sheet-head">
        <div>
          <div class="eyebrow">FOLLOW-UP E-MAIL</div>
          <h3 id="outlookTitle">Zkontroluj a otevři v Outlooku</h3>
          <p>Text můžeš ještě upravit. Nic se neodešle bez tvého potvrzení v Outlooku.</p>
        </div>
        <button id="outlookClose" class="outlook-close" aria-label="Zavřít">×</button>
      </div>
      <div class="outlook-safe"><span>✓</span><span><b>Zákaznická verze.</b> Interní AI doporučení, interní poznámky a skrytý přepis se do e-mailu nepřenášejí.</span></div>
      <div class="outlook-form">
        <label>Komu<input id="outlookTo" type="email" autocomplete="email" placeholder="zakaznik@firma.cz"></label>
        <label>Předmět<input id="outlookSubject" type="text"></label>
        <label>Text e-mailu<textarea id="outlookBody"></textarea></label>
      </div>
      <div class="outlook-actions">
        <button id="outlookOpen" class="outlook-open">OTEVŘÍT V OUTLOOKU →</button>
        <button id="outlookCopy" class="outlook-copy">Kopírovat text</button>
        <button id="outlookCancel" class="outlook-copy">Zrušit</button>
      </div>
      <div class="outlook-hint">Na iPhonu použije odkaz tvoji výchozí e-mailovou aplikaci. Pokud chceš vždy Outlook, nastav jej jako výchozí aplikaci pro e-mail.</div>
    </section>`;
  document.body.appendChild(modal);

  const $m = id => document.getElementById(id);

  function fillDraft(){
    const name = document.getElementById('meetingName')?.value.trim() || 'Meeting';
    const to = document.getElementById('emailTo')?.value.trim() || '';
    const body = typeof window.buildCustomerEmail === 'function'
      ? window.buildCustomerEmail()
      : (document.getElementById('summary')?.dataset.plain || '');
    $m('outlookTo').value = to;
    $m('outlookSubject').value = `Shrnutí jednání – ${name}`;
    $m('outlookBody').value = body;
  }

  function openModal(){
    fillDraft();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $m('outlookBody')?.focus(), 80);
  }

  function closeModal(){
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function openInOutlook(){
    const to = $m('outlookTo').value.trim();
    const subject = $m('outlookSubject').value.trim();
    const body = $m('outlookBody').value;
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  }

  async function copyBody(){
    try{
      await navigator.clipboard.writeText($m('outlookBody').value);
      if (typeof window.toast === 'function') window.toast('Text e-mailu zkopírován.');
      else alert('Text e-mailu byl zkopírován.');
    } catch {
      $m('outlookBody').select();
      document.execCommand?.('copy');
    }
  }

  emailBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openModal();
  }, true);

  $m('outlookClose').addEventListener('click', closeModal);
  $m('outlookCancel').addEventListener('click', closeModal);
  $m('outlookOpen').addEventListener('click', openInOutlook);
  $m('outlookCopy').addEventListener('click', copyBody);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });
})();