// Motor de juego: carriles táctiles, ventanas de acierto, puntuación y dibujo de la autopista.
(function (G) {
  const GH = (G.GH = G.GH || {});
  const OPEN_COLOR = '#a855f7';
  const SP_COLOR = '#7dd3fc';
  const KEYS = { a: 0, s: 1, d: 2, f: 3, g: 4, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, h: 0, j: 1, k: 2, l: 3, 'ñ': 4, ';': 4 };

  class Game {
    constructor(opts) {
      this.canvas = opts.canvas;
      this.ctx2d = this.canvas.getContext('2d');
      this.audio = opts.audio;
      this.settings = opts.settings;
      this.play = opts.playable;
      this.notes = this.play.notes;
      this.tm = this.play.tempoMap;
      this.onEnd = opts.onEnd;
      this.onPauseRequest = opts.onPauseRequest;
      this.audioDelay = opts.audioDelay || 0;
      this.stage3d = opts.stage3d || null;
      this.win = (this.settings.windowMs || 90) / 1000;
      this._pauseTotal = 0; // ms que el juego pasó en pausa (no cuentan para las animaciones)
      this._pausedPerf = 0;
      this.look = 1.6 / (this.settings.noteSpeed || 1);
      this.reset();

      this.pointers = new Map(); // pointerId -> carril
      this.laneDown = [0, 0, 0, 0, 0];
      this.laneDownAt = [-1e9, -1e9, -1e9, -1e9, -1e9];
      this._bind();
      this.resize();
    }

    reset() {
      for (const n of this.notes) {
        n.hit = false; n.missed = false; n.lanesHit = 0; n.holding = false; n.sustainScored = 0; n.dropped = false;
      }
      this.idx = 0;
      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.hitGroups = 0;
      this.missGroups = 0;
      this.energy = 0;
      this.spActive = false;
      this.brokenPhrases = new Set();
      this.effects = [];
      this.messages = [];
      this.lastTick = null;
      this.finished = false;
      if (this.paused) this._pauseTotal += performance.now() - this._pausedPerf;
      this.paused = false;
      this.resuming = false;
      this.leadMuted = false;
      const last = this.notes.length ? Math.max(...this.notes.map((n) => n.endTime)) : 0;
      this.lastNoteEnd = last;
      this.totalGroups = this.notes.length;
      this.baseScore = this.notes.reduce((s, n) => s + 50 * n.gems + (n.lenTicks / this.tm.res) * 25, 0);
      this.sectionIdx = -1;
      this.rock = 0.5;
      this.rockShown = 0.5;
    }

    get endTime() {
      const a = this.audio.duration + this.audioDelay;
      return Math.max(this.lastNoteEnd + 2.5, Math.min(a, this.lastNoteEnd + 6));
    }

    start(fromTime) {
      this.audio.start(2.0, this.audioDelay, fromTime);
      this.running = true;
      this.raf = requestAnimationFrame(this._frame);
    }

    destroy() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.audio.stop();
      this._unbind();
    }

    // Reloj de las animaciones (ms): igual que performance.now() pero detenido mientras el juego está en pausa.
    now() { return (this.paused ? this._pausedPerf : performance.now()) - this._pauseTotal; }

    // En pausa se congela todo: se paran las pistas y el reloj de la canción queda fijo en `pausedAt`.
    // `keepCtx`: no suspende el contexto de audio (en multijugador se reanuda sin un toque, y iOS podría no dejarlo).
    pause(keepCtx) {
      if (this.paused || this.finished) return;
      this.audio.tick();
      this.pausedAt = this.audio.songTime();
      this._pausedPerf = performance.now();
      this.paused = true;
      this.resuming = false;
      this.audio.stop();
      if (!keepCtx) this.audio.pause();
      this.pointers.clear();
      this.laneDown = [0, 0, 0, 0, 0];
    }
    resume() {
      if (!this.paused || this.resuming) return;
      this.resuming = true;
      // Se espera a que el contexto de audio vuelva a correr antes de reprogramar las pistas desde `pausedAt`.
      Promise.resolve(this.audio.resume()).catch(() => {}).then(() => {
        if (!this.resuming || !this.paused || !this.running) return;
        this.resuming = false;
        this.audio.startAt(this.pausedAt, this.audioDelay);
        if (this.leadMuted) this.audio.setLeadMuted(true);
        this._pauseTotal += performance.now() - this._pausedPerf;
        this.paused = false;
      });
    }

    restart() {
      this.audio.stop();
      this.reset();
      this.audio.start(2.0, this.audioDelay);
    }

    // ---------------- entrada ----------------
    _bind() {
      const c = this.canvas;
      this._pd = (e) => {
        e.preventDefault();
        if (this.paused) return;
        // Franja superior (botones de pausa y poder estelar): nunca cuenta como nota; un toque cerca de la
        // esquina del botón de pausa pausa el juego aunque el dedo caiga un poco fuera del círculo.
        const sx = (this.safeInsetLeft || 0) + 84, sy = (this.safeTop || 0) + 140;
        if (e.clientX < sx && e.clientY < sy) {
          if (e.clientY < (this.safeTop || 0) + 76 && this.onPauseRequest) this.onPauseRequest();
          return;
        }
        const lane = this.laneAt(e.clientX);
        this.pointers.set(e.pointerId, lane);
        try { c.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
        this.press(lane, this.audio.songTimeAt(e.timeStamp || performance.now()), false);
      };
      this._pm = (e) => {
        if (!this.pointers.has(e.pointerId) || this.paused) return;
        const lane = this.laneAt(e.clientX);
        const old = this.pointers.get(e.pointerId);
        if (lane !== old) {
          this.pointers.set(e.pointerId, lane);
          this.laneDown[old] = Math.max(0, this.laneDown[old] - 1);
          // Deslizar el dedo a otro carril cuenta para notas HOPO / tap.
          this.press(lane, this.audio.songTimeAt(e.timeStamp || performance.now()), true);
        }
      };
      this._pu = (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        const lane = this.pointers.get(e.pointerId);
        this.pointers.delete(e.pointerId);
        this.laneDown[lane] = Math.max(0, this.laneDown[lane] - 1);
      };
      this._kd = (e) => {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        if (k === 'escape' || k === 'p') { this.onPauseRequest && this.onPauseRequest(); return; }
        if (k === ' ' || k === 'enter') { this.activateSP(); e.preventDefault(); return; }
        if (KEYS[k] == null || this.paused) return;
        let lane = KEYS[k];
        if (this.settings.lefty) lane = 4 - lane;
        this.press(lane, this.audio.songTimeAt(performance.now()), false);
      };
      this._ku = (e) => {
        const k = e.key.toLowerCase();
        if (KEYS[k] == null) return;
        let lane = KEYS[k];
        if (this.settings.lefty) lane = 4 - lane;
        this.laneDown[lane] = Math.max(0, this.laneDown[lane] - 1);
      };
      this._rs = () => this.resize();
      c.addEventListener('pointerdown', this._pd);
      c.addEventListener('pointermove', this._pm);
      c.addEventListener('pointerup', this._pu);
      c.addEventListener('pointercancel', this._pu);
      window.addEventListener('keydown', this._kd);
      window.addEventListener('keyup', this._ku);
      window.addEventListener('resize', this._rs);
      this._frame = this._frame.bind(this);
    }
    _unbind() {
      const c = this.canvas;
      c.removeEventListener('pointerdown', this._pd);
      c.removeEventListener('pointermove', this._pm);
      c.removeEventListener('pointerup', this._pu);
      c.removeEventListener('pointercancel', this._pu);
      window.removeEventListener('keydown', this._kd);
      window.removeEventListener('keyup', this._ku);
      window.removeEventListener('resize', this._rs);
    }

    laneAt(clientX) {
      const r = this.canvas.getBoundingClientRect();
      const x = clientX - r.left;
      const l = this.cx - this.halfW;
      let lane = Math.floor(((x - l) / (2 * this.halfW)) * 5);
      lane = Math.max(0, Math.min(4, lane));
      return this.settings.lefty ? 4 - lane : lane;
    }

    press(lane, t, slide) {
      this.laneDown[lane]++;
      this.laneDownAt[lane] = t;
      this.effects.push({ type: 'press', lane, t0: this.now() });
      const W = this.win;
      let best = null;
      for (let i = this.idx; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.time - t > W) break;
        if (n.hit || n.missed || t - n.time > W) continue;
        if (slide && !(n.hopo || n.tap)) continue;
        if (n.open || (n.lanes.includes(lane) && !(n.lanesHit & (1 << lane)))) { best = n; break; }
      }
      if (!best) return;
      if (best.open) return this.hitNote(best, t);
      best.lanesHit |= 1 << lane;
      // Otros dedos que ya bajaron dentro de la ventana también cuentan para el acorde.
      for (const l of best.lanes) {
        if (this.laneDown[l] > 0 && this.laneDownAt[l] >= best.time - W) best.lanesHit |= 1 << l;
      }
      if (best.lanes.every((l) => best.lanesHit & (1 << l))) this.hitNote(best, t);
    }

    get multiplier() {
      const m = Math.min(4, 1 + Math.floor(this.combo / 10));
      return this.spActive ? m * 2 : m;
    }

    hitNote(n, t) {
      n.hit = true;
      this.combo++;
      this.hitGroups++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.score += 50 * n.gems * this.multiplier;
      this.rock = Math.min(1, this.rock + 0.025);
      if (n.len > 0) n.holding = true;
      if (this.leadMuted) { this.leadMuted = false; this.audio.setLeadMuted(false); }
      const now = this.now();
      if (n.open) this.effects.push({ type: 'hit', lane: -1, t0: now, sp: n.phrase >= 0 });
      else for (const l of n.lanes) this.effects.push({ type: 'hit', lane: l, t0: now });
      if (n.phraseEnd && !this.brokenPhrases.has(n.phrase)) {
        this.energy = Math.min(1, this.energy + 0.25);
        this.message(this.energy >= 0.5 && !this.spActive ? '¡Poder estelar listo!' : '+ Poder estelar', SP_COLOR);
      }
      if (this.combo > 0 && this.combo % 50 === 0) this.message('¡Racha de ' + this.combo + ' notas!', '#fde047');
    }

    missNote(n) {
      n.missed = true;
      this.missGroups++;
      this.rock = Math.max(0, this.rock - 0.07);
      if (n.phrase >= 0) this.brokenPhrases.add(n.phrase);
      if (this.combo >= 20) this.message('Racha perdida', '#f87171');
      this.combo = 0;
      if (this.audio.hasLeadStem) {
        if (!this.leadMuted) { this.leadMuted = true; this.audio.setLeadMuted(true); }
      }
      if (this.settings.missSound) this.audio.missSound();
      if (this.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(25); } catch (e) { /* sin vibración */ } }
    }

    activateSP() {
      if (this.spActive || this.energy < 0.5 || this.paused) return;
      this.spActive = true;
      this.message('¡PODER ESTELAR!', SP_COLOR);
    }

    message(text, color) { this.messages.push({ text, color, t0: this.now() }); }

    // ---------------- lógica por cuadro ----------------
    update(t) {
      const W = this.win;
      for (let i = this.idx; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.time > t - W) break;
        if (!n.hit && !n.missed) this.missNote(n);
      }
      while (this.idx < this.notes.length) {
        const n = this.notes[this.idx];
        if ((n.hit || n.missed) && n.time < t - W && !n.holding) this.idx++;
        else break;
      }
      // Sostenidos
      const tick = this.tm.timeToTick(t);
      for (let i = Math.max(0, this.idx - 64); i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.time > t) break;
        if (!n.holding) continue;
        const held = n.open ? this.laneDown.some((x) => x > 0) : n.lanes.some((l) => this.laneDown[l] > 0);
        const endTick = n.tick + n.lenTicks;
        const cur = Math.min(tick, endTick);
        const beats = Math.max(0, (cur - n.tick) / this.tm.res);
        const pts = beats * 25;
        if (pts > n.sustainScored) { this.score += (pts - n.sustainScored) * this.multiplier; n.sustainScored = pts; }
        if (t >= n.endTime) n.holding = false;
        else if (!held) {
          n.holding = false;
          if (n.endTime - t > 0.12) n.dropped = true;
        }
      }
      // Poder estelar: dura 8 compases de 4/4 con la barra llena
      if (this.lastTick != null && this.spActive && tick > this.lastTick) {
        this.energy -= (tick - this.lastTick) / this.tm.res / 32;
        if (this.energy <= 0) { this.energy = 0; this.spActive = false; }
      }
      this.lastTick = tick;
      // Secciones
      const secs = this.play.sections;
      while (this.sectionIdx + 1 < secs.length && secs[this.sectionIdx + 1].time <= t) {
        this.sectionIdx++;
        this.sectionShownAt = this.now();
      }
      if (!this.finished && t > this.endTime) {
        this.finished = true;
        this.running = false;
        this.audio.stop();
        this.onEnd && this.onEnd(this.results());
      }
    }

    results() {
      const ratio = this.baseScore ? this.score / this.baseScore : 0;
      const thresholds = [0.1, 0.5, 1.0, 2.0, 2.8, 3.6];
      let stars = 0;
      thresholds.forEach((th, i) => { if (ratio >= th) stars = i + 1; });
      return {
        score: Math.round(this.score),
        accuracy: this.totalGroups ? this.hitGroups / this.totalGroups : 0,
        hit: this.hitGroups, total: this.totalGroups, maxCombo: this.maxCombo,
        stars: Math.min(stars, 6),
      };
    }

    _frame() {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this._frame);
      this.audio.tick();
      const t = this.paused ? this.pausedAt : this.audio.songTime();
      if (!this.paused) this.update(t);
      if (this.running || this.finished) this.draw(t);
    }

    // ---------------- dibujo ----------------
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = this.canvas.getBoundingClientRect();
      this.W = r.width; this.H = r.height;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      const portrait = this.H >= this.W;
      this.cx = this.W / 2;
      this.hitY = this.H * (portrait ? 0.85 : 0.84);
      this.topY = this.H * (portrait ? (this.stage3d ? 0.36 : 0.27) : (this.stage3d ? 0.27 : 0.2));
      this.halfW = Math.min(this.W * 0.44, this.H * (portrait ? 0.4 : 0.5));
      this.farS = 0.2;
      this.horizonY = (this.topY - this.farS * this.hitY) / (1 - this.farS);
      if (!this.renderer) this.renderer = new GH.Renderer(this);
      this.renderer.resize(dpr);
      if (this.stage3d) this.stage3d.resize(this.W, this.H, this);
    }

    proj(dt) {
      const z = (dt / this.look) * (1 / this.farS - 1);
      const s = 1 / (1 + Math.max(-0.6, z));
      return { s, y: this.horizonY + (this.hitY - this.horizonY) * s };
    }
    laneX(lane, s) {
      const vis = this.settings.lefty ? 4 - lane : lane;
      return this.cx + (-0.8 + vis * 0.4) * this.halfW * s;
    }

    draw(t) {
      this.rockShown += (this.rock - this.rockShown) * 0.12;
      if (this.stage3d) this.stage3d.update(t, this);
      this.renderer.draw(t);
    }
  }

  GH.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
