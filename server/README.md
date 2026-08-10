# HOPI Meeting Assistant API

This server turns a recorded meeting into speaker-labelled segments and a concise management brief.

## Environment variables

- `OPENAI_API_KEY` – required, server-side only.
- `ALLOWED_ORIGIN` – recommended; set it to the GitHub Pages URL.
- `SUMMARY_MODEL` – optional, defaults to `gpt-5-mini`.
- `PORT` – optional.

## Run locally

```bash
npm install
OPENAI_API_KEY=... npm start
```

## Endpoint

`POST /process-meeting`

Multipart form fields:
- `audio` – meeting audio file.
- `meetingName` – customer / meeting name.
- `language` – defaults to `cs`.

The server uses OpenAI diarized transcription and then creates a concise structured summary. It returns:

```json
{
  "speakers": [{"id":"speaker_1","label":"Řečník 1","seconds":120,"quote":"..."}],
  "segments": [{"speakerId":"speaker_1","start":0,"end":10,"text":"..."}],
  "summary": {
    "executive":"...",
    "decisions":[],
    "tasks":[{"task":"...","owner":"speaker_1","deadline":"..."}],
    "customerRequests":[],
    "hopiPosition":[],
    "risks":[],
    "numbers":[],
    "followUp":[],
    "recommendation":"..."
  }
}
```

After deployment, set the public backend URL in the root `config.js`. Never put `OPENAI_API_KEY` in `config.js`, GitHub Pages, or browser JavaScript.
