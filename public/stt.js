/* Speech to Text view for Naive. Self-contained: it only touches the elements with ids starting "stt".
   Opens and closes with a light fade/slide (CSS only). */
(() => {
  const $ = id => document.getElementById(id);
  const root = $('stt'), openBtn = $('sttOpen');
  if (!root || !openBtn) return;

  const el = {
    back: $('sttBack'), drop: $('sttDrop'), pick: $('sttPick'), input: $('sttInput'),
    file: $('sttFile'), name: $('sttName'), size: $('sttSize'), remove: $('sttRemove'), audio: $('sttAudio'), go: $('sttGo'),
    load: $('sttLoad'), lp: $('sttLp'), lpc: $('sttLpc'), ll: $('sttLl'), ls: $('sttLs'), cancel: $('sttCancel'),
    err: $('sttErr'), errText: $('sttErrText'), errX: $('sttErrX'),
    hint: $('sttHint'), langRow: document.querySelector('.stt-langrow'),
    result: $('sttResult'), text: $('sttText'), langF: $('sttLang'), errTitle: $('sttErrTitle'), errAct: $('sttErrAct'), useDet: $('sttUseDet'), keep: $('sttKeep'), copy: $('sttCopy'), save: $('sttSave'), again: $('sttNew'),
    toast: $('sttToast')
  };

  const MAX_BYTES = 200 * 1024 * 1024, RING = 113.1; // ring circumference (r = 18)
  const NAMES = { en: 'English', ur: 'Urdu', hi: 'Hindi', ar: 'Arabic' };
  let file = null, job = null, toastTimer = 0, reuseId = null, lang = '', resultLang = 'en', original = '';
  try { localStorage.removeItem('naive.stt.lang'); } catch { /* old versions remembered the language; now it is chosen every time */ }

  // ---------- open / close ----------
  const shell = () => [document.querySelector('.app'), document.querySelector('.tab')];
  function open() {
    if (!root.hidden) return;
    root.hidden = false;
    document.body.classList.add('stt-open');
    shell().forEach(n => n && (n.inert = true));
    try { history.pushState({ stt: 1 }, ''); } catch { /* ignore */ }
    root.scrollTop = 0;
    el.back.focus({ preventScroll: true });
  }
  let hideTimer = 0;
  function hide() {
    if (root.hidden || root.classList.contains('closing')) return;
    root.classList.add('closing');
    const finish = () => {
      root.classList.remove('closing');
      root.hidden = true;
      document.body.classList.remove('stt-open');
      shell().forEach(n => n && (n.inert = false));
      (document.getElementById('menuBtn') || openBtn).focus({ preventScroll: true });
    };
    clearTimeout(hideTimer);
    hideTimer = setTimeout(finish, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  }
  // the phone's back button closes this view instead of leaving the app
  const close = () => (history.state && history.state.stt ? history.back() : hide());
  addEventListener('popstate', hide);
  openBtn.addEventListener('click', open);
  el.back.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  // ---------- small helpers ----------
  function toast(msg) {
    el.toast.textContent = msg; el.toast.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('on'), 1800);
  }
  function bytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'], i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  const showErr = (m, title) => { el.errTitle.textContent = title || 'Something went wrong'; el.errText.textContent = m; el.errAct.hidden = true; el.err.hidden = false; };
  const clearErr = () => { el.err.hidden = true; el.errAct.hidden = true; };

  // exactly one of these is visible at a time: drop | file | load | result
  function view(name) {
    el.drop.hidden = name !== 'drop';
    el.file.hidden = name !== 'file';
    el.load.hidden = name !== 'load';
    el.result.hidden = name !== 'result';
    root.classList.toggle('has-result', name === 'result');
  }

  function progress(pct, title, sub) {
    pct = Math.max(0, Math.min(100, pct));
    el.lp.style.strokeDashoffset = String(RING * (1 - pct / 100));
    el.lpc.textContent = Math.round(pct) + '%';
    if (title) el.ll.textContent = title;
    if (sub !== undefined) el.ls.textContent = sub;
  }

  // ---------- language choice: starts on "Select"; Transcribe stays dimmed until one is picked ----------
  function updateGo() {
    el.go.setAttribute('aria-disabled', lang ? 'false' : 'true');
    el.langF.classList.toggle('unset', !lang);
  }
  function hideHint() { el.hint.hidden = true; el.langF.classList.remove('bad'); }
  function setLang(v) {
    lang = NAMES[v] ? v : '';
    el.langF.value = lang; // '' shows the "Select" placeholder
    updateGo();
    if (lang) hideHint();
  }
  // the button is only dimmed (not truly disabled) so tapping it can still explain what is missing
  function needLang() {
    el.hint.hidden = false;
    el.langF.classList.add('bad');
    el.langRow.classList.remove('shake'); void el.langRow.offsetWidth; el.langRow.classList.add('shake');
    el.langF.focus({ preventScroll: true });
  }
  setLang('');
  el.langF.addEventListener('change', () => { setLang(el.langF.value); clearErr(); });

  // ---------- choosing a file ----------
  function setFile(f) {
    clearErr();
    if (!f) return;
    const isAudio = (f.type || '').startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|webm)$/i.test(f.name);
    if (!isAudio) return showErr('Please choose an audio file such as MP3, WAV, M4A, AAC, FLAC, OGG or WEBM.');
    if (f.size > MAX_BYTES) return showErr('That file is too large (200 MB maximum).');
    if (el.audio.src) URL.revokeObjectURL(el.audio.src);
    file = f; reuseId = null;
    el.name.textContent = f.name;
    el.size.textContent = bytes(f.size);
    el.audio.src = URL.createObjectURL(f);
    setLang(''); hideHint(); // every new audio asks for its spoken language again
    view('file');
  }

  function reset() {
    clearErr();
    stopJob();
    if (el.audio.src) URL.revokeObjectURL(el.audio.src);
    file = null; reuseId = null; original = '';
    setLang(''); hideHint();
    el.input.value = '';
    el.audio.removeAttribute('src'); el.audio.load();
    el.text.value = '';
    progress(0);
    view('drop');
  }

  el.pick.addEventListener('click', e => { e.stopPropagation(); el.input.click(); });
  el.drop.addEventListener('click', () => el.input.click());
  el.drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.input.click(); } });
  el.input.addEventListener('change', () => setFile(el.input.files[0]));
  ['dragenter', 'dragover'].forEach(t => el.drop.addEventListener(t, e => { e.preventDefault(); el.drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => el.drop.addEventListener(t, e => { e.preventDefault(); el.drop.classList.remove('drag'); }));
  el.drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));
  // a file dropped next to the box must not make the browser open it
  ['dragover', 'drop'].forEach(t => root.addEventListener(t, e => e.preventDefault()));
  el.remove.addEventListener('click', reset);
  el.again.addEventListener('click', reset);
  el.errX.addEventListener('click', clearErr);

  // ---------- transcribing ----------
  function stopJob() {
    if (!job) return;
    job.cancelled = true;
    try { job.xhr && job.xhr.abort(); } catch { /* ignore */ }
    job = null;
  }

  let mismatch = null;
  function fail(job_, message, code, detected) {
    if (job !== job_) return; // cancelled meanwhile
    job = null;
    view('file');
    if (code === 'language_mismatch' && NAMES[detected]) {
      // the detector can be wrong (accents, background sound), so this is a question, never a dead end
      mismatch = { detected };
      showErr(message + ' Switch language, or keep your choice if you are sure.', "Language doesn't match");
      el.useDet.textContent = 'Switch to ' + NAMES[detected];
      el.keep.textContent = 'Keep ' + NAMES[lang];
      el.errAct.hidden = false;
    } else if (code === 'wrong_language') showErr(message, "Language doesn't match");
    else if (code === 'no_speech') showErr(message, 'No speech found');
    else showErr(message || 'Unable to transcribe this file.');
  }
  el.useDet.addEventListener('click', () => { if (!mismatch) return; setLang(mismatch.detected); clearErr(); start(); });
  el.keep.addEventListener('click', () => { clearErr(); start({ force: true }); });

  function start(opts) {
    if (!file || job) return;
    if (!lang) return needLang();
    const force = !!(opts && opts.force);
    clearErr();
    const me = job = { cancelled: false, xhr: new XMLHttpRequest() };
    const again = !!reuseId; // same audio is already at the speech engine: no second upload
    view('load');
    progress(0, again ? 'Preparing…' : 'Uploading audio…', again ? 'Using your earlier upload' : 'Sending your recording');

    const xhr = me.xhr;
    xhr.open('POST', '/api/transcribe?lang=' + encodeURIComponent(lang) + (again ? '&from=' + encodeURIComponent(reuseId) : '') + (force ? '&force=1' : '') + (again ? '' : '&name=' + encodeURIComponent(file.name)));
    if (!again) xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) progress(e.loaded / e.total * 40); };
    xhr.upload.onload = () => progress(40, 'Preparing…', 'Handing it to the speech engine');
    xhr.onerror = () => fail(me, 'Could not reach Naive. Check your connection and try again.');
    xhr.onload = () => {
      let d = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 410 && again) { reuseId = null; job = null; return start(opts); } // cached upload expired: upload again
      if (xhr.status >= 200 && xhr.status < 300 && d.id) {
        // Immediate result (ElevenLabs on Vercel) — no need to poll
        if (d._immediate && d.status === 'completed') {
          reuseId = d.id;
          return done(me, d.text || '', d.language || 'en');
        }
        reuseId = d.id;
        poll(me, d.id);
      }
      else fail(me, d.error || 'Transcription failed.');
    };
    again ? xhr.send() : xhr.send(file);
  }

  async function poll(me, id) {
    let value = 45, misses = 0;
    progress(value, 'Transcribing…', 'Turning speech into text');
    for (let i = 0; i < 300; i++) { // about 15 minutes at most
      await new Promise(r => setTimeout(r, 3000));
      if (me.cancelled) return;
      let d;
      try {
        const r = await fetch('/api/transcribe/' + encodeURIComponent(id));
        d = await r.json().catch(() => ({}));
        if (r.status === 404 && d.code === 'expired') { reuseId = null; return fail(me, d.error); }
        if (!r.ok) throw new Error(d.error || 'Could not read the transcription status.');
        misses = 0;
      } catch (e) {
        if (++misses >= 4) return fail(me, e.message || 'Lost connection while transcribing.');
        continue; // a short network blip: try again
      }
      if (me.cancelled) return;
      if (d.status === 'error') return fail(me, d.error, d.code, d.detected);
      if (d.status === 'completed') return done(me, d.text || '', d.language);
      if (d.stage === 'detect') { if (value < 70) value = 70; progress(value, undefined, 'Double-checking the language'); }
      value += (94 - value) * 0.1; // creeps toward 94% until the job really finishes
      progress(value);
    }
    fail(me, 'Transcription timed out. Please try a shorter recording.');
  }

  function done(me, text, language) {
    if (job !== me) return;
    job = null;
    progress(100, 'All done', 'Your transcript is ready');
    setTimeout(() => {
      resultLang = NAMES[language] ? language : lang;
      setLang(resultLang);
      el.text.value = original = text;
      applyScript(resultLang);
      view('result');
      el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 450);
  }

  el.go.addEventListener('click', () => start());
  el.cancel.addEventListener('click', () => { stopJob(); view(file ? 'file' : 'drop'); });

  // ---------- transcript: language-aware font + word count ----------
  let scriptFonts = false;
  function loadScriptFonts() { // only fetched when an Urdu / Arabic transcript appears, so the app stays fast and offline-friendly
    if (scriptFonts) return;
    scriptFonts = true;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Noto+Nastaliq+Urdu:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@400;500;600&display=swap';
    document.head.appendChild(l);
  }

  // the transcript box takes the font and direction of the language it was transcribed in
  function applyScript(l) {
    el.text.classList.remove('f-en', 'f-ur', 'f-hi', 'f-ar');
    el.text.classList.add('f-' + l);
    el.text.dir = (l === 'ur' || l === 'ar') ? 'rtl' : 'ltr';
    if (l !== 'en') loadScriptFonts();
  }

  // copy: the copy icon turns into a small drawn tick (pure CSS, no animation library), then goes back
  let tickTimer = 0;
  function showTick() {
    const box = el.copy.querySelector('.stt-tick');
    box.innerHTML = '<svg class="chk" viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4.2 4.2 8.8-9.4"/></svg>';
    el.copy.classList.add('copied');
    clearTimeout(tickTimer);
    tickTimer = setTimeout(() => el.copy.classList.remove('copied'), 1800);
  }
  el.copy.addEventListener('click', async () => {
    if (!el.text.value.trim()) return;
    let ok = true;
    try { await navigator.clipboard.writeText(el.text.value); }
    catch { el.text.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } }
    if (ok) showTick(); else toast('Could not copy. Select the text and copy it manually.');
  });

  el.save.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([el.text.value], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = (file ? file.name : 'transcript').replace(/\.[^.]+$/, '') + '-transcript.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Transcript downloaded');
  });

  reset();
})();
