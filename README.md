# Naive Frontend + Speech-to-Text (Vercel)

Static frontend + Speech-to-Text API routes.

The heavy video downloader lives on **Railway**.

## Deploy on Vercel

1. Push this folder to a GitHub repo.
2. Go to [vercel.com](https://vercel.com) → New Project → Import the repo.
3. Framework Preset: **Other** (or leave blank).
4. Root Directory: leave as the root of this folder (or set it if this is a monorepo subfolder).
5. Add Environment Variables:

| Name | Value |
|------|-------|
| `ELEVENLABS_API_KEY` | your ElevenLabs key |
| `ASSEMBLYAI_API_KEY` | your AssemblyAI key |

6. Deploy.

After deploy you will get a URL like `https://naive-xxx.vercel.app`.

## Connect to the Railway Downloader

After you deploy the downloader on Railway, open the browser console on your Vercel site and run:

```js
localStorage.setItem('naive.downloaderUrl', 'https://your-downloader.up.railway.app');
location.reload();
```

Or hard-code it by editing `public/index.html` and changing:

```js
const DOWNLOADER_URL = (window.NAIVE_DOWNLOADER_URL || localStorage.getItem('naive.downloaderUrl') || '').replace(/\/$/, '');
```

to:

```js
const DOWNLOADER_URL = 'https://your-downloader.up.railway.app';
```

## Local development

```bash
npm i -g vercel
vercel dev
```

You still need the Railway downloader (or a local instance of the downloader) for the video features.
