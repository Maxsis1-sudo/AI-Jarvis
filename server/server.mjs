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
  if (!openaiClient) openaiClient = new OpenAI({ apiKey, timeout: 240000, maxRetries: 1 });
  return openaiClient;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 1 } });
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
    next();
  } catch {
    res.status(403).json({ error: 'Invalid origin.' });
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
  if (current.count > rateLimitPerHour) return res.status(429).json({ error: 'Příliš mnoho zpracování za hodinu. Zkus to později.' });
  next();
}

app.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, service: 'HOPI Meeting Assistant', version: 'kam-copilot-v1', aiConfigured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()), summaryModel });
});

app.post('/process-meeting', meetingRateLimit, (req, res, next) => {
  upload.single('audio')(req, res, err => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Nahrávka je příliš velká. Zkus kratší meeting.' });
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
      model: 'gpt-4o-transcribe',
      language: req.body.language || 'cs'
    });

    const transcript = String(transcription.text || '').trim();
    if (!transcript) return res.status(422).json({ error: 'Z nahrávky se nepodařilo získat přepis.' });

    const customer = compactText(req.body.customer || '', 120);
    const previousContext = parseOptionalJson(req.body.previousContext);
    const markers = parseOptionalJson(req.body.markers);
    const summary = await summarizeMeeting({ client, customer, transcript, previousContext, markers });

    res.setHeader('Cache-Control', 'no-store');
    res.json({ transcript, summary });
  } catch (error) {
    console.error('Meeting processing failed:', error);
    const status = error?.status === 429 ? 429 : error?.status === 401 ? 503 : 500;
    const message = status === 429 ? 'Byl dosažen dočasný limit zpracování. Zkus to za chvíli znovu.' : status === 503 ? 'Zpracování není momentálně dostupné.' : 'Meeting se nepodařilo zpracovat. Zkus požadavek zopakovat.';
    res.status(status).json({ error: message });
  }
});

async function summarizeMeeting({ client, customer, transcript, previousContext, markers }) {
  const previousText = previousContext ? JSON.stringify(previousContext) : 'Není k dispozici.';
  const markerText = Array.isArray(markers) && markers.length ? markers.map(x => `${x}s`).join(', ') : 'Žádné.';
  const instructions = `
Jsi seniorní KAM copilot pro logistickou společnost HOPI. Z přepisu vytvoř manažerský brief v češtině.

ZÁSADNÍ PRAVIDLA:
- Nikdy neopisuj celé věty z přepisu. Vždy zkrať význam do krátkých bodů.
- Odstraň výplňová slova, opakování, váhání a zdvořilostní fráze.
- Nic nevymýšlej. Nejasné vlastníky a termíny nech prázdné.
- Nepokoušej se rozpoznávat řečníky podle hlasu.
- Jméno osoby použij pouze pokud bylo výslovně řečeno v textu.
- Každý bod max 120 znaků; executive a recommendation max 220 znaků.
- Otevřené body nejsou totéž co rozhodnutí: patří sem věci bez finální shody nebo čekající na potvrzení.
- "myPromises" jsou pouze závazky HOPI / naše strana / já jako KAM. Pokud to není jasné, nedávej je tam.
- Úkoly označ side pouze HOPI, CUSTOMER nebo UNKNOWN.
- Pokud je dostupný minulý meeting stejného zákazníka, changes shrň pouze skutečné změny oproti minulému stavu.
- Časové značky "Důležité" znamenají, že uživatel během nahrávání označil okolí této části za prioritní; zvýrazni tamní fakta, pokud jsou v přepisu dohledatelná.

Vrať POUZE validní JSON:
{
  "title": "automatický stručný název meetingu",
  "executive": "hlavní závěr max 2 krátké věty",
  "decisions": ["dohodnutý bod"],
  "openPoints": ["otevřený bod"],
  "tasks": [{"task":"akce","owner":"jméno nebo prázdné","deadline":"termín nebo prázdné","side":"HOPI|CUSTOMER|UNKNOWN"}],
  "myPromises": ["co HOPI / KAM slíbil"],
  "customerRequests": ["požadavek zákazníka"],
  "hopiPosition": ["stanovisko HOPI"],
  "risks": ["riziko"],
  "numbers": ["důležité číslo s kontextem"],
  "followUp": ["následující krok"],
  "changes": ["co se změnilo oproti minulému meetingu"],
  "recommendation": "interní doporučení pro KAM"
}`;

  const response = await client.responses.create({
    model: summaryModel,
    store: false,
    instructions,
    input: `Zákazník: ${customer || 'neuveden'}\n\nPŘEPIS:\n${transcript}\n\nMINULÝ MEETING STEJNÉHO ZÁKAZNÍKA:\n${previousText}\n\nOZNAČENÉ DŮLEŽITÉ ČASY:\n${markerText}`
  });
  return normalizeSummary(parseJsonObject(response.output_text || ''));
}

function normalizeSummary(summary) {
  const list = (value, maxItems = 6, maxChars = 120) => {
    if (!Array.isArray(value)) return [];
    const out = []; const seen = new Set();
    for (const item of value) {
      const text = compactText(item, maxChars);
      if (!text) continue;
      const key = text.toLocaleLowerCase('cs-CZ');
      if (seen.has(key)) continue;
      seen.add(key); out.push(text);
      if (out.length >= maxItems) break;
    }
    return out;
  };
  const tasks = Array.isArray(summary?.tasks) ? summary.tasks.slice(0, 8).map(t => ({
    task: compactText(t?.task, 100), owner: compactText(t?.owner, 50), deadline: compactText(t?.deadline, 40), side: ['HOPI','CUSTOMER','UNKNOWN'].includes(String(t?.side)) ? String(t.side) : 'UNKNOWN'
  })).filter(t => t.task) : [];
  return {
    title: compactText(summary?.title, 90) || 'Meeting',
    executive: compactText(summary?.executive, 220),
    decisions: list(summary?.decisions),
    openPoints: list(summary?.openPoints),
    tasks,
    myPromises: list(summary?.myPromises),
    customerRequests: list(summary?.customerRequests),
    hopiPosition: list(summary?.hopiPosition),
    risks: list(summary?.risks),
    numbers: list(summary?.numbers),
    followUp: list(summary?.followUp),
    changes: list(summary?.changes),
    recommendation: compactText(summary?.recommendation, 220)
  };
}

function compactText(value, maxChars) {
  let text = String(value || '').replace(/\s+/g, ' ').replace(/^[•\-–—\s]+/, '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars + 1); const lastSpace = sliced.lastIndexOf(' ');
  text = sliced.slice(0, lastSpace > maxChars * 0.65 ? lastSpace : maxChars).trim();
  return `${text.replace(/[,:;\-–—]+$/, '')}…`;
}
function parseJsonObject(text) {
  const clean = String(text).trim();
  try { return JSON.parse(clean); } catch {}
  const first = clean.indexOf('{'); const last = clean.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1));
  throw new Error('Summary model did not return valid JSON.');
}
function parseOptionalJson(value) { try { return value ? JSON.parse(value) : null; } catch { return null; } }

app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));
app.listen(port, '0.0.0.0', () => console.log(`HOPI Meeting Assistant listening on port ${port}`));
