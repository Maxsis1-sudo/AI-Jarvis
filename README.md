# HOPI Meeting Assistant

Web/PWA prototype for iPhone and desktop.

## Flow

1. Start the meeting and record audio.
2. A diarization-ready backend can return `Speaker 1`, `Speaker 2`, etc.
3. The user renames speakers after the meeting.
4. The app shows only a concise management brief instead of a word-for-word transcript.
5. Output includes decisions, tasks/owner/deadline, customer requests, HOPI position, risks, key numbers, follow-up and an internal AI recommendation.
6. A customer-safe follow-up email can be opened from the summary.

## Demo

Use **Vyzkoušet demo MINIT** on the first screen. It demonstrates the intended three-speaker workflow without requiring a backend.

## AI backend

`config.js` intentionally contains no API key. GitHub Pages is a static frontend and must never expose a private AI key. Set `window.HOPI_CONFIG.apiUrl` only after deploying a secure backend that accepts an audio file on `POST /process-meeting` and returns speaker segments plus a structured summary.

Without a configured backend the application still records audio and can use the browser's local speech recognition as a fallback, but it cannot genuinely distinguish multiple speakers.

## PWA

The project contains a web app manifest and service worker, so after publishing over HTTPS it can be added to the iPhone Home Screen from Safari.

> Before recording, inform meeting participants and follow company policy and applicable rules.
