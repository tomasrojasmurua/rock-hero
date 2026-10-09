// Lector de archivos .chart (formato de Moonscraper / Clone Hero).
(function (G) {
  const GH = (G.GH = G.GH || {});

  const INST = {
    Single: 'guitar', DoubleGuitar: 'coop', DoubleBass: 'bass',
    DoubleRhythm: 'rhythm', Keyboard: 'keys', Drums: 'drums',
  };
  const DIFF = { Expert: 'expert', Hard: 'hard', Medium: 'medium', Easy: 'easy' };

  const unquote = (s) => {
    s = s.trim();
    return s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1) : s;
  };

  GH.parseChart = function (text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r?\n/);
    const song = {
      format: 'chart', resolution: 192, offset: 0, tempos: [], timeSigs: [], sections: [],
      meta: {}, tracks: {},
    };
    let section = null;
    let track = null;
    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line[0] === '[') {
        section = line.slice(1, line.indexOf(']'));
        track = null;
        const m = /^(Expert|Hard|Medium|Easy)(\w+)$/.exec(section);
        if (m && INST[m[2]]) {
          const inst = INST[m[2]], diff = DIFF[m[1]];
          song.tracks[inst] = song.tracks[inst] || {};
          track = song.tracks[inst][diff] = {
            notes: [], sp: [], flipTicks: new Set(), tapTicks: new Set(), drums: inst === 'drums',
          };
        }
        continue;
      }
      if (line === '{' || line === '}') continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();

      if (section === 'Song') {
        const v = unquote(value);
        if (key === 'Resolution') song.resolution = parseInt(v, 10) || 192;
        else if (key === 'Offset') song.offset = parseFloat(v) || 0;
        else if (key === 'Name') song.meta.name = v;
        else if (key === 'Artist') song.meta.artist = v;
        else if (key === 'Charter') song.meta.charter = v;
        else if (key === 'Album') song.meta.album = v;
        else if (key === 'Year') song.meta.year = v.replace(/^,\s*/, '');
        else if (key === 'Genre') song.meta.genre = v;
        continue;
      }

      const tick = parseInt(key, 10);
      if (!Number.isFinite(tick)) continue;
      const sp = value.indexOf(' ');
      const type = sp < 0 ? value : value.slice(0, sp);
      const rest = sp < 0 ? '' : value.slice(sp + 1).trim();

      if (section === 'SyncTrack') {
        const parts = rest.split(/\s+/);
        if (type === 'B') song.tempos.push({ tick, bpm: parseInt(parts[0], 10) / 1000 });
        else if (type === 'TS') {
          song.timeSigs.push({ tick, num: parseInt(parts[0], 10) || 4, den: parts[1] ? Math.pow(2, parseInt(parts[1], 10)) : 4 });
        }
      } else if (section === 'Events') {
        if (type === 'E') {
          const ev = unquote(rest);
          const m = /^section\s+(.*)$/.exec(ev);
          if (m) song.sections.push({ tick, name: m[1].replace(/_/g, ' ') });
        }
      } else if (track) {
        const parts = rest.split(/\s+/).map((x) => parseInt(x, 10));
        if (type === 'N') {
          const n = parts[0], len = parts[1] || 0;
          if (track.drums) {
            if (n === 0) track.notes.push({ tick, lane: GH.OPEN, len: 0 });
            else if (n >= 1 && n <= 5) track.notes.push({ tick, lane: n - 1, len: 0 });
          } else if (n >= 0 && n <= 4) track.notes.push({ tick, lane: n, len });
          else if (n === 7) track.notes.push({ tick, lane: GH.OPEN, len });
          else if (n === 5) track.flipTicks.add(tick);
          else if (n === 6) track.tapTicks.add(tick);
        } else if (type === 'S' && parts[0] === 2) {
          track.sp.push([tick, tick + (parts[1] || 0)]);
        }
      }
    }
    // Quitar pistas vacías
    for (const inst of Object.keys(song.tracks)) {
      for (const d of Object.keys(song.tracks[inst])) if (!song.tracks[inst][d].notes.length) delete song.tracks[inst][d];
      if (!Object.keys(song.tracks[inst]).length) delete song.tracks[inst];
    }
    return song;
  };
})(typeof window !== 'undefined' ? window : globalThis);
