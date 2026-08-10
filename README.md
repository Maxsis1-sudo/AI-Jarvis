# HOPI Meeting Listener

Webová/PWA verze meeting asistenta optimalizovaná pro iPhone i desktop.

## Jak funguje

1. Zadej zákazníka / název meetingu a e-mail pro zápis.
2. Spusť meeting a povol mikrofon.
3. Aplikace průběžně zachytává audio a – pokud to prohlížeč podporuje – vytváří český živý přepis.
4. Po ukončení vytvoří strukturovaný zápis: shrnutí, rozhodnutí, úkoly a otevřené body.
5. Zápis lze poslat přes předvyplněný e-mail, sdílet nebo kopírovat.

## PWA

Projekt obsahuje `manifest.webmanifest` a `sw.js`, takže jej lze po publikování přes HTTPS přidat na plochu iPhonu jako webovou aplikaci.

## GitHub Pages

Publikuj obsah větve `main` z kořene repozitáře přes GitHub Pages. Výsledná adresa bude typicky:

`https://maxsis1-sudo.github.io/AI-Jarvis/`

## Důležité omezení MVP

Živý speech-to-text závisí na podpoře Web Speech API v konkrétním prohlížeči. Audio záznam používá `MediaRecorder`. Pro spolehlivý přepis dlouhých meetingů, AI sumarizaci a skutečné automatické odeslání e-mailu je vhodné v další verzi přidat zabezpečený backend/transkripční API.

> Před nahráváním informuj účastníky a postupuj podle firemních pravidel a platných předpisů.

Původní SwiftUI prototyp zůstává v repozitáři jako alternativní nativní varianta.