// Salas multijugador: teléfonos conectados directamente con WebRTC (PeerJS).
// El servidor público de PeerJS solo presenta a los teléfonos; después todo va de uno a otro.
// Topología en estrella: el anfitrión reenvía a cada invitado lo que mandan los demás.
(function (G) {
  const GH = (G.GH = G.GH || {});
  const PREFIX = 'trastes-sala-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CHUNK = 64 * 1024;

  function makeCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  // ?peer=host:puerto apunta a otro servidor de PeerJS (para probar en una red local).
  function peerOptions() {
    const p = new URLSearchParams(location.search).get('peer');
    if (!p) return { debug: 0 };
    const [host, port] = p.split(':');
    return { debug: 0, host, port: Number(port) || 443, secure: location.protocol === 'https:' && !/^(localhost|127\.)/.test(host), path: '/' };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Huella del archivo de notas: identifica la misma canción en dos teléfonos.
  GH.notesHash = async function (files) {
    const name = Object.keys(files).find((n) => /^notes\.(chart|midi?)$/i.test(n));
    if (!name || !(G.crypto && crypto.subtle)) return null;
    const buf = await crypto.subtle.digest('SHA-256', await files[name].arrayBuffer());
    return Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  };

  class Room {
    constructor(name) {
      this.name = (name || 'Jugador').slice(0, 20);
      this.peer = null;
      this.code = null;
      this.isHost = false;
      this.myId = null;
      this.conns = new Map(); // id -> DataConnection (anfitrión: todos los invitados; invitado: solo el anfitrión)
      this.players = []; // [{id, name, state, inst, diff, pct}]
      this.handlers = {};
      this.incoming = null; // canción que se está recibiendo
      this.closed = false;
    }

    on(type, fn) { this.handlers[type] = fn; return this; }
    emit(type, data) { const f = this.handlers[type]; if (f) f(data); }

    get link() {
      return location.origin + location.pathname + '#sala=' + this.code;
    }

    // ---------- conexión ----------
    host() {
      this.isHost = true;
      return new Promise((resolve, reject) => {
        const tryOpen = (attempt) => {
          this.code = makeCode();
          const peer = new G.Peer(PREFIX + this.code, peerOptions());
          let opened = false;
          peer.on('open', (id) => {
            opened = true;
            this.peer = peer;
            this.myId = id;
            this.players = [{ id, name: this.name, state: 'lobby' }];
            peer.on('connection', (c) => this._accept(c));
            this._watchPeer(peer);
            resolve(this.code);
          });
          peer.on('error', (e) => {
            if (opened) return;
            peer.destroy();
            if (e.type === 'unavailable-id' && attempt < 4) tryOpen(attempt + 1);
            else reject(new Error(errorText(e)));
          });
        };
        tryOpen(0);
      });
    }

    join(code) {
      this.code = code.toUpperCase();
      return new Promise((resolve, reject) => {
        const peer = new G.Peer(peerOptions());
        this.peer = peer;
        let done = false;
        const fail = (e) => { if (done) return; done = true; peer.destroy(); reject(e); };
        const timer = setTimeout(() => fail(new Error('No se pudo conectar con la sala. Revisa el código o prueben en la misma wifi.')), 20000);
        peer.on('error', (e) => fail(new Error(e.type === 'peer-unavailable' ? 'La sala ' + this.code + ' no existe o ya se cerró.' : errorText(e))));
        peer.on('open', (id) => {
          this.myId = id;
          const c = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'binary' });
          c.on('open', () => {
            clearTimeout(timer);
            if (done) return;
            done = true;
            this.conns.set('host', c);
            this._wire(c, 'host');
            c.send({ t: 'hello', name: this.name });
            this._watchPeer(peer);
            resolve();
          });
        });
      });
    }

    _watchPeer(peer) {
      peer.on('disconnected', () => { if (!this.closed) try { peer.reconnect(); } catch (e) { /* sin reconexión */ } });
      peer.on('error', (e) => { if (!this.closed && e.type !== 'peer-unavailable') this.emit('warn', errorText(e)); });
    }

    _accept(c) {
      c.on('open', () => {
        this.conns.set(c.peer, c);
        this._wire(c, c.peer);
      });
    }

    _wire(c, id) {
      c.on('data', (m) => this._onData(id, m));
      const gone = () => {
        if (!this.conns.has(id)) return;
        this.conns.delete(id);
        if (this.isHost) {
          const p = this.players.find((x) => x.id === id);
          this.players = this.players.filter((x) => x.id !== id);
          this._sendPlayers();
          if (p) this.emit('left', p.name);
        } else if (!this.closed) {
          this.emit('closed', 'Se perdió la conexión con la sala.');
          this.leave();
        }
      };
      c.on('close', gone);
      c.on('error', gone);
    }

    leave() {
      this.closed = true;
      for (const c of this.conns.values()) { try { c.send({ t: 'bye' }); c.close(); } catch (e) { /* ya cerrada */ } }
      this.conns.clear();
      if (this.peer) setTimeout(() => this.peer.destroy(), 300);
    }

    // ---------- mensajes ----------
    send(m, to) {
      if (to) { const c = this.conns.get(to); if (c && c.open) c.send(m); return; }
      for (const c of this.conns.values()) if (c.open) c.send(m);
    }

    _sendPlayers() {
      this.send({ t: 'players', list: this.players });
      this.emit('players', this.players);
    }

    _onData(from, m) {
      if (!m || typeof m !== 'object') return;
      if (this.isHost) return this._hostData(from, m);
      return this._guestData(m);
    }

    _hostData(from, m) {
      const p = this.players.find((x) => x.id === from);
      switch (m.t) {
        case 'hello':
          if (!p) this.players.push({ id: from, name: String(m.name || 'Jugador').slice(0, 20), state: 'lobby' });
          this.send({ t: 'welcome', you: from, code: this.code }, from);
          this._sendPlayers();
          if (this.song) this.send({ t: 'song', song: this.song }, from);
          this.emit('joined', String(m.name || 'Jugador'));
          break;
        case 'state':
          if (p) { Object.assign(p, pick(m, ['state', 'inst', 'diff', 'pct'])); this._sendPlayers(); }
          break;
        case 'need':
          this._sendSong(from);
          break;
        case 'score':
        case 'final':
        case 'pause':
        case 'resume':
          m.id = from;
          this.emit(m.t, m);
          for (const id of this.conns.keys()) if (id !== from) this.send(m, id);
          break;
        case 'bye':
          if (this.conns.has(from)) { const c = this.conns.get(from); c.close(); }
          break;
      }
    }

    _guestData(m) {
      switch (m.t) {
        case 'welcome': this.myId = m.you; break;
        case 'players': this.players = m.list; this.emit('players', m.list); break;
        case 'song': this.song = m.song; this.emit('song', m.song); break;
        case 'songStart':
          this.incoming = { meta: m.meta, list: m.files, parts: {}, got: 0, total: m.files.reduce((s, f) => s + f.size, 0) };
          this.emit('progress', 0);
          break;
        case 'chunk': {
          const inc = this.incoming;
          if (!inc) return;
          (inc.parts[m.f] = inc.parts[m.f] || []).push(m.data);
          inc.got += m.data.byteLength;
          this.emit('progress', inc.total ? inc.got / inc.total : 1);
          break;
        }
        case 'songEnd': {
          const inc = this.incoming;
          this.incoming = null;
          if (!inc) return;
          const files = {};
          for (const f of inc.list) files[f.name] = new Blob(inc.parts[f.name] || [], { type: f.type });
          this.emit('received', Object.assign({}, inc.meta, { files }));
          break;
        }
        case 'ping': this.send({ t: 'pong' }); break;
        case 'start': this.emit('start', m); break;
        case 'score': case 'final': case 'pause': case 'resume': this.emit(m.t, m); break;
        case 'bye':
          this.emit('closed', 'El anfitrión cerró la sala.');
          this.leave();
          break;
      }
    }

    // ---------- anfitrión ----------
    setSong(song, files) {
      this.song = song;
      this.files = files;
      for (const p of this.players) if (p.id !== this.myId) p.state = 'lobby';
      this.send({ t: 'song', song });
      this._sendPlayers();
    }

    async _sendSong(to) {
      const c = this.conns.get(to);
      if (!c || !this.files) return;
      const song = this.song;
      const files = this.files;
      const list = Object.entries(files).map(([name, b]) => ({ name, type: b.type, size: b.size }));
      c.send({ t: 'songStart', meta: song.meta, files: list });
      for (const [name, blob] of Object.entries(files)) {
        const buf = await blob.arrayBuffer();
        for (let off = 0; off < buf.byteLength; off += CHUNK) {
          if (!c.open || this.song !== song) return;
          // Contrapresión: no llenar la memoria del canal más rápido de lo que se envía.
          while (c.open && ((c.dataChannel && c.dataChannel.bufferedAmount > 1 << 21) || (c.bufferSize || 0) > 64)) await sleep(15);
          c.send({ t: 'chunk', f: name, data: buf.slice(off, off + CHUNK) });
        }
      }
      c.send({ t: 'songEnd' });
    }

    // Mide la latencia a cada invitado para que todos empiecen a la vez.
    async startAll(leadMs) {
      const rtts = {};
      await Promise.all(Array.from(this.conns.keys()).map((id) => this._measure(id).then((r) => { rtts[id] = r; })));
      for (const id of this.conns.keys()) this.send({ t: 'start', in: Math.max(0, leadMs - rtts[id] / 2) }, id);
      return leadMs;
    }

    _measure(id) {
      return new Promise((resolve) => {
        const c = this.conns.get(id);
        if (!c) return resolve(0);
        const t0 = performance.now();
        const done = (e) => {
          if (e.t !== 'pong') return;
          c.off('data', done);
          resolve(performance.now() - t0);
        };
        c.on('data', done);
        c.send({ t: 'ping' });
        setTimeout(() => { c.off('data', done); resolve(300); }, 2000);
      });
    }
  }

  function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }

  function errorText(e) {
    const map = {
      'browser-incompatible': 'Este navegador no permite multijugador.',
      network: 'Sin conexión con el servidor de salas. Revisa tu internet.',
      'server-error': 'El servidor de salas no responde. Inténtalo de nuevo.',
      'socket-error': 'Se cortó la conexión con el servidor de salas.',
      'unavailable-id': 'No se pudo crear la sala. Inténtalo de nuevo.',
      'webrtc': 'No se pudo conectar directamente con el otro teléfono.',
    };
    return map[e && e.type] || (e && e.message) || 'Error de conexión';
  }

  GH.Room = Room;
})(typeof window !== 'undefined' ? window : globalThis);
