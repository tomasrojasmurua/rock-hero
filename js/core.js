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

  // Puestos de la banda en el escenario 3D
  GH.BAND_ROLES = [
    { id: 'vocals', label: 'Voz', member: 'Julian Casablancas' },
    { id: 'lead', label: 'Guitarra solista', member: 'Nick Valensi' },
    { id: 'rhythm', label: 'Guitarra rítmica', member: 'Albert Hammond Jr.' },
    { id: 'bass', label: 'Bajo', member: 'Nikolai Fraiture' },
    { id: 'drums', label: 'Batería', member: 'Fabrizio Moretti' },
  ];

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
      // En batería, el bombo junto a un tambor se descarta: en pantalla táctil el bombo se toca
      // con cualquier carril, así que pediría dos toques simultáneos. Queda solo el tambor.
      const open = g.open && !g.lanes.length;
      let lanes = open ? [] : g.lanes.slice();
      // Acordes simplificados: en guitarra, 3+ notas se reducen a las dos de los extremos.
      if (!isDrums && opts.maxChordNotes && lanes.length > opts.maxChordNotes) {
        lanes.sort((a, b) => a - b);
        lanes = [lanes[0], lanes[lanes.length - 1]];
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

  // ---------- dificultades generadas ----------
  // Si una canción no trae Difícil, Medio o Fácil, se crean a partir de la dificultad
  // más alta disponible: menos notas (se priorizan las que caen en el pulso), menos
  // carriles y acordes más pequeños.
  const REDUCE = {
    hard: { minTicks: 1 / 4, minSec: 0.16, chord: 3, map: [0, 1, 2, 3, 4], pads: 2 },
    medium: { minTicks: 1 / 2, minSec: 0.22, chord: 2, map: [0, 1, 2, 3, 3], pads: 1 },
    easy: { minTicks: 1, minSec: 0.38, chord: 1, map: [0, 1, 1, 2, 2], pads: 1 },
  };

  // Dificultades que se pueden jugar: las que trae el archivo y, por debajo de la más
  // alta, las que se generan. Devuelve [{diff, auto}] de más difícil a más fácil.
  GH.playableDiffs = function (have) {
    const top = GH.DIFFS.findIndex((d) => have.includes(d));
    if (top < 0) return [];
    return GH.DIFFS.slice(top).map((d) => ({ diff: d, auto: !have.includes(d) }));
  };

  GH.reduceTrack = function (src, diff, tm) {
    const cfg = REDUCE[diff];
    const res = tm.res;
    const drums = !!src.drums;
    const byTick = new Map();
    for (const n of src.notes) {
      let g = byTick.get(n.tick);
      if (!g) byTick.set(n.tick, (g = { tick: n.tick, lanes: [], open: false, len: 0 }));
      if (n.lane === GH.OPEN) g.open = true;
      else if (!g.lanes.includes(n.lane)) g.lanes.push(n.lane);
      g.len = Math.max(g.len, n.len || 0);
    }
    const groups = [...byTick.values()].sort((a, b) => a.tick - b.tick);
    for (const g of groups) {
      g.time = tm.tickToTime(g.tick);
      const beat = g.tick % res === 0 ? 4 : g.tick % (res / 2) === 0 ? 3 : g.tick % (res / 4) === 0 ? 2 : 1;
      g.weight = beat + (g.lanes.length > 1 ? 0.5 : 0) + (g.len > 0 ? 0.5 : 0);
    }

    // Selección: primero las notas más fuertes, descartando las que quedan demasiado cerca.
    const minTicks = res * cfg.minTicks;
    const order = groups.map((g, i) => i).sort((a, b) => groups[b].weight - groups[a].weight || a - b);
    const keep = new Uint8Array(groups.length);
    const tooClose = (i, j) => Math.abs(groups[i].tick - groups[j].tick) < minTicks ||
      Math.abs(groups[i].time - groups[j].time) < cfg.minSec;
    for (const i of order) {
      let ok = true;
      for (let j = i - 1; j >= 0 && groups[i].tick - groups[j].tick < minTicks * 8; j--) if (keep[j] && tooClose(i, j)) { ok = false; break; }
      for (let j = i + 1; ok && j < groups.length && groups[j].tick - groups[i].tick < minTicks * 8; j++) if (keep[j] && tooClose(i, j)) { ok = false; break; }
      if (ok) keep[i] = 1;
    }
    const kept = groups.filter((g, i) => keep[i]);

    const notes = [];
    kept.forEach((g, k) => {
      const next = kept[k + 1];
      let len = g.len;
      // Un sostenido no puede tapar la nota siguiente.
      if (len && next) len = Math.max(0, Math.min(len, next.tick - g.tick - res / 4));
      if (drums) {
        const pads = g.lanes.slice().sort((a, b) => a - b).slice(0, cfg.pads);
        for (const l of pads) notes.push({ tick: g.tick, lane: l, len: 0 });
        if (g.open && (diff !== 'easy' || !pads.length)) notes.push({ tick: g.tick, lane: GH.OPEN, len: 0 });
        return;
      }
      if (g.open && !g.lanes.length) { notes.push({ tick: g.tick, lane: GH.OPEN, len }); return; }
      let lanes = [...new Set(g.lanes.map((l) => cfg.map[l]))].sort((a, b) => a - b);
      if (lanes.length > cfg.chord) lanes = cfg.chord === 1 ? [lanes[0]] : lanes.slice(0, cfg.chord - 1).concat(lanes[lanes.length - 1]);
      for (const l of lanes) notes.push({ tick: g.tick, lane: l, len });
    });

    return {
      notes, sp: src.sp || [], drums, generated: true,
      flipTicks: new Set(),
      tapTicks: diff === 'hard' ? new Set([...(src.tapTicks || [])].filter((t) => byTick.has(t))) : new Set(),
      hopoRanges: diff === 'hard' ? src.hopoRanges || [] : [],
      strumRanges: src.strumRanges || [],
      tapRanges: diff === 'hard' ? src.tapRanges || [] : [],
    };
  };

  // Completa en la canción ya leída las dificultades que falten, cada una a partir
  // de la inmediatamente más difícil (que puede ser real o generada).
  GH.fillDifficulties = function (song) {
    const tm = new TempoMap(song.resolution, song.tempos, song.timeSigs, song.offset);
    for (const inst of Object.keys(song.tracks)) {
      const t = song.tracks[inst];
      for (const { diff, auto } of GH.playableDiffs(Object.keys(t))) {
        if (!auto) continue;
        const src = t[GH.DIFFS[GH.DIFFS.indexOf(diff) - 1]];
        t[diff] = GH.reduceTrack(src, diff, tm);
      }
    }
    return song;
  };
})(typeof window !== 'undefined' ? window : globalThis);
