# Trastes

Juego de ritmo táctil de 5 carriles (estilo Guitar Hero / Clone Hero) como PWA instalable. Sin dependencias ni compilación: HTML, CSS y JavaScript plano.

## Qué hace

- Importa canciones de Clone Hero: carpetas con `notes.chart` o `notes.mid`, `song.ini` y audio (`song.ogg`, `.opus`, `.mp3`, `.wav`…, con pistas separadas `guitar.ogg`, `bass.ogg`, `drums_1.ogg`…), archivos `.zip` con una o varias carpetas, y paquetes `.sng`.
- Guarda la biblioteca en el teléfono (IndexedDB) y funciona sin conexión (service worker).
- Instrumentos: guitarra, guitarra coop, rítmica, bajo, teclado y batería (el bombo se toca como nota abierta en cualquier carril); 4 dificultades.
- Notas HOPO y tap (se pueden tocar deslizando el dedo), notas abiertas, acordes, sostenidos, poder estelar, multiplicador hasta x4 (x8 con poder estelar), secciones, récords y estrellas.
- Si la canción trae la pista del instrumento por separado, esa pista se silencia al fallar.
- Ajustes: velocidad de notas, calibración de latencia (con test de toques), ventana de acierto, modo zurdo, volumen.
- Teclado físico: A S D F G (o 1–5), espacio para el poder estelar, Esc para pausa.
- Incluye una canción de ejemplo generada en el propio navegador.

## Ejecutar

Cualquier servidor estático sirve, por ejemplo:

```
python3 -m http.server 8080
```

Para instalarla en el móvil debe servirse por HTTPS y usar "Añadir a pantalla de inicio" (Chrome en Android o Safari en iPhone).

## GitHub Pages

El workflow `.github/workflows/pages.yml` publica la app en cada push a `main`, en https://tomasrojasmurua.github.io/rock-hero/. Requiere activar Pages una vez en *Settings → Pages → Source: GitHub Actions*. En repos privados, Pages solo está disponible con GitHub Pro.

`python3 build.py` genera `dist/trastes.html`, la app en un solo archivo sin service worker.

## Estructura

- `js/core.js`: mapa de tempo y construcción de notas jugables (HOPO, taps, frases de poder estelar).
- `js/chart-parser.js`, `js/midi-parser.js`: lectores de `.chart` y `.mid`.
- `js/importer.js`: `song.ini`, `.zip` (con `DecompressionStream`) y `.sng`.
- `js/audio.js`: reproducción sincronizada de pistas con Web Audio y reloj suavizado.
- `js/game.js`: entrada táctil, puntuación y dibujo en canvas.
- `js/storage.js`, `js/app.js`, `js/sample.js`: biblioteca, interfaz y canción de ejemplo.
