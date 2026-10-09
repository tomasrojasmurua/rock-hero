// Canción de ejemplo: genera un notes.chart y sintetiza su audio, para jugar sin importar nada.
(function (G) {
  const GH = (G.GH = G.GH || {});
  const RES = 192, BPM = 124;
  const Q = RES, E = RES / 2, S = RES / 4, BAR = RES * 4;

  function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // Notas de Experto: {tick, lanes, len, tap, open}
  function expertNotes() {
    const r = rng(7);
    const out = [];
    let lane = 2;
    const walk = () => { lane = Math.max(0, Math.min(4, lane + [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)])); return lane; };
    let bar = 2; // dos compases de entrada
    const at = (b, off) => b * BAR + off;
    // Intro: negras
    for (; bar < 6; bar++) for (let k = 0; k < 4; k++) out.push({ tick: at(bar, k * Q), lanes: [[0, 1, 2, 1][k] + (bar % 2)] });
    // Estrofa: corcheas con escalas (HOPO naturales)
    for (; bar < 14; bar++) {
      for (let k = 0; k < 8; k++) {
        if (k === 7 && bar % 2) continue;
        out.push({ tick: at(bar, k * E), lanes: [walk()] });
      }
    }
    // Estribillo: acordes con sostenidos
    const chords = [[0, 1], [1, 2], [2, 3], [1, 3]];
    for (let i = 0; bar < 22; bar++, i++) {
      const c = chords[i % 4];
      out.push({ tick: at(bar, 0), lanes: c, len: Q * 2 - S });
      out.push({ tick: at(bar, Q * 2), lanes: [c[0]] });
      out.push({ tick: at(bar, Q * 2 + E), lanes: [c[1]] });
      out.push({ tick: at(bar, Q * 3), lanes: c.map((x) => x + 1), len: Q - S });
    }
    // Solo: semicorcheas tap
    for (; bar < 26; bar++) {
      const base = [0, 1, 2, 1][bar % 4];
      const run = [0, 1, 2, 3, 2, 1, 2, 3].map((x) => Math.min(4, base + x));
      for (let k = 0; k < 16; k++) {
        if (k >= 12 && bar === 25) break;
        out.push({ tick: at(bar, k * S), lanes: [run[k % 8]], tap: k > 0 });
      }
    }
    // Final: notas abiertas, acordes y un sostenido largo
    for (; bar < 29; bar++) {
      out.push({ tick: at(bar, 0), open: true, len: Q });
      out.push({ tick: at(bar, Q * 2), lanes: [0, 2] });
      out.push({ tick: at(bar, Q * 3), lanes: [1, 3] });
    }
    out.push({ tick: at(29, 0), lanes: [0, 2, 4], len: BAR * 2 - Q });
    return out;
  }

  function reduce(notes, diff) {
    const maxLane = { hard: 4, medium: 3, easy: 2 }[diff];
    const grid = { hard: E, medium: E, easy: Q }[diff];
    const out = [];
    const seen = new Set();
    for (const n of notes) {
      if (n.tick % grid) continue;
      if (diff === 'medium' && n.tick % Q && n.tick % (BAR / 2) === E) continue;
      let lanes = n.open ? [] : [...new Set(n.lanes.map((l) => Math.min(maxLane, l)))];
      if (diff === 'easy' && lanes.length > 1) lanes = [lanes[0]];
      if (diff !== 'expert' && lanes.length > 2) lanes = lanes.slice(0, 2);
      if (seen.has(n.tick)) continue;
      seen.add(n.tick);
      out.push({ tick: n.tick, lanes, open: n.open && diff !== 'easy' ? true : false, len: n.len || 0 });
      if (n.open && diff === 'easy') out[out.length - 1].lanes = [0];
    }
    return out;
  }

  GH.sampleChartText = function () {
    const ex = expertNotes();
    const sp = [[6 * BAR, 8 * BAR], [14 * BAR, 16 * BAR], [22 * BAR, 26 * BAR]];
    let s = '[Song]\n{\n  Name = "Primer Riff"\n  Artist = "Demo"\n  Charter = "Claude"\n  Resolution = ' + RES +
      '\n  Offset = 0\n  MusicStream = "song.ogg"\n}\n';
    s += '[SyncTrack]\n{\n  0 = TS 4\n  0 = B ' + BPM * 1000 + '\n}\n';
    s += '[Events]\n{\n';
    [[2, 'Intro'], [6, 'Estrofa'], [14, 'Estribillo'], [22, 'Solo'], [26, 'Final']].forEach(([b, n]) => { s += '  ' + b * BAR + ' = E "section ' + n + '"\n'; });
    s += '}\n';
    const names = { expert: 'Expert', hard: 'Hard', medium: 'Medium', easy: 'Easy' };
    for (const d of ['expert', 'hard', 'medium', 'easy']) {
      const notes = d === 'expert' ? ex : reduce(ex, d);
      s += '[' + names[d] + 'Single]\n{\n';
      const lines = [];
      for (const n of notes) {
        if (n.open) lines.push([n.tick, 'N 7 ' + (n.len || 0)]);
        else for (const l of n.lanes) lines.push([n.tick, 'N ' + l + ' ' + (n.len || 0)]);
        if (n.tap && d === 'expert') lines.push([n.tick, 'N 6 0']);
      }
      for (const p of sp) lines.push([p[0], 'S 2 ' + (p[1] - p[0])]);
      lines.sort((a, b) => a[0] - b[0]);
      for (const [t, v] of lines) s += '  ' + t + ' = ' + v + '\n';
      s += '}\n';
    }
    return s;
  };

  // Sintetiza el audio: batería, bajo y la guitarra (en pista separada para silenciarla al fallar).
  GH.renderSampleAudio = async function (sampleRate) {
    const sr = sampleRate || 44100;
    const tickSec = 60 / BPM / RES;
    const dur = 32 * BAR * tickSec;
    const OAC = G.OfflineAudioContext || G.webkitOfflineAudioContext;
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const scale = [57, 60, 62, 64, 67]; // La menor pentatónica
    const roots = [45, 41, 48, 43]; // La, Fa, Do, Sol

    async function render(fn) {
      const ctx = new OAC(2, Math.ceil(sr * dur), sr);
      const out = ctx.createDynamicsCompressor();
      out.connect(ctx.destination);
      fn(ctx, out);
      return ctx.startRendering();
    }

    const noise = (ctx) => {
      const b = ctx.createBuffer(1, sr * 0.3, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    };

    const backing = await render((ctx, out) => {
      const nb = noise(ctx);
      const hit = (t, type) => {
        if (type === 'kick') {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
          g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3);
        } else {
          const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
          s.buffer = nb;
          f.type = type === 'snare' ? 'bandpass' : 'highpass';
          f.frequency.value = type === 'snare' ? 1800 : 7000;
          const len = type === 'snare' ? 0.18 : 0.05;
          g.gain.setValueAtTime(type === 'snare' ? 0.7 : 0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
          s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + len);
        }
      };
      for (let bar = 0; bar < 31; bar++) {
        const b0 = bar * BAR * tickSec;
        const beat = Q * tickSec;
        if (bar < 2) { for (let k = 0; k < 4; k++) hit(b0 + k * beat, 'hat'); continue; }
        for (let k = 0; k < 8; k++) hit(b0 + k * beat / 2, 'hat');
        hit(b0, 'kick'); hit(b0 + 2 * beat, 'kick'); hit(b0 + 2.5 * beat, 'kick');
        hit(b0 + beat, 'snare'); hit(b0 + 3 * beat, 'snare');
        // Bajo
        const root = roots[(bar - 2) % 4];
        for (let k = 0; k < 8; k++) {
          const t = b0 + k * beat / 2;
          const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
          o.type = 'square'; o.frequency.value = midi(root - 12 + (k === 7 ? 7 : 0));
          f.type = 'lowpass'; f.frequency.value = 500;
          g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + beat / 2 * 0.95);
          o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + beat / 2);
        }
      }
    });

    const song = GH.parseChart(GH.sampleChartText());
    const groups = GH.buildPlayable(song, 'guitar', 'expert').notes;
    const lead = await render((ctx, out) => {
      for (const n of groups) {
        const t = n.time;
        const len = Math.max(0.18, n.len);
        const pitches = n.open ? [45, 52] : n.lanes.map((l) => scale[l]);
        for (const p of pitches) {
          for (const det of [-6, 6]) {
            const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            o.type = 'sawtooth'; o.frequency.value = midi(p); o.detune.value = det;
            f.type = 'lowpass';
            f.frequency.setValueAtTime(3500, t); f.frequency.exponentialRampToValueAtTime(700, t + len);
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11 / pitches.length + 0.04, t + 0.005);
            g.gain.exponentialRampToValueAtTime(0.001, t + len + 0.1);
            o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.12);
          }
        }
      }
    });
    return { backing, lead };
  };

  GH.SAMPLE_SONG = {
    id: 'sample', name: 'Primer Riff', artist: 'Demo', charter: 'Claude', builtin: true,
    tracks: { guitar: ['expert', 'hard', 'medium', 'easy'] },
  };
})(typeof window !== 'undefined' ? window : globalThis);
