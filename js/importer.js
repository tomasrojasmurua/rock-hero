// Importación de canciones de Clone Hero: carpetas sueltas, .zip y .sng.
(function (G) {
  const GH = (G.GH = G.GH || {});

  const AUDIO_EXT = /\.(ogg|opus|mp3|wav|m4a|aac|flac)$/i;
  const IMAGE_RE = /^(album|background|bg)\.(png|jpe?g|webp)$/i;
  const STEM_SKIP = /^(preview)\./i;

  GH.parseIni = function (text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === '[' || line[0] === ';' || line[0] === '#') continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      out[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
    }
    return out;
  };

  const baseName = (p) => p.split('/').pop();
  const dirName = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };

  // ---------- ZIP (lee por trozos para no cargar archivos enormes en memoria) ----------
  async function readZip(file) {
    const tailLen = Math.min(file.size, 65557);
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error(file.name + ': no es un .zip válido');
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOff = tail.getUint32(eocd + 16, true);
    if (cdOff === 0xffffffff) throw new Error(file.name + ': ZIP64 no soportado; comprímelo de nuevo en partes más pequeñas');
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      const csize = cd.getUint32(p + 20, true);
      const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
      const local = cd.getUint32(p + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      entries.push({
        path: name.replace(/\\/g, '/'),
        async blob() {
          const h = new DataView(await file.slice(local, local + 30).arrayBuffer());
          const start = local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
          const raw = file.slice(start, start + csize);
          if (method === 0) return raw;
          if (method !== 8) throw new Error('Compresión no soportada en ' + name);
          if (typeof DecompressionStream === 'undefined') throw new Error('Tu navegador no puede descomprimir .zip');
          return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        },
      });
    }
    return entries;
  }

  // ---------- SNG (paquete de canción de Clone Hero / YARG) ----------
  async function readSng(file) {
    const head = new DataView(await file.slice(0, Math.min(file.size, 1 << 20)).arrayBuffer());
    const sig = String.fromCharCode(...new Uint8Array(head.buffer, 0, 6));
    if (sig !== 'SNGPKG') throw new Error(file.name + ': no es un archivo .sng válido');
    const mask = new Uint8Array(head.buffer.slice(10, 26));
    let buf = head, p = 26;
    const u64 = () => { const v = Number(buf.getBigUint64(p, true)); p += 8; return v; };
    const ensure = async (need) => {
      if (p + need <= buf.byteLength) return;
      buf = new DataView(await file.slice(0, Math.min(file.size, p + need + (1 << 20))).arrayBuffer());
    };
    const td = new TextDecoder();
    await ensure(16);
    const metaLen = u64();
    await ensure(metaLen + 16);
    const metaCount = u64();
    const ini = {};
    for (let i = 0; i < metaCount; i++) {
      const kl = buf.getInt32(p, true); p += 4;
      const k = td.decode(new Uint8Array(buf.buffer, p, kl)); p += kl;
      const vl = buf.getInt32(p, true); p += 4;
      ini[k.toLowerCase()] = td.decode(new Uint8Array(buf.buffer, p, vl)); p += vl;
    }
    await ensure(16);
    const idxLen = u64();
    await ensure(idxLen + 8);
    const fileCount = u64();
    const metas = [];
    for (let i = 0; i < fileCount; i++) {
      const nl = buf.getUint8(p); p += 1;
      const name = td.decode(new Uint8Array(buf.buffer, p, nl)); p += nl;
      const size = u64(), offset = u64();
      metas.push({ name, size, offset });
    }
    // contentsIndex suele ser absoluto; si apunta antes de los datos, es relativo a la sección de datos.
    const dataStart = p + 8;
    const relative = metas.some((m) => m.offset < dataStart);
    const entries = metas.map(({ name, size, offset }) => {
      if (relative) offset += dataStart;
      return {
        path: name,
        async blob() {
          const data = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
          for (let j = 0; j < data.length; j++) data[j] ^= mask[j & 15] ^ (j & 0xff);
          return new Blob([data]);
        },
      };
    });
    return { ini, entries };
  }

  // Recibe File[] (de un input de carpeta o de archivos) y devuelve canciones listas para guardar.
  GH.importFiles = async function (files, onProgress) {
    const loose = []; // {path, blob()}
    const songs = [];
    const errors = [];
    const report = (msg) => onProgress && onProgress(msg);
    for (const f of files) {
      const path = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      try {
        if (/\.zip$/i.test(f.name)) {
          report('Leyendo ' + f.name + '…');
          for (const e of await readZip(f)) {
            if (/\.sng$/i.test(e.path)) {
              const b = await e.blob();
              const sng = await readSng(new File([b], baseName(e.path)));
              songs.push(...(await collect(groupEntries(sng.entries.map((x) => ({ ...x, path: 'sng/' + x.path }))), sng.ini, e.path)));
            } else loose.push({ path: f.name + '/' + e.path, blob: e.blob });
          }
        } else if (/\.sng$/i.test(f.name)) {
          report('Leyendo ' + f.name + '…');
          const sng = await readSng(f);
          songs.push(...(await collect(groupEntries(sng.entries.map((x) => ({ ...x, path: 'sng/' + x.path }))), sng.ini, f.name)));
        } else if (/\.html?$/i.test(f.name)) {
          errors.push(f.name + ': es una página web, no una canción. Descarga el .zip o .sng con el botón Descargar.');
        } else if (/\.(rar|7z)$/i.test(f.name)) {
          errors.push(f.name + ': formato no soportado, descomprímelo o usa .zip');
        } else {
          loose.push({ path, blob: async () => f });
        }
      } catch (err) {
        errors.push(err.message || String(err));
      }
    }
    try {
      songs.push(...(await collect(groupEntries(loose), null, null)));
    } catch (err) { errors.push(err.message || String(err)); }

    async function collect(groups, iniOverride, label) {
      const out = [];
      for (const [dir, items] of groups) {
        const chartItem = items.find((x) => /^notes\.chart$/i.test(baseName(x.path)));
        const midItem = items.find((x) => /^notes\.midi?$/i.test(baseName(x.path)));
        if (!chartItem && !midItem) continue;
        report('Importando ' + (dir || label || 'canción') + '…');
        try {
          const files = {};
          for (const it of items) {
            const n = baseName(it.path);
            const keep = /^notes\.(chart|midi?)$/i.test(n) || /^song\.ini$/i.test(n) ||
              (AUDIO_EXT.test(n) && !STEM_SKIP.test(n)) || IMAGE_RE.test(n);
            if (keep) files[n.toLowerCase()] = await it.blob();
          }
          let ini = iniOverride || {};
          if (!iniOverride && files['song.ini']) ini = GH.parseIni(await files['song.ini'].text());
          const parsed = await GH.parseSongFiles(files, ini);
          const tracks = {};
          for (const inst of Object.keys(parsed.tracks)) tracks[inst] = GH.DIFFS.filter((d) => parsed.tracks[inst][d]);
          if (!Object.keys(tracks).length) throw new Error('sin pistas jugables');
          if (!Object.keys(files).some((n) => AUDIO_EXT.test(n))) throw new Error('falta el audio (song.ogg, .mp3, .opus…)');
          const folder = (dir || label || '').split('/').pop().replace(/\.(zip|sng)$/i, '');
          const name = GH.stripTags(ini.name || parsed.meta.name || folder || 'Sin título');
          out.push({
            id: 'song-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            name,
            artist: GH.stripTags(ini.artist || parsed.meta.artist || ''),
            album: GH.stripTags(ini.album || parsed.meta.album || ''),
            charter: GH.stripTags(ini.charter || ini.frets || parsed.meta.charter || ''),
            year: GH.stripTags(ini.year || parsed.meta.year || ''),
            ini,
            tracks,
            files,
            addedAt: Date.now(),
          });
        } catch (err) {
          errors.push((dir || label || 'canción') + ': ' + (err.message || err));
        }
      }
      return out;
    }
    return { songs, errors };
  };

  function groupEntries(entries) {
    const groups = new Map();
    for (const e of entries) {
      const d = dirName(e.path);
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(e);
    }
    return groups;
  }

  // files: {nombreEnMinúsculas: Blob}
  GH.parseSongFiles = async function (files, ini) {
    ini = ini || {};
    let song;
    if (files['notes.chart']) song = GH.parseChart(await files['notes.chart'].text());
    else if (files['notes.mid'] || files['notes.midi']) song = GH.parseMidi(await (files['notes.mid'] || files['notes.midi']).arrayBuffer(), ini);
    else throw new Error('no hay notes.chart ni notes.mid');
    return song;
  };

  GH.audioStems = function (files) {
    return Object.keys(files).filter((n) => AUDIO_EXT.test(n) && !STEM_SKIP.test(n));
  };
})(typeof window !== 'undefined' ? window : globalThis);
