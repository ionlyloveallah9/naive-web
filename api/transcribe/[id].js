// Vercel Serverless Function: GET /api/transcribe/:id
// Polls the status of a transcription job

const AAI = 'https://api.assemblyai.com/v2';
const STT_LANGS = { en: 'English', ur: 'Urdu', hi: 'Hindi', ar: 'Arabic' };
const STT_CONF_OK = 0.75;
const STT_DET_MIN = 0.6;
const STT_SCRIPT = {
  en: [/[A-Za-z]/g, 0.7],
  ur: [/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g, 0.6],
  ar: [/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g, 0.6],
  hi: [/[\u0900-\u097F]/g, 0.4],
};

function aaiKey() { return (process.env.ASSEMBLYAI_API_KEY || '').trim(); }

async function aaiJson(r) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(t.slice(0, 200) || 'Bad response from AssemblyAI'); }
}

function scriptOk(text, lang) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters < 8) return true;
  const [re, min] = STT_SCRIPT[lang] || STT_SCRIPT.en;
  return (text.match(re) || []).length / letters >= min;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  // Immediate ElevenLabs results (returned with a special shape from POST)
  // The frontend may already have received _immediate, but we still handle cleanly.
  if (String(id).startsWith('el_')) {
    // Frontend should have already taken the immediate result.
    // If it still polls, tell it the job is gone.
    return res.status(410).json({ status: 'error', code: 'expired', error: 'This English transcription already finished. Please start a new one if needed.' });
  }

  try {
    const key = aaiKey();
    if (!key) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY is not configured.' });

    const j = await aaiJson(await fetch(AAI + '/transcript/' + id, {
      headers: { authorization: key },
    }));

    if (j.status === 'error') {
      const m = String(j.error || '');
      const silent = /no spoken audio|no speech/i.test(m);
      return res.json({
        status: 'error',
        code: silent ? 'no_speech' : 'failed',
        error: silent ? 'No speech was found in this audio.' : (m || 'AssemblyAI could not transcribe this audio.'),
      });
    }

    if (j.status !== 'completed') {
      return res.json({ status: j.status || 'processing', stage: 'forced' });
    }

    const text = String(j.text || '').trim();
    const conf = Number(j.confidence) || 0;
    const lang = j.language_code || 'en';

    if (!text) {
      return res.json({ status: 'error', code: 'no_speech', error: 'No speech was found in this audio.' });
    }

    // Basic script check (best-effort; original had more sophisticated language detection)
    if (STT_LANGS[lang] && !scriptOk(text, lang)) {
      return res.json({
        status: 'error',
        code: 'wrong_language',
        error: 'This audio does not seem to be in ' + (STT_LANGS[lang] || lang) + '. Please choose the language that is spoken in the recording.',
      });
    }

    return res.json({
      status: 'completed',
      text,
      confidence: conf,
      language: lang,
    });
  } catch (e) {
    console.error('transcribe poll:', e);
    return res.status(500).json({ error: e.message || 'Could not read transcription status.' });
  }
}
