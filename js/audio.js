// Motor de audio: decodifica las pistas (stems) y las reproduce sincronizadas con Web Audio.
(function (G) {
  const GH = (G.GH = G.GH || {});

  const LEAD_STEMS = {
    guitar: /^guitar\./, coop: /^guitar\./, rhythm: /^rhythm\./, bass: /^bass\./,
    keys: /^keys\./, drums: /^drums(_\d)?\./,
  };

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.backing = [];
      this.lead = [];
      this.sources = [];
      this.startCtx = 0;
      this.offset = 0; // calibración (s)
      this.anchorCtx = null;
      this.anchorPerf = 0;
      this.duration = 0;
    }

    // Debe llamarse dentro de un gesto del usuario (toque/clic).
    unlock() {
      if (!this.ctx) {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* opcional */ }
        const AC = G.AudioContext || G.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.backGain = this.ctx.createGain();
        this.leadGain = this.ctx.createGain();
        this.backGain.connect(this.master);
        this.leadGain.connect(this.master);
        // Buffer silencioso: desbloquea el audio en iOS
        const b = this.ctx.createBuffer(1, 1, 22050);
        const s = this.ctx.createBufferSource();
        s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
      return this.ctx;
    }

    setVolume(v) { if (this.master) this.master.gain.value = v; }

    decode(arrayBuffer) {
      return new Promise((resolve, reject) => {
        const p = this.ctx.decodeAudioData(arrayBuffer, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    }

    async loadStems(files, instrument, onProgress) {
      this.unlock();
      const names = GH.audioStems(files);
      // Si existe song.* + pistas separadas se usan todas; si solo hay "guitar.ogg" se toma como pista principal.
      const leadRe = LEAD_STEMS[instrument];
      this.backing = [];
      this.lead = [];
      let i = 0;
      for (const n of names) {
        onProgress && onProgress('Decodificando audio ' + (++i) + '/' + names.length + '…');
        let buf;
        try { buf = await this.decode(await files[n].arrayBuffer()); }
        catch (e) { throw new Error('No se pudo decodificar ' + n + '. Tu navegador quizá no soporta ese formato (prueba con Chrome).'); }
        if (leadRe && leadRe.test(n) && names.length > 1) this.lead.push(buf); else this.backing.push(buf);
      }
      this.duration = Math.max(0, ...this.backing.concat(this.lead).map((b) => b.duration));
    }

    setBuffers(backing, lead) {
      this.backing = backing || [];
      this.lead = lead || [];
      this.duration = Math.max(0, ...this.backing.concat(this.lead).map((b) => b.duration));
    }

    get hasLeadStem() { return this.lead.length > 0; }

    // Programa el audio para que el instante 0 de la canción ocurra dentro de `leadIn` segundos.
    // `audioDelay` (s) retrasa el audio respecto a las notas (delay de song.ini).
    start(leadIn, audioDelay, fromTime) {
      this.stop();
      const ctx = this.ctx;
      fromTime = fromTime || 0;
      this.startCtx = ctx.currentTime + leadIn - fromTime;
      this.leadGain.gain.value = 1;
      const when = this.startCtx + (audioDelay || 0);
      const mk = (buf, dest) => {
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.connect(dest);
        const t = Math.max(ctx.currentTime, when);
        const off = Math.max(0, t - when);
        if (off < buf.duration) s.start(t, off);
        this.sources.push(s);
      };
      this.backing.forEach((b) => mk(b, this.backGain));
      this.lead.forEach((b) => mk(b, this.leadGain));
      this.anchorCtx = null;
    }

    stop() {
      for (const s of this.sources) { try { s.stop(); } catch (e) { /* ya parado */ } s.disconnect(); }
      this.sources = [];
    }

    pause() { if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend(); }
    resume() { this.anchorCtx = null; if (this.ctx) return this.ctx.resume(); }

    setLeadMuted(m) {
      if (!this.ctx || !this.lead.length) return;
      const g = this.leadGain.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setTargetAtTime(m ? 0.0 : 1, this.ctx.currentTime, 0.015);
    }

    _rawCtxTime() {
      const ctx = this.ctx;
      if (ctx.getOutputTimestamp) {
        const ts = ctx.getOutputTimestamp();
        if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
      return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    }

    // Llamar una vez por cuadro: suaviza el reloj de audio (que avanza a saltos).
    tick() {
      if (!this.ctx) return;
      const now = performance.now();
      const raw = this._rawCtxTime();
      if (this.anchorCtx == null || this.ctx.state !== 'running') { this.anchorCtx = raw; this.anchorPerf = now; return; }
      const predicted = this.anchorCtx + (now - this.anchorPerf) / 1000;
      const err = raw - predicted;
      this.anchorCtx = Math.abs(err) > 0.04 ? raw : predicted + err * 0.05;
      this.anchorPerf = now;
    }

    songTimeAt(perfTs) {
      if (this.anchorCtx == null) this.tick();
      const running = this.ctx.state === 'running';
      return this.anchorCtx + (running ? (perfTs - this.anchorPerf) / 1000 : 0) - this.startCtx - this.offset;
    }
    songTime() { return this.songTimeAt(performance.now()); }

    missSound() {
      const ctx = this.ctx;
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.16);
    }

    click(when, accent) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = accent ? 1760 : 1320;
      g.gain.setValueAtTime(0.5, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
      o.connect(g); g.connect(this.master);
      o.start(when); o.stop(when + 0.06);
    }
  }

  GH.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
