// Biblioteca de canciones y puntuaciones en IndexedDB; ajustes en localStorage.
(function (G) {
  const GH = (G.GH = G.GH || {});
  let dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('guitar-hero-pwa', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('songs', { keyPath: 'id' });
        d.createObjectStore('files', { keyPath: 'id' });
        d.createObjectStore('scores');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
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
      // Safari a veces no guarda Blobs de archivos externos: los copiamos a memoria primero.
      const copies = {};
      for (const [n, b] of Object.entries(files)) copies[n] = new Blob([await b.arrayBuffer()], { type: b.type });
      await tx(['songs', 'files'], 'readwrite', (t) => {
        t.objectStore('songs').put(meta);
        t.objectStore('files').put({ id: meta.id, files: copies });
      });
    },
    listSongs() {
      return tx('songs', 'readonly', (t) => req2p(t.objectStore('songs').getAll()));
    },
    getFiles(id) {
      return tx('files', 'readonly', (t) => req2p(t.objectStore('files').get(id))).then((r) => (r ? r.files : null));
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
    allScores() {
      return tx('scores', 'readonly', (t) => Promise.all([
        req2p(t.objectStore('scores').getAllKeys()), req2p(t.objectStore('scores').getAll()),
      ])).then(([k, v]) => { const o = {}; k.forEach((key, i) => (o[key] = v[i])); return o; });
    },
  };

  const DEFAULTS = { noteSpeed: 1, offsetMs: 0, windowMs: 90, lefty: false, vibrate: true, volume: 0.9, missSound: true };
  GH.settings = {
    load() {
      try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('gh-settings') || '{}')); }
      catch (e) { return Object.assign({}, DEFAULTS); }
    },
    save(s) { try { localStorage.setItem('gh-settings', JSON.stringify(s)); } catch (e) { /* sin almacenamiento */ } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
