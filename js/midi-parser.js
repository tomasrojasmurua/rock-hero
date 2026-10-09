// Lector de notes.mid (formato Rock Band / Phase Shift / Clone Hero).
(function (G) {
  const GH = (G.GH = G.GH || {});

  function readMidi(buf) {
    const d = new DataView(buf);
    let p = 0;
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); return s; };
    if (str(4) !== 'MThd') throw new Error('No es un archivo MIDI válido');
    const hlen = d.getUint32(4);
    const ntracks = d.getUint16(10);
    const division = d.getUint16(12);
    if (division & 0x8000) throw new Error('MIDI con división SMPTE no soportado');
    p = 8 + hlen;
    const tracks = [];
    for (let t = 0; t < ntracks && p + 8 <= buf.byteLength; t++) {
      const id = str(4);
      const len = d.getUint32(p + 4);
      p += 8;
      const end = Math.min(p + len, buf.byteLength);
      if (id !== 'MTrk') { p = end; continue; }
      const events = [];
      let tick = 0, status = 0, name = '';
      const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
      while (p < end) {
        tick += vlq();
        let b = d.getUint8(p);
        if (b & 0x80) { p++; if (b < 0xf0) status = b; } else b = status;
        if (b === 0xff) {
          const type = d.getUint8(p++);
          const l = vlq();
          const data = new Uint8Array(buf, p, l);
          p += l;
          if (type === 0x03 && !name) name = new TextDecoder().decode(data);
          else if (type === 0x51) events.push({ tick, type: 'tempo', mpqn: (data[0] << 16) | (data[1] << 8) | data[2] });
          else if (type === 0x58) events.push({ tick, type: 'ts', num: data[0], den: Math.pow(2, data[1]) });
          else if (type === 0x01 || type === 0x05 || type === 0x06) events.push({ tick, type: 'text', text: new TextDecoder().decode(data) });
          else if (type === 0x2f) break;
        } else if (b === 0xf0 || b === 0xf7) {
          const l = vlq();
          events.push({ tick, type: 'sysex', data: new Uint8Array(buf.slice(p, p + l)) });
          p += l;
        } else {
          const hi = b & 0xf0;
          const a1 = d.getUint8(p++);
          const a2 = hi === 0xc0 || hi === 0xd0 ? 0 : d.getUint8(p++);
          if (hi === 0x90 && a2 > 0) events.push({ tick, type: 'on', note: a1, vel: a2 });
          else if (hi === 0x80 || (hi === 0x90 && a2 === 0)) events.push({ tick, type: 'off', note: a1 });
        }
      }
      p = end;
      tracks.push({ name: name.trim(), events });
    }
    return { division, tracks };
  }

  const TRACKS = {
    'PART GUITAR': 'guitar', 'T1 GEMS': 'guitar', 'PART GUITAR COOP': 'coop',
    'PART RHYTHM': 'rhythm', 'PART BASS': 'bass', 'PART KEYS': 'keys', 'PART DRUMS': 'drums',
  };
  const BASE = { easy: 60, medium: 72, hard: 84, expert: 96 };
  const SYSEX_DIFF = { 0: 'easy', 1: 'medium', 2: 'hard', 3: 'expert' };

  // Empareja note-on/off: devuelve {nota: [[ini, fin], ...]}
  function noteSpans(events) {
    const open = {}, spans = {};
    for (const e of events) {
      if (e.type === 'on') {
        if (open[e.note] != null) (spans[e.note] = spans[e.note] || []).push([open[e.note], e.tick]);
        open[e.note] = e.tick;
      } else if (e.type === 'off' && open[e.note] != null) {
        (spans[e.note] = spans[e.note] || []).push([open[e.note], e.tick]);
        open[e.note] = null;
      }
    }
    return spans;
  }

  GH.parseMidi = function (buf, ini) {
    ini = ini || {};
    const midi = readMidi(buf);
    const res = midi.division;
    const song = {
      format: 'mid', resolution: res, offset: 0, tempos: [], timeSigs: [], sections: [], meta: {}, tracks: {},
    };
    const first = midi.tracks[0] || { events: [] };
    for (const e of first.events) {
      if (e.type === 'tempo') song.tempos.push({ tick: e.tick, bpm: 60000000 / e.mpqn });
      else if (e.type === 'ts') song.timeSigs.push({ tick: e.tick, num: e.num, den: e.den });
    }
    if (midi.tracks.length === 1 && !first.name) first.name = 'PART GUITAR';
    const cutoff = ini.sustain_cutoff_threshold != null && ini.sustain_cutoff_threshold !== ''
      ? Number(ini.sustain_cutoff_threshold) : Math.round(res / 3);

    for (const tr of midi.tracks) {
      const upper = tr.name.toUpperCase();
      if (upper === 'EVENTS') {
        for (const e of tr.events) {
          if (e.type !== 'text') continue;
          const m = /^\[(?:section|prc)[ _](.*)\]$/.exec(e.text.trim());
          if (m) song.sections.push({ tick: e.tick, name: m[1].replace(/_/g, ' ') });
        }
        continue;
      }
      const inst = TRACKS[upper];
      if (!inst || song.tracks[inst]) continue;
      const drums = inst === 'drums';
      const spans = noteSpans(tr.events);
      const enhancedOpens = tr.events.some((e) => e.type === 'text' && /ENHANCED_OPENS/.test(e.text));
      // Sysex de Phase Shift: aperturas y taps por dificultad
      const psRanges = { open: {}, tap: {} };
      const psOpen = {};
      for (const e of tr.events) {
        if (e.type !== 'sysex') continue;
        const x = e.data;
        if (x.length >= 7 && x[0] === 0x50 && x[1] === 0x53 && x[2] === 0 && x[3] === 0) {
          const diffs = x[4] === 0xff ? ['easy', 'medium', 'hard', 'expert'] : [SYSEX_DIFF[x[4]]];
          const kind = x[5] === 1 ? 'open' : x[5] === 4 ? 'tap' : null;
          if (!kind) continue;
          for (const df of diffs) {
            if (!df) continue;
            const k = kind + df;
            if (x[6]) psOpen[k] = e.tick;
            else if (psOpen[k] != null) { (psRanges[kind][df] = psRanges[kind][df] || []).push([psOpen[k], e.tick + 1]); psOpen[k] = null; }
          }
        }
      }
      const sp = (spans[116] || []).map((s) => [s[0], s[1]]);
      const tapAll = (spans[104] || []).map((s) => [s[0], s[1]]);
      song.tracks[inst] = {};
      for (const diff of Object.keys(BASE)) {
        const base = BASE[diff];
        const notes = [];
        if (drums) {
          for (let k = 0; k <= 5; k++) {
            for (const s of spans[base + k] || []) notes.push({ tick: s[0], lane: k === 0 ? GH.OPEN : k - 1, len: 0 });
          }
        } else {
          const opens = psRanges.open[diff] || [];
          for (let k = 0; k <= 4; k++) {
            for (const s of spans[base + k] || []) {
              const len = s[1] - s[0] > cutoff ? s[1] - s[0] : 0;
              const isOpen = k === 0 && opens.some((r) => s[0] >= r[0] && s[0] < r[1]);
              notes.push({ tick: s[0], lane: isOpen ? GH.OPEN : k, len });
            }
          }
          if (enhancedOpens) {
            for (const s of spans[base - 1] || []) notes.push({ tick: s[0], lane: GH.OPEN, len: s[1] - s[0] > cutoff ? s[1] - s[0] : 0 });
          }
        }
        if (!notes.length) continue;
        song.tracks[inst][diff] = {
          notes, sp, drums,
          hopoRanges: drums ? [] : spans[base + 5] || [],
          strumRanges: drums ? [] : spans[base + 6] || [],
          tapRanges: drums ? [] : tapAll.concat(psRanges.tap[diff] || []),
        };
      }
      if (!Object.keys(song.tracks[inst]).length) delete song.tracks[inst];
    }
    return song;
  };
})(typeof window !== 'undefined' ? window : globalThis);
