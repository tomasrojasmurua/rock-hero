# Frets

Juego de ritmo táctil de 5 carriles (estilo Guitar Hero / Clone Hero) como PWA instalable. Sin dependencias ni compilación: HTML, CSS y JavaScript plano.

## Qué hace

- Importa canciones de Clone Hero: carpetas con `notes.chart` o `notes.mid`, `song.ini` y audio (`song.ogg`, `.opus`, `.mp3`, `.wav`…, con pistas separadas `guitar.ogg`, `bass.ogg`, `drums_1.ogg`…), archivos `.zip` con una o varias carpetas, y paquetes `.sng`.
- Guarda la biblioteca en el teléfono (IndexedDB) y funciona sin conexión (service worker).
- Instrumentos: guitarra, guitarra coop, rítmica, bajo, teclado y batería (el bombo se toca como nota abierta en cualquier carril); 4 dificultades.
- Si una canción solo trae Experto (u otra dificultad alta), Difícil, Medio y Fácil se generan solas: menos notas (prioriza las del pulso), menos carriles y acordes más pequeños. En la pantalla aparecen con ✦.
- Notas HOPO y tap (se pueden tocar deslizando el dedo), notas abiertas, acordes, sostenidos, poder estelar, multiplicador hasta x4 (x8 con poder estelar), secciones, récords y estrellas.
- Leaderboard local: las 5 mejores partidas de cada canción, por instrumento y dificultad, en el detalle de la canción y en la pantalla de resultados.
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

`python3 build.py` genera `dist/frets.html`, la app en un solo archivo sin service worker.

## Estructura

- `js/core.js`: mapa de tempo y construcción de notas jugables (HOPO, taps, frases de poder estelar).
- `js/chart-parser.js`, `js/midi-parser.js`: lectores de `.chart` y `.mid`.
- `js/importer.js`: `song.ini`, `.zip` (con `DecompressionStream`) y `.sng`.
- `js/audio.js`: reproducción sincronizada de pistas con Web Audio y reloj suavizado.
- `js/game.js`: entrada táctil, puntuación y dibujo en canvas.
- `js/storage.js`, `js/app.js`, `js/sample.js`: biblioteca, interfaz y canción de ejemplo.

## Banda en 3D

`js/stage3d.js` dibuja con Three.js (en `vendor/three`, licencia MIT) un escenario con cinco puestos: voz, guitarra solista, guitarra rítmica, bajo y batería. Por defecto usa músicos provisionales hechos con primitivas (con contorno de dibujo animado, sombra, caras expresivas y ropa propia de cada uno) y animados al tempo de la canción: los brazos alcanzan el mástil, el micrófono o cada tambor (cinemática inversa), el baterista toca charles, caja, bombo, platillos y redobles, y cada músico tiene su propio estilo de rebote, cabeceo y pasos. La banda reacciona al jugador: su músico se encoge al fallar (y deja de tocar si la canción trae su pista), salta al subir el multiplicador y, con poder estelar, levanta la guitarra mientras toda la banda salta y el público se viene arriba.

La cámara alterna el plano general con primeros planos de cada músico y planos de dos músicos, cortando en la raya del compás (siempre igual para la misma canción). Los eventos del juego fuerzan tomas: un fallo lleva la cámara al músico del jugador, y subir el multiplicador o activar el poder estelar vuelve al plano general para ver a la banda saltar. Se puede desactivar en *Ajustes* (*Cámara con cortes y primeros planos*).

Los músicos usan los modelos CC0 *Universal Base Characters* de Quaternius (`assets/musicians/`, licencia en `LICENSE-Quaternius.txt`): ropa y peinado distintos para cada puesto, y las animaciones se aplican al esqueleto del modelo desde `js/musician.js`. Si no cargan, se usan figuras simples.

En *Ajustes → Banda en 3D* se puede cargar un modelo `.glb` para cada puesto. Se escala solo a la altura correcta y, si trae animaciones, reproduce la que mejor encaje con el puesto (por ejemplo, una animación de Mixamo de tocar guitarra). Los modelos se guardan solo en el navegador del jugador, no en el repositorio.
