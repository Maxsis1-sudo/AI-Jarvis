# HOPI Meeting Assistant

Web/PWA aplikace pro iPhone a desktop: meeting → rozpoznání řečníků → pojmenování → stručný KAM brief → follow-up e-mail.

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

Při vytvoření Render Blueprintu stačí zadat jediný tajný údaj:

- `OPENAI_API_KEY`

Klíč se nikdy neukládá do GitHubu ani do frontendu.

Po nasazení Render verze frontend automaticky používá AI API na stejné doméně. Není potřeba ručně nastavovat URL backendu.

### AI pipeline

- audio: `gpt-4o-transcribe-diarize`
- response: `diarized_json` s časovými segmenty a speaker labels
- delší audio: `chunking_strategy: auto`
- shrnutí: `gpt-5-mini`
- server vrací speaker segments + strukturovaný JSON meeting brief

Backend má health endpoint `/health`, omezení velikosti uploadu a základní hodinový rate limit.

## Bezpečnost

`.env` a lokální závislosti jsou ignorované přes `.gitignore`. API klíč patří pouze do bezpečné serverové environment variable.

> Před nahráváním informuj účastníky a postupuj podle firemních pravidel a platných předpisů.
