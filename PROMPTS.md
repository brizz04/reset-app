# Prompts para imágenes y sonidos de Reset

Describen el estilo (anime nocturno, negro y azul eléctrico, HUD) con tus propias palabras para generar piezas
nuevas, no copias de ninguna app. Úsalos en tu generador de imágenes (Midjourney, Flux, Stable Diffusion, DALL·E...)
y de sonido (ElevenLabs Sound Effects, Stable Audio, Suno...).

## Estilo común (pégalo al principio de cada prompt de imagen)

```
anime key visual, night scene, deep black and midnight navy palette with electric blue (#2d7bff) and cyan (#29d8ff)
glow, cel-shaded, clean line art, dramatic rim light, subtle film grain, floating blue sparks and embers,
soft volumetric haze, high contrast, no text, no logo, no watermark
```

Negativo (si tu generador lo admite): `text, letters, watermark, logo, signature, extra fingers, blurry, low quality,
orange, red, warm tones`.

## Imágenes

Dónde ponerlas: `public/art/<nombre>.webp`. La app las usa sola; si un archivo no existe, usa el SVG que ya hay.
Formato: 1280×512 px (proporción 2,5:1), WebP, menos de 150 KB. Deja el tercio inferior algo más oscuro y sin detalles
importantes: ahí va el título del hábito.

| Archivo | Prompt (después del estilo común) |
|---|---|
| `health.webp` | young athlete silhouette running up a mountain ridge at dawn, wide shot, big pale-blue sun low on the horizon, wind-blown scarf, motion streaks |
| `mind.webp` | lone figure sitting cross-legged on calm water under a huge moon, perfect reflection, concentric ripples, floating particles of light |
| `career.webp` | character at a rooftop edge overlooking a glowing night city skyline, lit office windows, a tall tower with a blinking beacon, drifting clouds |
| `discipline.webp` | swordsman standing before a torii gate at night, big moon behind, loose cloth and hair moving in the wind, light streaks |
| `relationships.webp` | two silhouettes sharing an umbrella on a city bridge at night, strings of warm-white bokeh lights turned blue, light rain |
| `learning.webp` | reader in a vast library with floating glowing pages and orbs, tall bookshelves fading into darkness, one beam of light from above |
| `spirit.webp` | silhouette at the edge of a pine forest under a giant moon, fireflies, mist between the trees, calm and mystical |
| `default.webp` | abstract anime sky with diagonal speed lines, a crescent moon, scattered stars and a soft blue horizon glow |

Otras piezas (opcionales, dime cuáles quieres que conecte):

| Pieza | Tamaño | Prompt (después del estilo común) |
|---|---|---|
| Sobre de pack | 600×840 | trading-card pack, glossy electric-blue foil, angular cut corners, glowing seam, hexagon emblem in the centre, no text |
| Fondo de carta épica | 800×1100 | ornate card frame background, violet and blue energy swirls, angular border, particles, empty centre for text |
| Fondo de carta legendaria | 800×1100 | ornate card frame background, gold and white-blue light rays, shattered-glass border, empty centre for text |
| Jefe semanal (8 variantes) | 800×800 | a menacing shadow creature made of fog and static, glowing eyes, dark background, one per theme: sloth, scrolling phone-screen spirit, mask trickster, stone golem, hydra |
| Subida de nivel | 1080×1920 | hero character seen from behind raising a fist toward a sky full of rising blue light beams, ground cracked with glowing lines, epic low-angle shot |
| Icono de la app | 1024×1024 | bold angular letter R made of glowing electric blue light on a black background, hexagonal frame, centered, minimal |
| Pantalla de acceso | 1080×1920 | rain-soaked neon city alley at night, one distant silhouette walking away, blue reflections on the pavement |

## Sonidos

Hoy la app los sintetiza sola, sin archivos, y se pueden quitar en Perfil. Si generas los tuyos, guárdalos en
`public/sfx/<nombre>.mp3` (mono, 44,1 kHz, menos de 100 KB cada uno) y dime que los conecte.

| Nombre | Duración | Prompt |
|---|---|---|
| `done` | 0,4 s | short bright two-note chime, soft digital sparkle, satisfying and quick, mobile game UI |
| `all-done` | 1,4 s | rising four-note triumphant arpeggio with a shimmer tail, uplifting, clean synth bells |
| `level-up` | 2,5 s | epic cinematic riser with a heavy impact, rising synth brass fanfare and bright sparkle burst, ends on a resonant chord |
| `pack-charge` | 1,1 s | energy charging up, rising electric hum with crackling static and a building whoosh, tension |
| `pack-tear` | 0,4 s | sharp paper-foil ripping sound combined with a bright zap |
| `pack-slam` | 0,5 s | deep cinematic impact boom with a short sub-bass drop and metallic ring |
| `reveal-common` | 0,5 s | soft glassy ting, single clean note |
| `reveal-rare` | 0,7 s | bright two-note chime with a light sweep |
| `reveal-epic` | 1,0 s | magical shimmer rise with a deep resonant note and sparkles |
| `reveal-legendary` | 1,6 s | dramatic orchestral hit with choir pad swell, golden sparkle cascade, triumphant |
| `notification` | 1,0 s | short signature mobile notification sound, soft mallet and airy synth, memorable, friendly |
| `tap` | 0,1 s | tiny soft UI tick |
| `ambient-breathing` | 5 min, en bucle | slow calm ambient pad, deep warm drone with distant soft chimes, no melody, meditation background |

## Voz para la meditación (opcional)

```
calm, warm, low-pitched voice, slow pace, gentle breathy tone, Spanish (Spain), meditation guide, no dramatic emphasis
```
