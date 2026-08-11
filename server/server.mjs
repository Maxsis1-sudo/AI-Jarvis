import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { File } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = process.env.PORT || 8787;
const summaryModel = process.env.SUMMARY_MODEL || 'gpt-5-mini';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const githubPagesOrigin = 'https://maxsis1-sudo.github.io';

let openaiClient = null;
function getOpenAIClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('Zpracování není nakonfigurované.');
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey,
      timeout: 240000,
      maxRetries: 1
    });
  }
  return openaiClient;
}

if (!process.env.OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY is not set yet. Server will start, but meeting processing is disabled.');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 }
});

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const parsed = new URL(origin);
    const sameHost = parsed.host === req.headers.host;
    const allowedGithub = origin === githubPagesOrigin;
    if (!sameHost && !allowedGithub) return res.status(403).json({ error: 'Origin is not allowed.' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  } catch {
    return res.status(403).json({ error: 'Invalid origin.' });
  }
});

app.use(express.json({ limit: '1mb' }));

const rateBuckets = new Map();
const rateLimitPerHour = Number(process.env.RATE_LIMIT_PER_HOUR || 20);
function meetingRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt > hour) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > rateLimitPerHour) {
    return res.status(429).json({ error: 'Příliš mnoho zpracování za hodinu. Zkus to později.' });
  }
  next();
}

app.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'HOPI Meeting Assistant',
    version: 'production-v2-concise-brief',
    aiConfigured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    summaryModel
  });
});

app.post('/process-meeting', meetingRateLimit, (req, res, next) => {
  upload.single('audio')(req, res, err => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Nahrávka je příliš velká. Zkus kratší meeting.' });
    }
    if (err) return res.status(400).json({ error: 'Nahrávku se nepodařilo načíst.' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chybí audio nahrávka.' });

    const client = getOpenAIClient();
    const filename = req.file.originalname || 'meeting.webm';
    const mime = req.file.mimetype || 'audio/webm';
    const audioFile = new File([req.file.buffer], filename, { type: mime });

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: 'gpt-4o-transcribe-diarize',
      response_format: 'diarized_json',
      chunking_strategy: 'auto',
      language: req.body.language || 'cs'
    });

    const rawSegments = Array.isArray(transcription.segments) ? transcription.segments : [];
    if (!rawSegments.length) {
      return res.status(422).json({ error: 'Z nahrávky se nepodařilo získat přepis s řečníky.' });
    }

    const speakerOrder = [];
    for (const segment of rawSegments) {
      const label = String(segment.speaker || 'A');
      if (!speakerOrder.includes(label)) speakerOrder.push(label);
    }

    const speakerMap = Object.fromEntries(speakerOrder.map((label, index) => [label, `speaker_${index + 1}`]));

    const segments = rawSegments.map(segment => ({
      speakerId: speakerMap[String(segment.speaker || 'A')],
      start: Number(segment.start || 0),
      end: Number(segment.end || 0),
      text: String(segment.text || '').trim()
    })).filter(segment => segment.text);

    const speakers = speakerOrder.map((rawLabel, index) => {
      const id = speakerMap[rawLabel];
      const owned = segments.filter(segment => segment.speakerId === id);
      const seconds = owned.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
      const quote = owned.find(segment => segment.text.length >= 25)?.text || owned[0]?.text || '';
      return { id, label: `Řečník ${index + 1}`, seconds, quote };
    });

    const transcriptForSummary = segments.map(segment =>
      `[${segment.speakerId}] ${formatTime(segment.start)} ${segment.text}`
    ).join('\n');

    const meetingName = String(req.body.meetingName || 'Meeting').slice(0, 200);
    const summary = await summarizeMeeting({
      client,
      meetingName,
      transcriptForSummary,
      speakerIds: speakers.map(s => s.id)
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      duration: Number(transcription.duration || 0),
      speakers,
      segments,
      summary
    });
  } catch (error) {
    console.error('Meeting processing failed:', error);
    const status = error?.status === 429 ? 429 : error?.status === 401 ? 503 : 500;
    const message = status === 429
      ? 'Byl dosažen dočasný limit zpracování. Zkus to za chvíli znovu.'
      : status === 503
        ? 'Zpracování není momentálně dostupné.'
        : 'Meeting se nepodařilo zpracovat. Zkus požadavek zopakovat.';
    res.status(status).json({ error: message });
  }
});

async function summarizeMeeting({ client, meetingName, transcriptForSummary, speakerIds }) {
  const instructions = `
Jsi seniorní KAM meeting assistant pro logistickou společnost HOPI.
Tvým úkolem je UDĚLAT Z PŘEPISU STRUČNÝ MANAŽERSKÝ BRIEF, nikoliv přepis zopakovat.

NEJDŮLEŽITĚJŠÍ PRAVIDLO:
- Nikdy nekopíruj celé věty nebo dlouhé pasáže z přepisu.
- Každý bod přeformuluj do krátkého významového shrnutí.
- Odstraň výplňová slova, opakování, váhání, zdvořilostní fráze a konverzační omáčku.
- Zachovej pouze fakta, rozhodnutí, požadavky, čísla, rizika a konkrétní další kroky.
- Pokud jedna dlouhá replika obsahuje více myšlenek, rozděl je na několik krátkých bodů.
- Pokud se stejná věc opakuje, uveď ji jen jednou.
- Nic nevymýšlej. Pokud něco nebylo řečeno, nepřidávej to.

PŘÍKLAD transformace:
Přepis: "Chtěl jsem se zeptat, jestli souhlasíte s cenou 15 000 za Cerhovice a 16 000 za Buštěhrad, nebo jestli máte jinou cenu od konkurence."
Správný bod: "Navržená cena: Cerhovice 15 000 Kč, Buštěhrad 16 000 Kč."
Další správný bod: "Ověřit konkurenceschopnost navržených sazeb."
Špatně: zopakovat celou původní větu.

Přesná pravidla délky:
- executive: maximálně 2 krátké věty, dohromady do 220 znaků.
- decisions: max 5 bodů, každý ideálně 4–12 slov, max 120 znaků.
- tasks: max 6 úkolů; task jako krátká akce, max 100 znaků.
- customerRequests, hopiPosition, risks, numbers, followUp: max 5 bodů v každé sekci, každý max 120 znaků.
- recommendation: maximálně 2 krátké věty, max 220 znaků.

Obsah sekcí:
- executive = o čem meeting byl a kam se posunul; ne seznam všeho.
- decisions = skutečně dohodnuté závěry, ne otázky a ne návrhy bez potvrzení.
- tasks = konkrétní další akce; owner jako speakerId pouze pokud je jasné, kdo úkol převzal.
- customerRequests = co zákazník skutečně chce nebo požaduje.
- hopiPosition = co HOPI potvrdilo, navrhlo, odmítlo nebo podmínilo.
- risks = otevřené problémy, nejasnosti, obchodní či provozní rizika.
- numbers = důležité ceny, procenta, objemy, palety, LKW, termíny, SLA.
- followUp = co je potřeba potvrdit nebo dořešit po meetingu.
- recommendation = pouze interní doporučení pro KAM HOPI; zákazník ho neuvidí.

Zachovej reference na řečníky přesně jako ${speakerIds.join(', ')}.
U task.owner použij speakerId jen pokud je z přepisu jasný vlastník. Jinak použij prázdný řetězec.

Vrať POUZE validní JSON bez markdownu:
{
  "executive": "stručný manažerský závěr",
  "decisions": ["krátký bod"],
  "tasks": [{"task":"krátká akce","owner":"speaker_1","deadline":"termín nebo prázdné"}],
  "customerRequests": ["krátký bod"],
  "hopiPosition": ["krátký bod"],
  "risks": ["krátký bod"],
  "numbers": ["krátký bod"],
  "followUp": ["krátký bod"],
  "recommendation": "stručné interní doporučení"
}`;

  const response = await client.responses.create({
    model: summaryModel,
    store: false,
    instructions,
    input: `Meeting: ${meetingName}\n\nPŘEPIS PODLE ŘEČNÍKŮ:\n${transcriptForSummary}\n\nZnovu: NEOPISUJ přepis. Vytáhni význam a přepiš ho do stručných manažerských bodů.`
  });

  return normalizeSummary(parseJsonObject(response.output_text || ''));
}

function normalizeSummary(summary) {
  const list = (value, maxItems = 5, maxChars = 120) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
      const compact = compactText(item, maxChars);
      if (!compact) continue;
      const key = compact.toLocaleLowerCase('cs-CZ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(compact);
      if (out.length >= maxItems) break;
    }
    return out;
  };

  const tasks = Array.isArray(summary?.tasks)
    ? summary.tasks.slice(0, 6).map(task => ({
        task: compactText(task?.task, 100),
        owner: String(task?.owner || '').trim(),
        deadline: compactText(task?.deadline, 40)
      })).filter(task => task.task)
    : [];

  return {
    executive: compactText(summary?.executive, 220),
    decisions: list(summary?.decisions),
    tasks,
    customerRequests: list(summary?.customerRequests),
    hopiPosition: list(summary?.hopiPosition),
    risks: list(summary?.risks),
    numbers: list(summary?.numbers),
    followUp: list(summary?.followUp),
    recommendation: compactText(summary?.recommendation, 220)
  };
}

function compactText(value, maxChars) {
  let text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[•\-–—\s]+/, '')
    .trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars + 1);
  const lastSpace = sliced.lastIndexOf(' ');
  text = sliced.slice(0, lastSpace > maxChars * 0.65 ? lastSpace : maxChars).trim();
  return `${text.replace(/[,:;\-–—]+$/, '')}…`;
}

function parseJsonObject(text) {
  const clean = String(text).trim();
  try { return JSON.parse(clean); } catch {}
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1));
  throw new Error('Summary model did not return valid JSON.');
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

app.use(express.static(publicDir, {
  extensions: ['html'],
  maxAge: '1h'
}));

app.listen(port, '0.0.0.0', () => {
  console.log(`HOPI Meeting Assistant listening on port ${port}`);
  console.log(`AI configured: ${Boolean(String(process.env.OPENAI_API_KEY || '').trim())}`);
});
