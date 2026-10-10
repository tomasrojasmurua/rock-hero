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
    updatePill();
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
        '<div class="info"><div class="name"></div><div class="artist"></div>' +
        '<div class="tags">' + esc(insts) + (best ? ' · ' + '★'.repeat(Math.min(5, best.stars)) : '') + '</div></div>';
      li.onclick = () => openDetail(s);
      ul.appendChild(li);
      marquee(li.querySelector('.name'), s.name);
      marquee(li.querySelector('.artist'), (s.artist || 'Artista desconocido') + (s.year ? ', ' + s.year : ''));
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

  // Texto largo: recortado en una línea que se desliza de lado a lado (nunca ensancha la pantalla).
  function marquee(el, text) {
    el.classList.add('mq');
    el.classList.remove('run');
    const sp = document.createElement('span');
    sp.textContent = text;
    el.textContent = '';
    el.appendChild(sp);
    requestAnimationFrame(() => {
      const over = sp.offsetWidth - el.clientWidth;
      if (el.clientWidth > 0 && over > 2) {
        el.style.setProperty('--mq-d', over + 'px');
        el.style.setProperty('--mq-t', Math.max(5, over / 25 + 3) + 's');
        el.classList.add('run');
      }
    });
  }

  // ---------- detalle ----------
  function openDetail(s) {
    current = { song: s, inst: null, diff: null };
    marquee($('d-name'), s.name);
    marquee($('d-artist'), [s.artist, s.album, s.year].filter(Boolean).join(' · '));
    marquee($('d-charter'), s.charter ? 'Chart: ' + s.charter : '');
    $('d-delete').hidden = !!s.builtin || !!room;
    $('d-play').textContent = !forRoom(s) ? '▶ Jugar' : room.isHost && !(mp.song && mp.song.meta.id === s.id) ? 'Elegir para la sala' : 'Listo';
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
    const diffs = GH.playableDiffs(s.tracks[inst]).map((x) => x.diff);
    selectDiff(diffs.includes(settings.lastDiff) ? settings.lastDiff : diffs[0]);
  }

  function selectDiff(diff) {
    current.diff = diff;
    const box = $('d-diff');
    box.innerHTML = '';
    const list = GH.playableDiffs(current.song.tracks[current.inst]);
    for (const { diff: d, auto } of list) {
      const b = document.createElement('button');
      b.className = 'chip' + (d === diff ? ' on' : '') + (auto ? ' auto' : '');
      b.textContent = GH.DIFF_LABELS[d] + (auto ? ' ✦' : '');
      b.onclick = () => selectDiff(d);
      box.appendChild(b);
    }
    const sel = list.find((x) => x.diff === diff);
    $('d-auto').hidden = !(sel && sel.auto);
    if (sel && sel.auto) $('d-auto').textContent = '✦ Versión simplificada creada a partir de ' + GH.DIFF_LABELS[list[0].diff] + '.';
    const best = scores[scoreKey(current.song.id, current.inst, diff)];
    $('d-best').textContent = best
      ? 'Mejor: ' + best.score.toLocaleString('es') + ' pts · ' + '★'.repeat(Math.min(5, best.stars)) + ' · ' + Math.round(best.accuracy * 100) + '%'
      : 'Aún sin puntuación en esta dificultad.';
  }

  // ---------- partida ----------
  // Carga notas y audio de la canción y devuelve las notas jugables.
  async function prepareSong(song, inst, diff) {
    audio.setVolume(settings.volume);
    audio.offset = settings.offsetMs / 1000;
    let parsed;
    if (song.builtin) {
      loading('Preparando canción de ejemplo…');
      parsed = GH.parseChart(GH.sampleChartText());
      if (!sampleAudio) sampleAudio = await GH.renderSampleAudio(audio.ctx.sampleRate);
      audio.setBuffers([sampleAudio.backing], [sampleAudio.lead]);
    } else {
      loading('Cargando ' + song.name + '…');
      let files;
      try { files = await GH.store.getFiles(song.id); }
      catch (e) { throw new Error('No se pudo leer la canción guardada. Bórrala (Eliminar) e impórtala de nuevo.'); }
      if (!files) throw new Error('No se encontraron los archivos de la canción');
      try { parsed = await GH.parseSongFiles(files, song.ini); }
      catch (e) { throw new Error('Archivo de notas ilegible: ' + (e.message || e) + '. Elimina e importa de nuevo.'); }
      const delay = parseFloat(song.ini && song.ini.delay) || 0;
      parsed.offset = (parsed.offset || 0) + delay / 1000;
      await audio.loadStems(files, inst, loading);
    }
    const ini = song.ini || {};
    const opts = {};
    if (ini.hopo_frequency) opts.hopoThreshold = Math.round((parseFloat(ini.hopo_frequency) * parsed.resolution) / 480) || 0;
    if (ini.eighthnote_hopo === '1' || ini.eighthnote_hopo === 'True') opts.eighthHopo = true;
    GH.fillDifficulties(parsed);
    const playable = GH.buildPlayable(parsed, inst, diff, opts);
    loading(null);
    return playable;
  }

  function rememberChoice(inst, diff) {
    settings.lastInst = inst;
    settings.lastDiff = diff;
    GH.settings.save(settings);
  }

  async function startGame() {
    if (performance.now() < startLockUntil) return;
    const { song, inst, diff } = current;
    rememberChoice(inst, diff);
    audio.unlock(); // dentro del gesto del usuario
    hide('detail');
    try {
      enterGame(await prepareSong(song, inst, diff));
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

  // Altura de la muesca/barra de estado (env(safe-area-inset-top)); en iPhone con muesca vertical se deja un margen mínimo.
  function safeTop() {
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden';
    document.body.appendChild(p);
    let v = p.offsetHeight;
    p.remove();
    const portrait = innerHeight > innerWidth;
    // Si la página no recibe la zona segura (p. ej. dentro de otra app), se reserva un margen fijo para la muesca.
    const fallback = !v && portrait && /iPhone/.test(navigator.userAgent) && Math.max(window.screen.width, window.screen.height) >= 812;
    if (fallback) v = 44;
    document.documentElement.style.setProperty('--safe-top', fallback ? v + 'px' : 'env(safe-area-inset-top, 0px)');
    return v;
  }

  // Tras Salir no se permite arrancar otra partida durante un momento (evita toques fantasma que reinician la canción).
  let startLockUntil = 0, entering = false;
  async function enterGame(playable) {
    if (entering || performance.now() < startLockUntil) return;
    entering = true;
    try { await enterGameNow(playable); } finally { entering = false; }
  }
  async function enterGameNow(playable) {
    screen('game');
    goFullscreen();
    if (game) game.destroy();
    const stage3d = await prepareStage3D();
    if (performance.now() < startLockUntil) { screen('menu'); return; }
    if (game) game.destroy();
    game = new GH.Game({
      canvas: $('canvas'), audio, settings, playable, stage3d,
      onEnd: finish,
      onPauseRequest: () => (game.paused ? resumeGame() : pauseGame()),
    });
    game.safeTop = safeTop();
    window.addEventListener('resize', () => { if (game) game.safeTop = safeTop(); });
    $('mp-hud').hidden = !mp.inRound;
    $('p-restart').hidden = mp.inRound;
    game.start();
    spLoop();
    requestWakeLock();
  }

  function spLoop() {
    if (!game || !game.running) return;
    $('btn-sp').classList.toggle('ready', game.energy >= 0.5 && !game.spActive);
    if (mp.inRound) roomTick();
    requestAnimationFrame(spLoop);
  }

  function pauseGame() {
    if (!game || game.finished) return;
    game.pause();
    pausedAt = performance.now();
    show('pause');
  }
  let pausedAt = 0;
  // Ignora toques en los botones de la pausa justo después de abrirla (evita pulsaciones fantasma).
  const pauseGuard = (fn) => (e) => { if (performance.now() - pausedAt < 350) return; fn(e); };
  function resumeGame() {
    hide('pause');
    if (game) game.resume();
  }
  function quitGame() {
    hide('pause'); hide('results');
    startLockUntil = performance.now() + 1200;
    const g = game, wasRound = mp.inRound;
    try { audio.stop(); } catch (e) { /* nada */ }
    try {
      if (mp.inRound) {
        if (g && !g.finished) room.send({ t: 'final', id: room.myId, score: Math.round(g.score), quit: true });
        endRound();
      }
    } catch (e) { console.error(e); }
    try { if (g) { g.destroy(); game = null; } } catch (e) { console.error(e); game = null; }
    try { releaseWakeLock(); exitFullscreen(); } catch (e) { /* nada */ }
    if (room && wasRound) { screen('menu'); refresh(); showRoom(); return; }
    screen('menu');
    refresh();
  }

  async function finish(r) {
    releaseWakeLock();
    if (mp.inRound) roomFinish(r);
    $('r-again').hidden = !!mp.inRound;
    $('r-menu').textContent = mp.inRound ? 'Volver a la sala' : 'Biblioteca';
    $('r-room').hidden = !mp.inRound;
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
      const key = (s) => [s.artist, s.name, s.charter].map((x) => (x || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
      const existing = await GH.store.listSongs();
      const knownSrc = new Set(existing.map((s) => s.src).filter(Boolean));
      const knownKeys = new Set(existing.map(key));
      const res = await GH.importFiles(files, loading, { knownSrc });
      const errors = res.errors;
      let skipped = res.skipped;
      const found = [];
      for (const s of res.songs) {
        if (knownKeys.has(key(s))) { skipped++; continue; }
        knownKeys.add(key(s));
        found.push(s);
      }
      let saved = 0;
      for (const s of found) {
        loading('Guardando ' + s.name + '…');
        try { await GH.store.addSong(s); saved++; }
        catch (e) { errors.push(s.name + ': no se pudo guardar (' + (e.message || e) + ')'); }
      }
      if (saved && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      loading(null);
      await refresh();
      if (saved) openTab('setlist');
      let msg = saved ? 'Importadas ' + saved + ' canciones nuevas.' : (skipped ? 'No hay canciones nuevas.' : 'No se encontró ninguna canción (hace falta notes.chart o notes.mid).');
      if (skipped) msg += ' Omitidas ' + skipped + ' que ya estaban.';
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


  // ---------- multijugador ----------
  let room = null;
  // song: canción elegida en la sala ({meta, hash}); local: la misma canción en este teléfono;
  // prepared: notas listas para empezar; scores: id -> {score, final}.
  const mp = { song: null, local: null, prepared: null, inRound: false, scores: {}, lastSent: 0, lastHud: 0, lastPct: -1 };

  // En una sala, el anfitrión elige cualquier canción; los invitados solo la de la sala.
  function forRoom(s) {
    return !!room && (room.isHost || (!!mp.local && mp.local.id === s.id));
  }

  function openRoomSheet(code) {
    $('room-name').value = settings.playerName || '';
    if (code) $('room-code').value = code;
    showRoom();
  }

  function showRoom() {
    $('room-start').hidden = !!room;
    $('room-in').hidden = !room;
    if (room) renderRoom();
    show('room');
    updatePill();
  }
  function hideRoom() { hide('room'); updatePill(); }

  function updatePill() {
    const pill = $('room-pill');
    const inGame = $('game').classList.contains('active');
    pill.hidden = !room || inGame || !$('room').hidden;
    if (room) pill.textContent = '👥 Sala ' + room.code + ' · ' + room.players.length;
  }

  function saveName() {
    const n = $('room-name').value.trim();
    settings.playerName = n;
    GH.settings.save(settings);
    return n || 'Jugador';
  }

  async function createRoom() {
    if (!G.Peer) { toast('No se pudo cargar el módulo de salas.'); return; }
    const r = new GH.Room(saveName());
    loading('Creando sala…');
    try { await r.host(); }
    catch (e) { loading(null); toast(e.message, 6000); return; }
    loading(null);
    setRoom(r);
  }

  async function joinRoom(code) {
    code = (code || $('room-code').value).trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { toast('El código de sala tiene 5 letras o números.'); return; }
    if (!G.Peer) { toast('No se pudo cargar el módulo de salas.'); return; }
    audio.unlock();
    const r = new GH.Room(saveName());
    loading('Entrando a la sala ' + code + '…');
    try { await r.join(code); }
    catch (e) { loading(null); toast(e.message, 7000); return; }
    loading(null);
    setRoom(r);
    toast('¡Entraste a la sala ' + code + '!');
  }

  function setRoom(r) {
    room = r;
    Object.assign(mp, { song: null, local: null, prepared: null, inRound: false, scores: {} });
    r.on('players', () => { renderRoom(); updatePill(); })
      .on('joined', (n) => toast(n + ' entró a la sala'))
      .on('left', (n) => toast(n + ' salió de la sala'))
      .on('warn', (m) => console.warn(m))
      .on('closed', (m) => { toast(m, 6000); dropRoom(); })
      .on('song', onRoomSong)
      .on('progress', onRoomProgress)
      .on('received', onRoomReceived)
      .on('start', (m) => scheduleRound(m.in))
      .on('score', (m) => { mp.scores[m.id] = { score: m.score, final: false }; })
      .on('final', (m) => { mp.scores[m.id] = { score: m.score, final: true, quit: m.quit, acc: m.acc, stars: m.stars }; renderRank(); });
    showRoom();
  }

  function leaveRoom() {
    if (room) room.leave();
    dropRoom();
    hideRoom();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  function dropRoom() {
    room = null;
    mp.inRound = false;
    mp.song = mp.local = mp.prepared = null;
    $('mp-hud').hidden = true;
    if (!$('room').hidden) showRoom();
    updatePill();
  }

  const STATE_TEXT = { lobby: 'esperando canción', choosing: 'eligiendo instrumento', loading: 'cargando…', ready: 'listo', playing: 'tocando', done: 'terminó' };
  function stateText(p) {
    if (p.state === 'downloading') return 'recibiendo canción ' + Math.round((p.pct || 0) * 100) + '%';
    if (p.state === 'ready' && p.inst) return 'listo · ' + GH.INSTRUMENTS[p.inst] + ' ' + GH.DIFF_LABELS[p.diff];
    return STATE_TEXT[p.state] || p.state || '';
  }

  function renderRoom() {
    if (!room) return;
    $('room-code-show').textContent = room.code;
    $('room-share-row').hidden = !room.isHost;
    const ul = $('room-players');
    ul.innerHTML = '';
    room.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<div class="who"><b></b><span class="tag"></span></div>';
      li.querySelector('b').textContent = p.name + (i === 0 ? ' 👑' : '') + (p.id === room.myId ? ' (tú)' : '');
      const tag = li.querySelector('.tag');
      tag.textContent = stateText(p);
      tag.classList.toggle('ok', p.state === 'ready');
      ul.appendChild(li);
    });
    const meta = mp.song && mp.song.meta;
    $('room-song').textContent = meta ? meta.name + (meta.artist ? ' · ' + meta.artist : '') : room.isHost ? 'Elige qué canción van a tocar.' : 'El anfitrión está eligiendo la canción.';
    const pick = $('room-pick');
    if (room.isHost) { pick.textContent = meta ? 'Cambiar canción' : 'Elegir canción'; pick.disabled = false; }
    else { pick.textContent = mp.prepared ? 'Cambiar instrumento' : 'Elegir instrumento'; pick.disabled = !mp.local; }
    const go = $('room-go');
    go.hidden = !room.isHost;
    const allReady = room.players.length > 1 && room.players.every((p) => p.state === 'ready');
    go.disabled = !allReady || !mp.prepared;
    go.textContent = room.players.length < 2 ? 'Esperando jugadores…' : allReady ? '¡Empezar!' : 'Esperando a que todos estén listos…';
  }

  function setMyState(state, extra) {
    const me = room.players.find((p) => p.id === room.myId);
    if (room.isHost) {
      if (me) { Object.assign(me, { state, inst: undefined, diff: undefined, pct: undefined }, extra || {}); room._sendPlayers(); }
    } else {
      room.send(Object.assign({ t: 'state', state, inst: null, diff: null }, extra || {}));
    }
  }

  function roomPick() {
    if (!room) return;
    if (room.isHost) { hideRoom(); openTab('setlist'); screen('menu'); refresh(); toast('Toca la canción que van a tocar.'); }
    else if (mp.local) { hideRoom(); openDetail(mp.local); }
  }

  // "Listo" en la ficha: el anfitrión además elige la canción para todos.
  async function roomReady() {
    const { song, inst, diff } = current;
    rememberChoice(inst, diff);
    audio.unlock();
    hide('detail');
    if (room.isHost && !(mp.song && mp.song.meta.id === song.id)) {
      loading('Preparando la canción para la sala…');
      let files = null, hash = null;
      try {
        if (!song.builtin) { files = await GH.store.getFiles(song.id); hash = await GH.notesHash(files); }
      } catch (e) { loading(null); toast('No se pudo leer la canción: ' + (e.message || e)); return; }
      const { files: _f, ...meta } = song;
      mp.song = { meta, hash };
      mp.local = song;
      mp.prepared = null;
      room.setSong(mp.song, files);
    }
    setMyState('loading');
    try { mp.prepared = await prepareSong(song, inst, diff); }
    catch (e) { loading(null); toast('Error: ' + (e.message || e), 6000); setMyState('choosing'); return; }
    await prepareStage3D();
    mp.prepared.inst = inst;
    setMyState('ready', { inst, diff });
    showRoom();
  }

  async function onRoomSong(s) {
    mp.song = s;
    mp.local = null;
    mp.prepared = null;
    renderRoom();
    const local = await findLocal(s);
    if (mp.song !== s) return;
    if (local) {
      mp.local = local;
      setMyState('choosing');
      renderRoom();
      roomPick();
      toast('Canción elegida: ' + s.meta.name + '. Elige tu instrumento.');
    } else {
      mp.lastPct = -1;
      setMyState('downloading', { pct: 0 });
      room.send({ t: 'need' });
      toast('Recibiendo ' + s.meta.name + ' del anfitrión…');
    }
  }

  async function findLocal(s) {
    if (s.meta.builtin) return GH.SAMPLE_SONG;
    const list = await GH.store.listSongs().catch(() => []);
    const byId = list.find((x) => x.id === s.meta.id);
    if (byId) return byId;
    const norm = (x) => [x.artist, x.name, x.charter].map((v) => (v || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
    for (const cand of list.filter((x) => norm(x) === norm(s.meta))) {
      if (!s.hash) return cand;
      const files = await GH.store.getFiles(cand.id).catch(() => null);
      if (files && (await GH.notesHash(files)) === s.hash) return cand;
    }
    return null;
  }

  function onRoomProgress(pct) {
    const step = Math.floor(pct * 10);
    if (step !== mp.lastPct) { mp.lastPct = step; setMyState('downloading', { pct }); }
  }

  async function onRoomReceived(song) {
    if (!mp.song || song.id !== mp.song.meta.id) return;
    try {
      await GH.store.addSong(song);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) { toast('No se pudo guardar la canción: ' + (e.message || e), 6000); return; }
    const { files, ...meta } = song;
    mp.local = meta;
    setMyState('choosing');
    refresh();
    renderRoom();
    toast('Canción recibida y guardada en tu biblioteca. Elige tu instrumento.');
    roomPick();
  }

  async function roomStart() {
    if (!room || !room.isHost || !mp.prepared) return;
    $('room-go').disabled = true;
    const lead = await room.startAll(1500);
    scheduleRound(lead);
  }

  function scheduleRound(ms) {
    if (!mp.prepared) { toast('Tu canción no estaba lista.'); return; }
    hideRoom();
    hide('detail');
    mp.scores = {};
    mp.inRound = true;
    setTimeout(() => {
      if (!room || !mp.prepared) return;
      setMyState('playing');
      const pl = mp.prepared;
      mp.prepared = null;
      enterGame(pl);
    }, ms);
  }

  function roomTick() {
    const now = performance.now();
    if (now - mp.lastSent > 300 && room) {
      mp.lastSent = now;
      room.send({ t: 'score', id: room.myId, score: Math.round(game.score) });
    }
    if (now - mp.lastHud > 250) { mp.lastHud = now; renderHud(); }
  }

  function standings() {
    if (!room) return [];
    const rows = room.players.map((p) => {
      const mine = p.id === room.myId;
      const sc = mine ? { score: game ? Math.round(game.score) : 0, final: game && game.finished } : mp.scores[p.id] || { score: 0 };
      return { name: p.name, me: mine, score: sc.score || 0, final: sc.final, quit: sc.quit };
    });
    return rows.sort((a, b) => b.score - a.score);
  }

  function renderHud() {
    const ol = $('mp-hud');
    ol.innerHTML = '';
    for (const r of standings()) {
      const li = document.createElement('li');
      li.className = r.me ? 'me' : '';
      li.innerHTML = '<span></span><b></b>';
      li.firstChild.textContent = r.name;
      li.lastChild.textContent = r.score.toLocaleString('es');
      ol.appendChild(li);
    }
  }

  function roomFinish(r) {
    room && room.send({ t: 'final', id: room.myId, score: r.score, acc: r.accuracy, stars: r.stars });
    setMyState('done');
    renderRank();
  }

  function renderRank() {
    const ol = $('r-room');
    if (!room || ol.hidden && !mp.inRound) return;
    const rows = standings();
    ol.innerHTML = '';
    const allDone = rows.every((r) => r.final || r.quit);
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = (r.me ? 'me ' : '') + (i === 0 && allDone ? 'win' : '');
      li.innerHTML = '<span></span><b></b>';
      li.firstChild.textContent = (i === 0 && allDone ? '🏆 ' : (i + 1) + '. ') + r.name;
      li.lastChild.textContent = r.quit ? 'abandonó' : r.final ? r.score.toLocaleString('es') : 'tocando… ' + r.score.toLocaleString('es');
      ol.appendChild(li);
    });
  }

  function endRound() {
    mp.inRound = false;
    $('mp-hud').hidden = true;
    if (room) { setMyState(mp.local ? 'choosing' : 'lobby'); }
  }

  function roomLinkText() {
    return '¡Toca conmigo en Frets! Entra a mi sala: ' + room.link;
  }

  function bindRoom() {
    $('btn-multi').onclick = () => openRoomSheet();
    $('room-create').onclick = createRoom;
    $('room-join').onclick = () => joinRoom();
    $('room-code').onkeydown = (e) => { if (e.key === 'Enter') joinRoom(); };
    $('room-close').onclick = hideRoom;
    $('room-hide').onclick = hideRoom;
    $('room-leave').onclick = leaveRoom;
    $('room-pill').onclick = showRoom;
    $('room-pick').onclick = roomPick;
    $('room-go').onclick = roomStart;
    $('room-wa').onclick = () => { window.open('https://wa.me/?text=' + encodeURIComponent(roomLinkText()), '_blank'); };
    $('room-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(room.link); toast('Link copiado.'); }
      catch (e) { toast(room.link, 8000); }
    };
    const fromHash = () => {
      const m = /sala=([A-Za-z0-9]{5})/.exec(location.hash);
      if (m && !room) openRoomSheet(m[1].toUpperCase());
    };
    window.addEventListener('hashchange', fromHash);
    fromHash();
  }

  // ---------- arranque ----------
  function openTab(tab) {
    $('panel-setlist').hidden = tab !== 'setlist';
    $('panel-import').hidden = tab !== 'import';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
    $('paper').scrollTop = 0;
  }

  function openTouchDiag() {
    const root = $('touch-diag'), rows = $('td-rows'), info = $('td-info'), dot = $('td-dot');
    rows.innerHTML = '';
    for (let y = 0; y < innerHeight; y += 100) { const b = document.createElement('b'); b.style.top = y + 2 + 'px'; b.textContent = 'y=' + y; rows.appendChild(b); }
    const vv = window.visualViewport;
    const show = (e) => {
      if (e) { dot.style.display = 'block'; dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }
      info.textContent = 'Toca la pantalla: el círculo debe quedar justo bajo tu dedo.\n' +
        (e ? 'clientX/Y: ' + Math.round(e.clientX) + ' / ' + Math.round(e.clientY) + '\n' : '') +
        'innerW/H: ' + innerWidth + ' / ' + innerHeight + '\n' +
        'scrollX/Y: ' + Math.round(scrollX) + ' / ' + Math.round(scrollY) + '\n' +
        (vv ? 'visualViewport offsetTop/pageTop/scale/height: ' + [vv.offsetTop, vv.pageTop, vv.scale, vv.height].map((n) => +n.toFixed(1)).join(' / ') + '\n' : '') +
        'screen: ' + window.screen.width + 'x' + window.screen.height + ' dpr ' + devicePixelRatio + '\n' +
        '--safe-top: ' + getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
    };
    root.onpointerdown = root.onpointermove = (e) => { if (e.target.id !== 'td-close') show(e); };
    dot.style.display = 'none';
    show(null);
    root.hidden = false;
  }

  function init() {
    safeTop();
    window.addEventListener('resize', safeTop);
    document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => openTab(t.dataset.tab); });
    $('btn-home').onclick = () => screen('home');
    document.addEventListener('keydown', (e) => {
      if (!$('home').classList.contains('active')) return;
      const items = Array.from(document.querySelectorAll('.hm'));
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { items[(i + 1) % items.length].focus(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
    });
    $('home-menu').onclick = (e) => {
      const b = e.target.closest('.hm');
      if (!b) return;
      if (b.dataset.soon) { toast(b.dataset.soon + ': todavía no está disponible.'); return; }
      if (b.dataset.go) { openTab(b.dataset.go); screen('menu'); refresh(); }
    };
    $('in-folder').onchange = (e) => { handleImport(e.target.files); e.target.value = ''; };
    $('in-files').onchange = (e) => { handleImport(e.target.files); e.target.value = ''; };
    if (!('webkitdirectory' in document.createElement('input'))) $('lbl-folder').hidden = true;
    $('search').oninput = renderList;
    $('d-close').onclick = () => hide('detail');
    $('detail').onclick = (e) => { if (e.target.id === 'detail') hide('detail'); };
    $('d-play').onclick = () => (forRoom(current.song) ? roomReady() : startGame());
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
    // pointerdown responde al instante y no depende de que iOS genere el "click"
    for (const id of ['btn-pause']) {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); pauseGame(); });
      b.onclick = pauseGame;
    }
    $('btn-sp').onclick = () => game && game.activateSP();
    $('p-resume').onclick = pauseGuard(resumeGame);
    $('p-restart').onclick = pauseGuard(() => { if (performance.now() < startLockUntil) return; hide('pause'); audio.resume().then(() => game.restart()); });
    $('p-quit').onclick = pauseGuard(quitGame);
    $('r-again').onclick = () => { hide('results'); audio.unlock(); enterGame(game.play); };
    $('r-menu').onclick = quitGame;
    bindRoom();
    $('btn-settings').onclick = () => { bindSettings(); renderBandList(); show('settings'); };
    $('s-close').onclick = () => hide('settings');
    $('s-calibrate').onclick = startCalibration;
    $('s-touchdiag').onclick = openTouchDiag;
    $('td-close').onclick = () => { $('touch-diag').hidden = true; };
    // La página nunca debe desplazarse: en iPhone un desplazamiento invisible descuadra los toques.
    const unscroll = () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); };
    window.addEventListener('scroll', unscroll, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('scroll', unscroll);
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
