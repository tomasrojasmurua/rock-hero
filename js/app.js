// Interfaz: biblioteca, importación, ajustes, calibración y ciclo de partida.
(function (G) {
  const GH = G.GH;
  const $ = (id) => document.getElementById(id);
  const audio = new GH.AudioEngine();
  let settings = GH.settings.load();
  let songs = [];
  let scores = {};
  let current = null; // {song, inst, diff}
  let game = null;
  let sampleAudio = null;
  let wakeLock = null;
  const covers = new Map();

  // ---------- utilidades de interfaz ----------
  function show(id) { $(id).hidden = false; }
  function hide(id) { $(id).hidden = true; }
  function screen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }
  let toastTimer;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms || 3500);
  }
  function loading(msg) { if (msg) { $('loading-msg').textContent = msg; show('loading'); } else hide('loading'); }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const scoreKey = (id, inst, diff) => id + '|' + inst + '|' + diff;

  // ---------- biblioteca ----------
  async function refresh() {
    try {
      songs = await GH.store.listSongs();
      scores = await GH.store.allScores();
    } catch (e) {
      songs = [];
      toast('No se pudo abrir el almacenamiento local: ' + e.message);
    }
    songs.sort((a, b) => (a.artist + a.name).localeCompare(b.artist + b.name, 'es'));
    renderList();
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((est) => {
        const mb = (x) => (x / 1048576).toFixed(0);
        $('storage-info').textContent = songs.length + ' canciones importadas · ' + mb(est.usage || 0) + ' MB usados de ' + mb(est.quota || 0) + ' MB disponibles';
      }).catch(() => {});
    }
  }

  function bestFor(id) {
    let best = null;
    for (const [k, v] of Object.entries(scores)) if (k.startsWith(id + '|') && (!best || v.stars > best.stars)) best = v;
    return best;
  }

  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    const all = [GH.SAMPLE_SONG].concat(songs);
    const list = all.filter((s) => !q || (s.name + ' ' + s.artist).toLowerCase().includes(q));
    const ul = $('song-list');
    ul.innerHTML = '';
    if (!list.length) { ul.innerHTML = '<li class="empty">No hay canciones que coincidan.</li>'; return; }
    for (const s of list) {
      const li = document.createElement('li');
      li.className = 'song';
      const best = bestFor(s.id);
      const insts = Object.keys(s.tracks).map((i) => GH.INSTRUMENTS[i]).join(' · ');
      li.innerHTML =
        '<div class="cover">' + (s.builtin ? '⭐' : '🎵') + '</div>' +
        '<div class="info"><div class="name">' + esc(s.name) + '</div>' +
        '<div class="artist">' + esc(s.artist || 'Artista desconocido') + '</div>' +
        '<div class="tags">' + esc(insts) + (best ? ' · ' + '★'.repeat(Math.min(5, best.stars)) : '') + '</div></div>';
      li.onclick = () => openDetail(s);
      ul.appendChild(li);
      loadCover(s, li.querySelector('.cover'));
    }
  }

  async function loadCover(s, el) {
    if (s.builtin) return;
    if (!covers.has(s.id)) {
      covers.set(s.id, (async () => {
        const files = await GH.store.getFiles(s.id);
        const name = files && Object.keys(files).find((n) => /^album\./.test(n));
        return name ? URL.createObjectURL(files[name]) : null;
      })().catch(() => null));
    }
    const url = await covers.get(s.id);
    if (url) { el.style.backgroundImage = 'url("' + url + '")'; el.textContent = ''; }
  }

  // ---------- detalle ----------
  function openDetail(s) {
    current = { song: s, inst: null, diff: null };
    $('d-name').textContent = s.name;
    $('d-artist').textContent = [s.artist, s.album, s.year].filter(Boolean).join(' · ');
    $('d-charter').textContent = s.charter ? 'Chart: ' + s.charter : '';
    $('d-delete').hidden = !!s.builtin;
    const cov = $('d-cover');
    cov.style.backgroundImage = '';
    cov.textContent = s.builtin ? '⭐' : '🎵';
    loadCover(s, cov);
    const insts = Object.keys(s.tracks);
    const prefInst = insts.includes(settings.lastInst) ? settings.lastInst : insts.includes('guitar') ? 'guitar' : insts[0];
    selectInst(prefInst);
    show('detail');
  }

  function selectInst(inst) {
    current.inst = inst;
    const s = current.song;
    const box = $('d-inst');
    box.innerHTML = '';
    for (const i of Object.keys(s.tracks)) {
      const b = document.createElement('button');
      b.className = 'chip' + (i === inst ? ' on' : '');
      b.textContent = GH.INSTRUMENTS[i];
      b.onclick = () => selectInst(i);
      box.appendChild(b);
    }
    const diffs = s.tracks[inst];
    selectDiff(diffs.includes(settings.lastDiff) ? settings.lastDiff : diffs[0]);
  }

  function selectDiff(diff) {
    current.diff = diff;
    const box = $('d-diff');
    box.innerHTML = '';
    for (const d of current.song.tracks[current.inst]) {
      const b = document.createElement('button');
      b.className = 'chip' + (d === diff ? ' on' : '');
      b.textContent = GH.DIFF_LABELS[d];
      b.onclick = () => selectDiff(d);
      box.appendChild(b);
    }
    const best = scores[scoreKey(current.song.id, current.inst, diff)];
    $('d-best').textContent = best
      ? 'Mejor: ' + best.score.toLocaleString('es') + ' pts · ' + '★'.repeat(Math.min(5, best.stars)) + ' · ' + Math.round(best.accuracy * 100) + '%'
      : 'Aún sin puntuación en esta dificultad.';
  }

  // ---------- partida ----------
  async function startGame() {
    const { song, inst, diff } = current;
    settings.lastInst = inst;
    settings.lastDiff = diff;
    GH.settings.save(settings);
    audio.unlock(); // dentro del gesto del usuario
    audio.setVolume(settings.volume);
    audio.offset = settings.offsetMs / 1000;
    hide('detail');
    try {
      let parsed;
      if (song.builtin) {
        loading('Preparando canción de ejemplo…');
        parsed = GH.parseChart(GH.sampleChartText());
        if (!sampleAudio) sampleAudio = await GH.renderSampleAudio(audio.ctx.sampleRate);
        audio.setBuffers([sampleAudio.backing], [sampleAudio.lead]);
      } else {
        loading('Cargando ' + song.name + '…');
        const files = await GH.store.getFiles(song.id);
        if (!files) throw new Error('No se encontraron los archivos de la canción');
        parsed = await GH.parseSongFiles(files, song.ini);
        const delay = parseFloat(song.ini && song.ini.delay) || 0;
        parsed.offset = (parsed.offset || 0) + delay / 1000;
        await audio.loadStems(files, inst, loading);
      }
      const ini = song.ini || {};
      const opts = {};
      if (ini.hopo_frequency) opts.hopoThreshold = Math.round((parseFloat(ini.hopo_frequency) * parsed.resolution) / 480) || 0;
      if (ini.eighthnote_hopo === '1' || ini.eighthnote_hopo === 'True') opts.eighthHopo = true;
      const playable = GH.buildPlayable(parsed, inst, diff, opts);
      loading(null);
      enterGame(playable);
    } catch (e) {
      loading(null);
      console.error(e);
      toast('Error: ' + (e.message || e), 6000);
    }
  }

  let bandDirty = true;
  async function prepareStage3D() {
    const c3 = $('canvas3d');
    if (!settings.stage3d || !GH.Stage3D) { c3.hidden = true; return null; }
    try {
      const st = GH.Stage3D.get(c3);
      if (bandDirty) {
        const rec = await GH.store.allBandModels().catch(() => ({}));
        const models = {};
        for (const [role, v] of Object.entries(rec)) models[role] = await v.blob.arrayBuffer();
        await st.setBand(models);
        bandDirty = false;
      }
      c3.hidden = false;
      return st;
    } catch (e) {
      console.warn('Escenario 3D no disponible', e);
      c3.hidden = true;
      return null;
    }
  }

  async function renderBandList() {
    const ul = $('band-list');
    const rec = await GH.store.allBandModels().catch(() => ({}));
    ul.innerHTML = '';
    for (const r of GH.BAND_ROLES) {
      const li = document.createElement('li');
      const has = rec[r.id];
      li.innerHTML = '<div class="who"><b>' + esc(r.member) + '</b><span>' + esc(r.label) + ' · ' +
        esc(has ? has.name : 'músico provisional') + '</span></div>';
      const load = document.createElement('label');
      load.className = 'btn';
      load.textContent = has ? 'Cambiar' : 'Cargar .glb';
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.glb,model/gltf-binary'; input.hidden = true;
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        try {
          await GH.store.putBandModel(r.id, f);
          bandDirty = true;
          toast('Modelo de ' + r.member + ' guardado.');
        } catch (e) { toast('No se pudo guardar el modelo: ' + (e.message || e)); }
        renderBandList();
      };
      load.appendChild(input);
      li.appendChild(load);
      if (has) {
        const del = document.createElement('button');
        del.className = 'btn';
        del.textContent = 'Quitar';
        del.onclick = async () => { await GH.store.deleteBandModel(r.id); bandDirty = true; renderBandList(); };
        li.appendChild(del);
      }
      ul.appendChild(li);
    }
  }

  async function enterGame(playable) {
    screen('game');
    goFullscreen();
    if (game) game.destroy();
    const stage3d = await prepareStage3D();
    game = new GH.Game({
      canvas: $('canvas'), audio, settings, playable, stage3d,
      onEnd: finish,
      onPauseRequest: () => (game.paused ? resumeGame() : pauseGame()),
    });
    game.safeTop = 0;
    game.start();
    spLoop();
    requestWakeLock();
  }

  function spLoop() {
    if (!game || !game.running) return;
    $('btn-sp').classList.toggle('ready', game.energy >= 0.5 && !game.spActive);
    requestAnimationFrame(spLoop);
  }

  function pauseGame() {
    if (!game || game.finished) return;
    game.pause();
    show('pause');
  }
  function resumeGame() {
    hide('pause');
    if (game) game.resume();
  }
  function quitGame() {
    hide('pause'); hide('results');
    if (game) { game.destroy(); game = null; }
    releaseWakeLock();
    exitFullscreen();
    screen('menu');
    refresh();
  }

  async function finish(r) {
    releaseWakeLock();
    const key = scoreKey(current.song.id, current.inst, current.diff);
    const prev = scores[key];
    const isBest = !prev || r.score > prev.score;
    if (isBest) {
      const val = { score: r.score, stars: r.stars, accuracy: r.accuracy, maxCombo: r.maxCombo, at: Date.now() };
      scores[key] = val;
      GH.store.putScore(key, val).catch(() => {});
    }
    $('r-title').textContent = r.accuracy === 1 ? '¡Full Combo!' : '¡Canción completada!';
    $('r-stars').textContent = '★'.repeat(Math.min(5, r.stars)) + '☆'.repeat(Math.max(0, 5 - r.stars));
    $('r-stars').style.color = r.stars >= 6 ? '#fbbf24' : '';
    $('r-score').textContent = r.score.toLocaleString('es');
    $('r-best').textContent = isBest ? (prev ? '¡Nuevo récord!' : '') : 'Récord: ' + prev.score.toLocaleString('es');
    $('r-acc').textContent = Math.round(r.accuracy * 100) + '%';
    $('r-notes').textContent = r.hit + '/' + r.total;
    $('r-combo').textContent = r.maxCombo;
    show('results');
  }

  function goFullscreen() {
    const el = document.documentElement;
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
    if (p && p.catch) p.catch(() => {});
  }
  function exitFullscreen() {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
  async function requestWakeLock() {
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* opcional */ }
  }
  function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch (e) { /* nada */ } wakeLock = null; }

  // ---------- importación ----------
  async function handleImport(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    loading('Leyendo archivos…');
    try {
      const { songs: found, errors } = await GH.importFiles(files, loading);
      let saved = 0;
      for (const s of found) {
        loading('Guardando ' + s.name + '…');
        try { await GH.store.addSong(s); saved++; }
        catch (e) { errors.push(s.name + ': no se pudo guardar (' + (e.message || e) + ')'); }
      }
      if (saved && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      loading(null);
      await refresh();
      let msg = saved ? 'Importadas ' + saved + ' canciones.' : 'No se encontró ninguna canción (hace falta notes.chart o notes.mid).';
      if (errors.length) msg += '\n' + errors.slice(0, 4).join('\n') + (errors.length > 4 ? '\n…y ' + (errors.length - 4) + ' más' : '');
      toast(msg, errors.length ? 9000 : 4000);
    } catch (e) {
      loading(null);
      toast('Error al importar: ' + (e.message || e), 7000);
    }
  }

  // ---------- ajustes ----------
  function bindSettings() {
    const map = [
      ['s-speed', 'noteSpeed', 'o-speed', (v) => v.toFixed(1) + 'x'],
      ['s-offset', 'offsetMs', 'o-offset', (v) => v + ' ms'],
      ['s-window', 'windowMs', 'o-window', (v) => '±' + v + ' ms'],
      ['s-volume', 'volume', 'o-volume', (v) => Math.round(v * 100) + '%'],
    ];
    for (const [id, key, out, fmt] of map) {
      const el = $(id);
      el.value = settings[key];
      $(out).textContent = fmt(Number(settings[key]));
      el.oninput = () => {
        settings[key] = Number(el.value);
        $(out).textContent = fmt(settings[key]);
        GH.settings.save(settings);
        if (key === 'volume') audio.setVolume(settings.volume);
      };
    }
    for (const [id, key] of [['s-lefty', 'lefty'], ['s-miss', 'missSound'], ['s-vibrate', 'vibrate'], ['s-stage3d', 'stage3d']]) {
      $(id).checked = !!settings[key];
      $(id).onchange = () => { settings[key] = $(id).checked; GH.settings.save(settings); };
    }
  }

  // ---------- calibración ----------
  let calib = null;
  function startCalibration() {
    audio.unlock();
    audio.setVolume(settings.volume);
    audio.offset = 0;
    hide('settings');
    show('calib');
    const bpm = 100, beats = 20, beat = 60 / bpm;
    audio.startCtx = audio.ctx.currentTime + 1;
    audio.anchorCtx = null;
    for (let i = 0; i < beats; i++) audio.click(audio.startCtx + i * beat, i % 4 === 0);
    calib = { taps: [], beat, beats, timer: null };
    $('calib-msg').textContent = 'Toca en cualquier parte de este recuadro al ritmo de los clics.';
    const blink = () => {
      if (!calib) return;
      audio.tick();
      const t = audio.songTime();
      const ph = t >= 0 ? (t % beat) / beat : 1;
      $('calib-beat').classList.toggle('on', ph < 0.15);
      if (t > beats * beat + 0.3) return endCalibration();
      calib.timer = requestAnimationFrame(blink);
    };
    blink();
  }
  function calibTap(e) {
    if (!calib) return;
    if (e.target.id === 'calib-cancel') return;
    e.preventDefault();
    const t = audio.songTimeAt(e.timeStamp || performance.now());
    const k = Math.round(t / calib.beat);
    if (k >= 4 && k < calib.beats) calib.taps.push(t - k * calib.beat);
  }
  function endCalibration(cancel) {
    if (!calib) return;
    cancelAnimationFrame(calib.timer);
    const taps = calib.taps.slice().sort((a, b) => a - b);
    calib = null;
    hide('calib');
    show('settings');
    if (cancel) return;
    if (taps.length < 6) { toast('Muy pocos toques; inténtalo de nuevo.'); return; }
    const med = taps[Math.floor(taps.length / 2)];
    settings.offsetMs = Math.round((med * 1000) / 5) * 5;
    GH.settings.save(settings);
    bindSettings();
    toast('Calibración guardada: ' + settings.offsetMs + ' ms');
  }

  // ---------- arranque ----------
  function init() {
    $('in-folder').onchange = (e) => { handleImport(e.target.files); e.target.value = ''; };
    $('in-files').onchange = (e) => { handleImport(e.target.files); e.target.value = ''; };
    if (!('webkitdirectory' in document.createElement('input'))) $('lbl-folder').hidden = true;
    $('search').oninput = renderList;
    $('d-close').onclick = () => hide('detail');
    $('detail').onclick = (e) => { if (e.target.id === 'detail') hide('detail'); };
    $('d-play').onclick = startGame;
    $('d-delete').onclick = async () => {
      const btn = $('d-delete');
      // Confirmación en dos toques (los diálogos nativos no siempre están disponibles).
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = '¿Seguro? Toca otra vez';
        setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Eliminar'; }, 3000);
        return;
      }
      delete btn.dataset.armed;
      btn.textContent = 'Eliminar';
      await GH.store.deleteSong(current.song.id);
      hide('detail');
      refresh();
    };
    $('btn-pause').onclick = pauseGame;
    $('btn-sp').onclick = () => game && game.activateSP();
    $('p-resume').onclick = resumeGame;
    $('p-restart').onclick = () => { hide('pause'); game.paused = false; audio.resume().then(() => game.restart()); };
    $('p-quit').onclick = quitGame;
    $('r-again').onclick = () => { hide('results'); audio.unlock(); enterGame(game.play); };
    $('r-menu').onclick = quitGame;
    $('btn-settings').onclick = () => { bindSettings(); renderBandList(); show('settings'); };
    $('s-close').onclick = () => hide('settings');
    $('s-calibrate').onclick = startCalibration;
    $('calib-pad').addEventListener('pointerdown', calibTap);
    $('calib-cancel').onclick = () => endCalibration(true);
    document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.running) pauseGame(); });
    refresh();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  GH._debug = { get game() { return game; }, audio };
  init();
})(window);
