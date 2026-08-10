# HOPI Meeting Assistant

Web/PWA aplikace pro iPhone a desktop: meeting → rozpoznání řečníků → pojmenování → stručný KAM brief → follow-up e-mail.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Maxsis1-sudo/AI-Jarvis)

## Co umí frontend

1. Nahraje audio z meetingu.
2. V demo/lokálním režimu umí kontrolní živý přepis.
3. Po AI zpracování zobrazí Řečník 1, 2, 3… a umožní doplnit jména.
4. Místo stenozáznamu ukáže pouze: hlavní závěr, rozhodnutí, úkoly/owner/deadline, požadavky zákazníka, pozici HOPI, rizika, důležitá čísla, follow-up a interní AI doporučení.
5. Připraví zákaznicky bezpečný follow-up e-mail bez interní AI poznámky.
6. Lze přidat na plochu iPhonu jako PWA.

## Demo

GitHub Pages slouží jako okamžitě použitelný demo/lokální režim. Na první obrazovce použij **Vyzkoušet demo MINIT**. Bez AI backendu není skutečné rozlišení více řečníků aktivní.

## Produkční AI režim

Repozitář obsahuje `render.yaml`, který nasadí frontend i backend jako jednu Render web service.

### Nejrychlejší nasazení

1. Klikni na **Deploy to Render** nahoře.
2. Přihlas se do Renderu a povol přístup k repozitáři `Maxsis1-sudo/AI-Jarvis`, pokud o něj Render požádá.
3. Render načte `render.yaml` a zobrazí web service `hopi-meeting-assistant`.
4. Do tajné proměnné `OPENAI_API_KEY` vlož vlastní OpenAI API secret key. Klíč nikomu neposílej a nikdy ho neukládej do GitHubu.
5. Spusť deployment.
6. Po dokončení otevři přidělenou `.onrender.com` adresu. Endpoint `/health` musí vrátit `aiConfigured: true`.
7. Proveď krátký test se dvěma řečníky a ověř: Řečník 1/2 → pojmenování → meeting brief.

Po nasazení Render verze frontend automaticky používá AI API na stejné doméně. Není potřeba ručně nastavovat URL backendu.

### AI pipeline

- audio: `gpt-4o-transcribe-diarize`
- response: `diarized_json` s časovými segmenty a speaker labels
- delší audio: `chunking_strategy: auto`
- shrnutí: `gpt-5-mini`
- server vrací speaker segments + strukturovaný JSON meeting brief

Backend má health endpoint `/health`, omezení velikosti uploadu a základní hodinový rate limit.

## OpenAI API

ChatGPT Plus a OpenAI API mají oddělené účtování. Pro produkční AI režim je potřeba aktivní API účet s vlastním API klíčem a API billingem.

## Bezpečnost

`.env` a lokální závislosti jsou ignorované přes `.gitignore`. API klíč patří pouze do bezpečné serverové environment variable.

> Před nahráváním informuj účastníky a postupuj podle firemních pravidel a platných předpisů.
