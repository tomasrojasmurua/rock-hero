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
      this.win = (this.settings.windowMs || 90) / 1000;
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
      this.paused = false;
      this.leadMuted = false;
      const last = this.notes.length ? Math.max(...this.notes.map((n) => n.endTime)) : 0;
      this.lastNoteEnd = last;
      this.totalGroups = this.notes.length;
      this.baseScore = this.notes.reduce((s, n) => s + 50 * n.gems + (n.lenTicks / this.tm.res) * 25, 0);
      this.sectionIdx = -1;
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

    pause() {
      if (this.paused || this.finished) return;
      this.paused = true;
      this.audio.pause();
      this.pointers.clear();
      this.laneDown = [0, 0, 0, 0, 0];
    }
    resume() {
      if (!this.paused) return;
      this.paused = false;
      this.audio.resume();
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
      this.effects.push({ type: 'press', lane, t0: performance.now() });
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
      if (n.len > 0) n.holding = true;
      if (this.leadMuted) { this.leadMuted = false; this.audio.setLeadMuted(false); }
      const now = performance.now();
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

    message(text, color) { this.messages.push({ text, color, t0: performance.now() }); }

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
        this.sectionShownAt = performance.now();
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
      const t = this.audio.songTime();
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
      this.hitY = this.H * (portrait ? 0.84 : 0.8);
      this.topY = this.H * (portrait ? 0.14 : 0.08);
      this.halfW = Math.min(this.W * 0.48, this.H * (portrait ? 0.42 : 0.62));
      this.farS = 0.25;
      this.horizonY = (this.topY - this.farS * this.hitY) / (1 - this.farS);
    }

    proj(dt) {
      const z = (dt / this.look) * 3;
      const s = 1 / (1 + Math.max(-0.6, z));
      return { s, y: this.horizonY + (this.hitY - this.horizonY) * s };
    }
    laneX(lane, s) {
      const vis = this.settings.lefty ? 4 - lane : lane;
      return this.cx + (-0.8 + vis * 0.4) * this.halfW * s;
    }

    draw(t) {
      const g = this.ctx2d, W = this.W, H = this.H;
      const now = performance.now();
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b0820');
      bg.addColorStop(1, this.spActive ? '#0c2d4a' : '#140a2a');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);

      const near = this.proj(-0.35), far = this.proj(this.look);
      // Autopista
      g.beginPath();
      g.moveTo(this.cx - this.halfW * near.s, near.y);
      g.lineTo(this.cx + this.halfW * near.s, near.y);
      g.lineTo(this.cx + this.halfW * far.s, far.y);
      g.lineTo(this.cx - this.halfW * far.s, far.y);
      g.closePath();
      const hw = g.createLinearGradient(0, far.y, 0, near.y);
      hw.addColorStop(0, this.spActive ? 'rgba(56,189,248,0.05)' : 'rgba(30,27,60,0.2)');
      hw.addColorStop(1, this.spActive ? 'rgba(56,189,248,0.35)' : 'rgba(40,35,80,0.95)');
      g.fillStyle = hw;
      g.fill();
      g.strokeStyle = this.spActive ? '#38bdf8' : '#5b5490';
      g.lineWidth = 2;
      g.stroke();

      // Separadores de carril
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      for (let k = 1; k < 5; k++) {
        const xn = -1 + k * 0.4;
        g.beginPath();
        g.moveTo(this.cx + xn * this.halfW * near.s, near.y);
        g.lineTo(this.cx + xn * this.halfW * far.s, far.y);
        g.stroke();
      }
      // Líneas de pulso
      for (const b of this.tm.beatLines(t - 0.3, t + this.look)) {
        const p = this.proj(b.time - t);
        g.strokeStyle = b.measure ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
        g.lineWidth = b.measure ? 2 : 1;
        g.beginPath();
        g.moveTo(this.cx - this.halfW * p.s, p.y);
        g.lineTo(this.cx + this.halfW * p.s, p.y);
        g.stroke();
      }

      // Notas visibles
      const vis = [];
      for (let i = Math.max(0, this.idx - 64); i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.time - t > this.look) break;
        if (n.endTime < t - 0.4) continue;
        vis.push(n);
      }
      // Sostenidos
      for (const n of vis) {
        if (n.len <= 0) continue;
        const startT = n.hit ? Math.max(n.time, t) : n.time;
        if (n.hit && !n.holding && !n.dropped && t >= n.endTime) continue;
        const a = this.proj(Math.max(-0.35, startT - t)), b = this.proj(Math.min(this.look, n.endTime - t));
        if (b.y >= a.y) continue;
        const live = n.holding || (!n.hit && !n.missed);
        const lanes = n.open ? [-1] : n.lanes;
        for (const l of lanes) {
          const w = n.open ? this.halfW * 0.9 : this.halfW * 0.07;
          const xa = n.open ? this.cx : this.laneX(l, a.s), xb = n.open ? this.cx : this.laneX(l, b.s);
          g.beginPath();
          g.moveTo(xa - w * a.s, a.y); g.lineTo(xa + w * a.s, a.y);
          g.lineTo(xb + w * b.s, b.y); g.lineTo(xb - w * b.s, b.y);
          g.closePath();
          let col = n.open ? OPEN_COLOR : GH.LANE_COLORS[l];
          if (n.phrase >= 0 && !this.brokenPhrases.has(n.phrase)) col = SP_COLOR;
          g.globalAlpha = live ? (n.holding ? 0.95 : 0.75) : 0.25;
          g.fillStyle = live ? col : '#6b7280';
          g.fill();
          g.globalAlpha = 1;
        }
      }

      // Objetivos en la línea de acierto
      const rT = this.halfW * 0.16;
      for (let l = 0; l < 5; l++) {
        const x = this.laneX(l, 1);
        const down = this.laneDown[l] > 0;
        g.beginPath();
        g.ellipse(x, this.hitY, rT, rT * 0.55, 0, 0, Math.PI * 2);
        g.fillStyle = down ? GH.LANE_COLORS[l] : 'rgba(0,0,0,0.55)';
        g.fill();
        g.lineWidth = 4;
        g.strokeStyle = GH.LANE_COLORS[l];
        g.stroke();
        g.beginPath();
        g.ellipse(x, this.hitY, rT * 0.45, rT * 0.25, 0, 0, Math.PI * 2);
        g.fillStyle = down ? '#fff' : 'rgba(255,255,255,0.15)';
        g.fill();
      }

      // Gemas (de lejos a cerca)
      for (let i = vis.length - 1; i >= 0; i--) {
        const n = vis[i];
        if (n.hit) continue;
        const dt = n.time - t;
        if (dt < -0.35) continue;
        const p = this.proj(dt);
        const sp = n.phrase >= 0 && !this.brokenPhrases.has(n.phrase);
        g.globalAlpha = n.missed ? 0.35 : 1;
        if (n.open) {
          const w = this.halfW * 0.92 * p.s, h = rT * 0.32 * p.s;
          g.fillStyle = sp ? SP_COLOR : OPEN_COLOR;
          roundRect(g, this.cx - w, p.y - h, 2 * w, 2 * h, h);
          g.fill();
          if (n.hopo) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
        } else {
          for (const l of n.lanes) this.drawGem(g, this.laneX(l, p.s), p.y, rT * p.s, GH.LANE_COLORS[l], n, sp);
        }
        g.globalAlpha = 1;
      }

      // Efectos
      this.effects = this.effects.filter((e) => now - e.t0 < 300);
      for (const e of this.effects) {
        const k = (now - e.t0) / 300;
        if (e.type === 'hit') {
          if (e.lane < 0) {
            g.globalAlpha = 1 - k;
            g.fillStyle = OPEN_COLOR;
            g.fillRect(this.cx - this.halfW, this.hitY - 6 - 20 * k, this.halfW * 2, 12);
          } else {
            const x = this.laneX(e.lane, 1);
            g.globalAlpha = 1 - k;
            g.strokeStyle = GH.LANE_COLORS[e.lane];
            g.lineWidth = 6 * (1 - k) + 1;
            g.beginPath();
            g.ellipse(x, this.hitY, rT * (1 + k * 1.2), rT * 0.55 * (1 + k * 1.2), 0, 0, Math.PI * 2);
            g.stroke();
            g.fillStyle = '#fff';
            for (let j = 0; j < 6; j++) {
              const ang = -Math.PI * (0.15 + 0.7 * (j / 5));
              g.fillRect(x + Math.cos(ang) * rT * 2 * k, this.hitY + Math.sin(ang) * rT * 3 * k, 3, 3);
            }
          }
          g.globalAlpha = 1;
        }
      }
      // Fuego en sostenidos activos
      for (const n of vis) {
        if (!n.holding) continue;
        const lanes = n.open ? [0, 1, 2, 3, 4] : n.lanes;
        for (const l of lanes) {
          const x = this.laneX(l, 1);
          const fl = 0.6 + 0.4 * Math.sin(now / 40 + l);
          g.fillStyle = 'rgba(255,200,80,' + (0.5 * fl) + ')';
          g.beginPath();
          g.ellipse(x, this.hitY - rT * 0.6, rT * 0.5, rT * (0.8 + 0.4 * fl), 0, 0, Math.PI * 2);
          g.fill();
        }
      }

      this.drawHUD(g, t, now);
    }

    drawGem(g, x, y, r, color, n, sp) {
      const rx = r, ry = r * 0.55;
      g.beginPath();
      g.ellipse(x, y + ry * 0.25, rx, ry, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fill();
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fillStyle = n.tap ? '#111' : sp ? SP_COLOR : color;
      g.fill();
      g.lineWidth = Math.max(1.5, r * 0.14);
      g.strokeStyle = n.tap ? (sp ? SP_COLOR : color) : '#f8fafc';
      g.stroke();
      if (n.tap) {
        g.beginPath();
        g.ellipse(x, y, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
        g.fillStyle = sp ? SP_COLOR : color;
        g.fill();
      } else if (n.hopo) {
        g.beginPath();
        g.ellipse(x, y, rx * 0.5, ry * 0.5, 0, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
      } else {
        g.beginPath();
        g.ellipse(x, y - ry * 0.15, rx * 0.45, ry * 0.3, 0, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fill();
      }
    }

    drawHUD(g, t, now) {
      const W = this.W, H = this.H;
      const fs = Math.max(14, Math.min(W, H) * 0.045);
      g.textBaseline = 'top';
      // Puntuación
      g.font = '800 ' + Math.round(fs * 1.3) + 'px system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillStyle = '#fff';
      g.fillText(Math.round(this.score).toLocaleString('es'), W - 14, 14 + (this.safeTop || 0));
      // Multiplicador y racha
      const m = this.multiplier;
      g.font = '800 ' + Math.round(fs * 1.1) + 'px system-ui, sans-serif';
      g.fillStyle = this.spActive ? SP_COLOR : ['#fff', '#fff', '#fb923c', '#4ade80', '#c084fc'][Math.min(4, m)] || '#fde047';
      g.fillText('x' + m, W - 14, 14 + fs * 1.6 + (this.safeTop || 0));
      g.font = '600 ' + Math.round(fs * 0.8) + 'px system-ui, sans-serif';
      g.fillStyle = '#cbd5e1';
      g.fillText(this.combo + ' racha', W - 14, 14 + fs * 2.9 + (this.safeTop || 0));

      // Barra de multiplicador (10 notas por nivel)
      const step = this.combo >= 30 ? 10 : this.combo % 10;
      const bx = this.cx - this.halfW, bw = this.halfW * 2, by = this.hitY + this.halfW * 0.16 * 0.55 + 16;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(bx, by, bw, 6);
      g.fillStyle = '#fde047';
      g.fillRect(bx, by, bw * (step / 10), 6);
      // Poder estelar
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(bx, by + 10, bw, 6);
      g.fillStyle = SP_COLOR;
      g.fillRect(bx, by + 10, bw * this.energy, 6);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(bx + bw / 2 - 1, by + 9, 2, 8);
      // Progreso
      const prog = Math.max(0, Math.min(1, t / this.endTime));
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(0, H - 4, W, 4);
      g.fillStyle = '#a78bfa';
      g.fillRect(0, H - 4, W * prog, 4);

      // Cuenta atrás
      if (t < 0) {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '800 ' + Math.round(fs * 3) + 'px system-ui, sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.fillText(String(Math.ceil(-t)), this.cx, H * 0.45);
      }
      // Sección
      if (this.sectionIdx >= 0 && now - this.sectionShownAt < 2500) {
        const a = Math.min(1, (2500 - (now - this.sectionShownAt)) / 500);
        g.globalAlpha = a;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '700 ' + Math.round(fs) + 'px system-ui, sans-serif';
        g.fillStyle = '#e9d5ff';
        g.fillText(this.play.sections[this.sectionIdx].name, this.cx, this.topY + fs);
        g.globalAlpha = 1;
      }
      // Mensajes
      this.messages = this.messages.filter((m2) => now - m2.t0 < 1500);
      this.messages.forEach((m2, i) => {
        const k = (now - m2.t0) / 1500;
        g.globalAlpha = 1 - k * k;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '800 ' + Math.round(fs * 1.2) + 'px system-ui, sans-serif';
        g.fillStyle = m2.color;
        g.fillText(m2.text, this.cx, H * 0.38 - i * fs * 1.6 - k * 30);
        g.globalAlpha = 1;
      });
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  GH.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
