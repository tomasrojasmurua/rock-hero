// Biblioteca de canciones y puntuaciones en IndexedDB; ajustes en localStorage.
(function (G) {
  const GH = (G.GH = G.GH || {});
  let dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('guitar-hero-pwa', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, opts] of [['songs', { keyPath: 'id' }], ['files', { keyPath: 'id' }], ['scores'], ['band']]) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, opts);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Cierra otras pestañas de la app y vuelve a abrir'));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }

  function tx(store, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
    }));
  }
  const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  GH.store = {
    // Los metadatos van separados de los archivos para que listar sea rápido.
    async addSong(song) {
      const { files, ...meta } = song;
      // Safari (iOS) pierde las referencias a Blobs guardados en IndexedDB ("The object can not be found here"):
      // se guardan como ArrayBuffer y se reconstruyen al leer.
      const copies = {};
      for (const [n, b] of Object.entries(files)) copies[n] = { type: b.type, data: await b.arrayBuffer() };
      await tx(['songs', 'files'], 'readwrite', (t) => {
        t.objectStore('songs').put(meta);
        t.objectStore('files').put({ id: meta.id, files: copies });
      });
    },
    listSongs() {
      return tx('songs', 'readonly', (t) => req2p(t.objectStore('songs').getAll()));
    },
    getFiles(id) {
      return tx('files', 'readonly', (t) => req2p(t.objectStore('files').get(id))).then((r) => {
        if (!r) return null;
        const out = {};
        for (const [n, v] of Object.entries(r.files)) out[n] = v && v.data ? new Blob([v.data], { type: v.type }) : v;
        return out;
      });
    },
    deleteSong(id) {
      return tx(['songs', 'files'], 'readwrite', (t) => {
        t.objectStore('songs').delete(id);
        t.objectStore('files').delete(id);
      });
    },
    getScore(key) {
      return tx('scores', 'readonly', (t) => req2p(t.objectStore('scores').get(key)));
    },
    putScore(key, value) {
      return tx('scores', 'readwrite', (t) => { t.objectStore('scores').put(value, key); });
    },
    // Modelos 3D de la banda: rol -> {name, blob}
    async putBandModel(role, file) {
      const blob = new Blob([await file.arrayBuffer()], { type: 'model/gltf-binary' });
      await tx('band', 'readwrite', (t) => { t.objectStore('band').put({ name: file.name, blob }, role); });
    },
    deleteBandModel(role) {
      return tx('band', 'readwrite', (t) => { t.objectStore('band').delete(role); });
    },
    allBandModels() {
      return tx('band', 'readonly', (t) => Promise.all([
        req2p(t.objectStore('band').getAllKeys()), req2p(t.objectStore('band').getAll()),
      ])).then(([k, v]) => { const o = {}; k.forEach((key, i) => (o[key] = v[i])); return o; });
    },
    allScores() {
      return tx('scores', 'readonly', (t) => Promise.all([
        req2p(t.objectStore('scores').getAllKeys()), req2p(t.objectStore('scores').getAll()),
      ])).then(([k, v]) => { const o = {}; k.forEach((key, i) => (o[key] = v[i])); return o; });
    },
  };

  const DEFAULTS = { stage3d: true, noteSpeed: 1, offsetMs: 0, windowMs: 90, lefty: false, simpleChords: true, vibrate: true, volume: 0.9, missSound: true };
  GH.settings = {
    load() {
      try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('gh-settings') || '{}')); }
      catch (e) { return Object.assign({}, DEFAULTS); }
    },
    save(s) { try { localStorage.setItem('gh-settings', JSON.stringify(s)); } catch (e) { /* sin almacenamiento */ } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
