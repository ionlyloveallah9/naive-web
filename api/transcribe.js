// Vercel Serverless Function: POST /api/transcribe
// Starts a transcription job (ElevenLabs for English, AssemblyAI for ur/hi/ar)

const AAI = 'https://api.assemblyai.com/v2';
const EL = 'https://api.elevenlabs.io/v1/speech-to-text';
const AAI_MAX = 200 * 1024 * 1024;
const EL_MODELS = [process.env.ELEVENLABS_STT_MODEL || 'scribe_v2', 'scribe_v1'];
const STT_LANGS = { en: 'English', ur: 'Urdu', hi: 'Hindi', ar: 'Arabic' };
const NOKEY = /^(YOUR_|xxx|test)/i;

function elKey() { return (process.env.ELEVENLABS_API_KEY || '').trim(); }
function aaiKey() { return (process.env.ASSEMBLYAI_API_KEY || '').trim(); }

async function aaiJson(r) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(t.slice(0, 200) || 'Bad response from AssemblyAI'); }
}

export const config = {
  api: {
    bodyParser: false, // we need the raw body
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const lang = String(req.query.lang || 'en').toLowerCase();
    if (!STT_LANGS[lang]) {
      return res.status(400).json({ error: 'Please choose English, Urdu, Hindi or Arabic.' });
    }

    const english = lang === 'en';
    if (english ? (!elKey() || NOKEY.test(elKey())) : (!aaiKey() || NOKEY.test(aaiKey()))) {
      return res.status(500).json({
        error: english
          ? 'English Speech to Text is not set up yet. Add ELEVENLABS_API_KEY in Vercel Environment Variables.'
          : 'Urdu / Hindi / Arabic Speech to Text is not set up yet. Add ASSEMBLYAI_API_KEY in Vercel Environment Variables.',
      });
    }

    const body = await readRawBody(req);
    if (!body || !body.length) {
      return res.status(400).json({ error: 'No audio file was uploaded.' });
    }
    if (body.length > AAI_MAX) {
      return res.status(413).json({ error: 'That file is too large (200 MB maximum).' });
    }

    const force = req.query.force === '1';
    const name = decodeURIComponent(String(req.query.name || 'audio')).slice(0, 120);

    if (english) {
      // ElevenLabs – try models until one works
      let lastErr = 'ElevenLabs request failed';
      for (const model of EL_MODELS) {
        try {
          const fd = new FormData();
          fd.append('file', new Blob([body], { type: req.headers['content-type'] || 'audio/wav' }), name);
          fd.append('model_id', model);
          fd.append('language_code', 'en');

          const r = await fetch(EL, {
            method: 'POST',
            headers: { 'xi-api-key': elKey() },
            body: fd,
          });

          const j = await r.json().catch(() => ({}));
          if (r.status === 401) {
            return res.status(500).json({ error: 'ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY.' });
          }
          if (!r.ok) {
            lastErr = j.detail?.message || j.message || `ElevenLabs HTTP ${r.status}`;
            if (/unknown model|model_id/i.test(lastErr)) continue; // try next model
            return res.status(500).json({ error: lastErr });
          }

          const text = String(j.text || '').trim();
          const conf = Number(j.language_probability ?? j.confidence ?? 0.9);
          // Return a synthetic completed id so the frontend polling still works
          const id = 'el_' + globalThis.crypto.randomUUID();
          // We store nothing server-side; we just return the result immediately via a special response shape
          // The frontend expects { id } then polls. To keep the same UX we return the result in a way the poll can also understand.
          // Simpler: return completed immediately by using a special id prefix that the GET handler recognizes.
          return res.status(200).json({
            id,
            _immediate: true,
            status: 'completed',
            text,
            confidence: conf,
            language: 'en',
          });
        } catch (e) {
          lastErr = e.message;
        }
      }
      return res.status(500).json({ error: lastErr });
    }

    // AssemblyAI path
    const key = aaiKey();

    // Upload
    const up = await aaiJson(await fetch(AAI + '/upload', {
      method: 'POST',
      headers: { authorization: key, 'content-type': 'application/octet-stream' },
      body,
    }));
    if (!up.upload_url) throw new Error('Could not upload audio to AssemblyAI.');

    // Start forced-language transcription
    const job = await aaiJson(await fetch(AAI + '/transcript', {
      method: 'POST',
      headers: { authorization: key, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: up.upload_url,
        language_code: lang,
        speech_models: ['universal-2'],
      }),
    }));

    if (!job.id) throw new Error('Could not create the transcription job.');

    // Return the AssemblyAI id. Frontend will poll /api/transcribe/:id
    return res.status(200).json({ id: job.id, engine: 'aai', lang, force: force ? 1 : 0 });
  } catch (e) {
    console.error('transcribe:', e);
    return res.status(500).json({ error: e.message || 'Unexpected server error.' });
  }
}
