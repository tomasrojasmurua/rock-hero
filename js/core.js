// Núcleo compartido: espacio de nombres, mapa de tempo y construcción de notas jugables.
(function (G) {
  const GH = (G.GH = G.GH || {});

  GH.LANE_COLORS = ['#22c55e', '#ef4444', '#facc15', '#3b82f6', '#f97316'];
  GH.OPEN = 7; // carril especial: nota abierta (guitarra) o bombo (batería)

  GH.INSTRUMENTS = {
    guitar: 'Guitarra',
    coop: 'Guitarra coop',
    rhythm: 'Rítmica',
    bass: 'Bajo',
    keys: 'Teclado',
    drums: 'Batería',
  };
  GH.DIFFS = ['expert', 'hard', 'medium', 'easy'];
  GH.DIFF_LABELS = { expert: 'Experto', hard: 'Difícil', medium: 'Medio', easy: 'Fácil' };

  GH.stripTags = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim();

  class TempoMap {
    // tempos: [{tick, bpm}], offset: segundos que se suman a todos los tiempos
    constructor(resolution, tempos, timeSigs, offset) {
      this.res = resolution || 192;
      this.offset = offset || 0;
      const t = (tempos || []).filter((x) => x.bpm > 0).sort((a, b) => a.tick - b.tick);
      if (!t.length || t[0].tick > 0) t.unshift({ tick: 0, bpm: 120 });
      let time = 0;
      this.tempos = t.map((x, i) => {
        if (i > 0) time += ((x.tick - t[i - 1].tick) / this.res) * (60 / t[i - 1].bpm);
        return { tick: x.tick, bpm: x.bpm, time };
      });
      const ts = (timeSigs || []).slice().sort((a, b) => a.tick - b.tick);
      if (!ts.length || ts[0].tick > 0) ts.unshift({ tick: 0, num: 4, den: 4 });
      this.timeSigs = ts;
    }
    _seg(arr, key, v) {
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (arr[mid][key] <= v) lo = mid; else hi = mid - 1;
      }
      return arr[lo];
    }
    tickToTime(tick) {
      const s = this._seg(this.tempos, 'tick', tick);
      return s.time + ((tick - s.tick) / this.res) * (60 / s.bpm) + this.offset;
    }
    timeToTick(time) {
      time -= this.offset;
      const s = this._seg(this.tempos, 'time', time);
      return s.tick + ((time - s.time) * s.bpm / 60) * this.res;
    }
    // Líneas de pulso entre dos tiempos: [{time, measure:bool}]
    beatLines(t0, t1) {
      const out = [];
      const startTick = Math.max(0, this.timeToTick(t0));
      const endTick = this.timeToTick(t1);
      for (let i = 0; i < this.timeSigs.length; i++) {
        const ts = this.timeSigs[i];
        const next = this.timeSigs[i + 1] ? this.timeSigs[i + 1].tick : Infinity;
        if (next <= startTick) continue;
        if (ts.tick > endTick) break;
        const step = this.res * 4 / (ts.den || 4);
        let k = Math.max(0, Math.ceil((startTick - ts.tick) / step));
        for (let tick = ts.tick + k * step; tick < next && tick <= endTick; k++, tick = ts.tick + k * step) {
          out.push({ time: this.tickToTime(tick), measure: k % (ts.num || 4) === 0 });
        }
      }
      return out;
    }
  }
  GH.TempoMap = TempoMap;

  const inRanges = (ranges, tick) => {
    for (const r of ranges) if (tick >= r[0] && tick < r[1]) return true;
    return false;
  };

  // Convierte una pista cruda (de .chart o .mid) en grupos de notas jugables.
  // track: {notes:[{tick,lane,len}], sp:[[ini,fin]], flipTicks:Set, tapTicks:Set, hopoRanges, strumRanges, tapRanges}
  GH.buildPlayable = function (song, instrument, diff, opts) {
    opts = opts || {};
    const track = song.tracks[instrument] && song.tracks[instrument][diff];
    if (!track) throw new Error('Esa dificultad no existe en esta canción');
    const tm = new TempoMap(song.resolution, song.tempos, song.timeSigs, song.offset);
    const res = tm.res;
    const isDrums = instrument === 'drums';
    const hopoThreshold = opts.hopoThreshold || (opts.eighthHopo ? res / 2 : Math.round((65 / 192) * res));

    const sorted = track.notes.slice().sort((a, b) => a.tick - b.tick || a.lane - b.lane);
    const groups = [];
    for (const n of sorted) {
      let g = groups[groups.length - 1];
      if (!g || g.tick !== n.tick) {
        g = { tick: n.tick, lanes: [], open: false, lenTicks: 0 };
        groups.push(g);
      }
      if (n.lane === GH.OPEN) g.open = true;
      else if (!g.lanes.includes(n.lane)) g.lanes.push(n.lane);
      if (!isDrums) g.lenTicks = Math.max(g.lenTicks, n.len || 0);
    }

    const flip = track.flipTicks || new Set();
    const taps = track.tapTicks || new Set();
    const sp = (track.sp || []).slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    let prev = null;
    for (const g of groups) {
      // En guitarra, una nota abierta junto a trastes se trata como acorde normal.
      const open = isDrums ? g.open && !g.lanes.length : g.open && !g.lanes.length;
      const lanes = open ? [] : g.lanes.slice();
      if (isDrums && g.open && g.lanes.length) {
        // Batería: el bombo junto a otros golpes se juega como un golpe más en cualquier carril;
        // lo separamos como nota abierta propia en el mismo instante.
        out.push(makeGroup(g.tick, [], true, 0, false, false));
      }
      let hopo = false, tap = false;
      if (!isDrums) {
        const single = lanes.length === 1 || open;
        if (prev && single) {
          const gap = g.tick - prev.tick;
          const sameAsPrev = open ? prev.open : prev.lanes.includes(lanes[0]);
          hopo = gap <= hopoThreshold && !sameAsPrev;
        }
        if (flip.has(g.tick)) hopo = !hopo;
        if (track.hopoRanges && inRanges(track.hopoRanges, g.tick)) hopo = true;
        if (track.strumRanges && inRanges(track.strumRanges, g.tick)) hopo = false;
        if (taps.has(g.tick) || (track.tapRanges && inRanges(track.tapRanges, g.tick))) tap = !open;
        if (!prev && !tap) hopo = false;
      }
      out.push(makeGroup(g.tick, lanes, open, g.lenTicks, hopo, tap));
      prev = { tick: g.tick, lanes, open };
    }

    function makeGroup(tick, lanes, open, lenTicks, hopo, tap) {
      const time = tm.tickToTime(tick);
      const len = lenTicks > 0 ? tm.tickToTime(tick + lenTicks) - time : 0;
      let phrase = -1;
      for (let i = 0; i < sp.length; i++) {
        const end = sp[i][1] > sp[i][0] ? sp[i][1] : sp[i][0] + 1;
        if (tick >= sp[i][0] && tick < end) { phrase = i; break; }
        if (sp[i][0] > tick) break;
      }
      return {
        tick, time, len, endTime: time + len, lenTicks, lanes, open, hopo, tap, phrase,
        gems: open ? 1 : lanes.length,
        // estado de juego
        hit: false, missed: false, lanesHit: 0, holding: false, sustainDone: false, sustainScored: 0,
      };
    }

    // Última nota de cada frase de estrella: al acertarla completa la frase.
    const lastOfPhrase = new Map();
    out.forEach((g, i) => { if (g.phrase >= 0) lastOfPhrase.set(g.phrase, i); });
    out.forEach((g, i) => { g.phraseEnd = g.phrase >= 0 && lastOfPhrase.get(g.phrase) === i; });

    const sections = (song.sections || []).map((s) => ({ time: tm.tickToTime(s.tick), name: s.name }));
    return { notes: out, tempoMap: tm, sections, instrument, diff };
  };
})(typeof window !== 'undefined' ? window : globalThis);
