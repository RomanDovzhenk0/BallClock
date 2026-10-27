# BallClock web: the clock's site (firmware v1.9)

The site the clock serves from its flash at `/`: a big live preview of the 128 balls, Kaya's events with a look per
event, every setting of the classic page, and saving. It is the KAIA-161 variant B «Сцена» (big preview, tabs under it,
a bottom tab bar on the phone), with KAIA-172 variant b on top of it in v1.6: palettes picked by sight, a list of
Kaya's 7 events with live thumbnails and a gallery per event, a try-out on the clock for every event, and the unlit
balls' look. v1.7 adds the Digit fade: the time fades out while Kaya's animation plays and back in after it. v1.8 adds
six Kaya styles (KAIA-195), a «Стиль» picker by sight and the new styles' versions in every event's gallery. v1.9
(the owner's picks from three catalogs, in three parts): part 1 fixes the ids of all of them, puts the «Стиль» picker
into groups (KAIA-201's design) and adds catalog A's Снежинка, Светлячки and Пламя; part 2 adds catalog B's Аркада,
Тетрис, Механизм, Неон, Маятник and Гирлянда (KAIA-202). The classic Settings page stays at `/old`.

One self-contained page: inline CSS and JS, no external requests, only relative URLs (it runs from the clock's
own access point and behind the Kernel's gateway alike), Russian UI. No npm dependencies: Node built-ins only.

## Run, build, test

| | |
|---|---|
| `dist/site.html?mock` | open from disk in a browser: a mock clock inside the page answers the whole API from sample data with a running clock. The dashed «Макет» bar switches what it does: password (401, the mock's password is `kaia`), no answer, access point, update available, running text. |
| `npm run build` | `src/` → `dist/site.html` (committed) → `../firmware/src/site_page.h` (`site_page_gz[] PROGMEM`, `site_page_gz_len`, `SITE_PAGE_ETAG`); prints the raw and gzip sizes and fails over 96 KB gzipped (64 KB until v1.8; v1.9's 91 new animations add about 22 KB, `send_P` takes any `size_t` and the v1.8.0 bin is 743,472 B of the ~1 MB a sketch may take). The gzip is deterministic: the same input gives the same bytes. |
| `npm test` | `node --test`: the renderer against hand-computed values and the firmware's own tables (the 61 palettes read back from `palettes.cpp`), the wakes, the looks per event (lengths, seamless loops, determinism, ids, C++ portability), the API client, the try-out queries, the unlit-ball storage and the mock, the Digit fade (`hide.test.mjs`: the level against hand-computed values, the frames of v1.6.2 bit for bit when it is off, C++ portability), the styles of v1.8 (`styles.test.mjs`: every old id's frames bit for bit, the new ids through «Как у стиля» and the galleries, seamless loops, fade-outs, the cost per frame, the long-state check, C++ portability), catalog A's styles of v1.9 (`nature.test.mjs`: the id tables, every v1.8 id's frames bit for bit, the same checks for styles 10–12, the cost as the divisions a frame really runs), catalog B's (`games.test.mjs`: the same for styles 13–18, every id of part 1 bit for bit, the long-state check to 70 minutes, the arithmetic right shifts). |
| `npm run test:render` | headless Edge over CDP: `dist/site.html?mock` at 390×844 and 1280×800 in 52 states (the tabs, the palette picker, the Digit fade block on and off, the draft half way through the fade, the way back, a clock without it, each event's gallery, the «Стиль» picker (its listening and all-7 thumbnails, a new style's events in the draft, its try-out; v1.9: its groups on both widths, a chip showing «Природа» with Пламя picked, a catalog A version in a gallery; part 2: «Все» with all 18 styles and «Выкл», «Игры» with Маятник picked, «Узоры и свет» with Гирлянда, catalog B's wakes in the wake's gallery, a try-out with style 16), the try-outs of a wake, a state and a one-shot, the unlit balls at 0, 50 and 100 % transparency, the phone with the preview in view, …); shots in `shots/` (git-ignored). In-page check: nothing wider than the viewport, no overlapping controls, no cut text, touch targets ≥ 44 px on the phone, no request off the page; the save, login and try-out flows; ≥ 18 frames a second with the CPU 4× slower. `node test/render.mjs <state>…` runs some states only. Run `npm run build` first. |

The build joins the ES modules of `src/` in import order into one strict scope: top-level names must be unique
across modules (the build checks), and strings never span lines (it drops whole-line comments and indentation).

## Files

| file | what |
|---|---|
| `src/lib8.js` | FastLED 3.7.7 lib8tion as the ESP8266 compiles it (the C versions, SCALE8_FIXED and BLEND_FIXED): sin8, scale8, qadd8, nscale8_video, blend8 / nblend, scale16, ease16InOutQuad, lerp15by16, avg15 |
| `src/noise.js` | `inoise16(x, y, z)` (noise.cpp) |
| `src/palettes.js` | the 61 palettes as CRGBPalette16 and `getPaletteColor`; the picker's Russian names, groups and order |
| `src/matrix.js` | `BallMatrix`: the layout, the strip, the marks (and v1.7's mark alpha), `mix`, GyverGFX colour and `print` |
| `src/redraw.js` | the clock under the overlay: background, digits, dots, night, brightness |
| `src/kaia.js` | Kaya: the ball tables, the helpers (with v1.6's `ballRX`, `ballAt`, `oct`, `segDist`, `hash8`, `putb`), the 3 styles |
| `src/wakes.js` | the wakes (ids, names, base lengths, the 11 themed ones of v1.5 and v1.6, the speed) |
| `src/looks.js` | v1.6: the looks per event (ids, names, one-shot lengths, the 30 new ones), `stateLook`, `shotLook`, `wakeDraw`; v1.8: `lookOf`, looks 9–14 |
| `src/styles.js` | v1.8: Kaya's styles 4–9 (KAIA-195): their 42 animations, helpers and tables, `styleState`, `styleShot` (v1.9: also 10–18), `STYLE_NAMES`, `fam_ms` |
| `src/nature.js` | v1.9 part 1: catalog A's styles 10–12 (KAIA-201): Снежинка, Светлячки, Пламя, their 21 animations, helpers and tables |
| `src/games.js` | v1.9 part 2: catalog B's styles 13–18 (KAIA-202): Аркада, Тетрис, Механизм, Неон, Маятник, Гирлянда, their 42 animations, helpers and tables |
| `src/frame.js` | one 50 ms frame: `renderFrame(matrix, settings, clock)`; what plays at t (`resolvePlay`); the duck; v1.7: the Digit fade (`hideStep`, `digitHide`, `hideTrack`, `isPlaying`) |
| `src/paint.js` | the canvas layer (the only DOM part of the drawing) and the unlit balls' setting |
| `src/api.js` | the API client: one request at a time, 5 s, auth; `hash32`, `keyId`; `tryOut` (the try-out query) |
| `src/clock.js` | the clock's time between two states (the NTP second's phase) |
| `src/mock.js` | the mock clock of `?mock` |
| `src/settings.js` | the keys, their defaults (db.init) and raw values; `LOOK_KEYS`; `HIDE_RANGES` (v1.7) |
| `src/app.js`, `page.html`, `style.css` | the page |
| `test/frames.mjs`, `test/cost.mjs` | test helpers: the frame digests (v1.6.2, every v1.6 id, every v1.8 id, every id of v1.9 part 1), the cost of a frame read from the source and (v1.9) the divisions a frame really runs |

## The renderer: the firmware's drawing in JS

Pure (no DOM), so the tests import it: the same settings and time give the same 128 colours. Integer maths keep
C++ semantics: every division is `a / b | 0` (truncates toward zero), `(uint8_t)` is `& 255`, uint16 / int16 wrap
where the C++ types do, and the float steps of the boot tables and the old wakes are `Math.fround` per operation.

| JS | C++ | notes |
|---|---|---|
| `matrix.js` `xyToLed`, `diagToLed`, `ledXY`, `ledDiag` | `src/matrix.cpp` | the tests compare them with the C source |
| `BallMatrix.setXY` / `getXY`, `beginMarks`, `marked` | `src/matrix.h` | the digit balls are marked while the clock draws; v1.7: while marking, `setXY` blends the new colour over what is there by `alpha` (`mix`) |
| `BallMatrix.setColor24`, `getColor24`, `fastSet` | GyverGFX `core/core.h`, `core/utils.cpp` | the colour goes through RGB565 (`rgb888to565`); the digits are drawn with `rgb565to888full`, the dots with `getColor24` (`rgb565to888`, low bits zero) |
| `BallMatrix.print` / `write` / `drawByte` | GyverGFX `GyverGFX.h` `write`, `_drawByte`, `fastByte`; `core/decoder.h` | a map font, scale 1: column byte bit i at y = cursor.y + i, the column at cursor.x: **no shear** in the diagonal grid (so font 1 leans; `font_3x5_diag` is drawn for the grid); space = font width, 1 px between glyphs, nothing printed at x ≥ 19 |
| `gfx_font_3x5`, `font_3x5_diag`, `font_4x5` | `lib/GyverGFX-dev/src/default/font3x5.h`, `src/font_3x5_diag.h`, `src/font_4x5.h` | checked against the headers; `firmware/lib/GyverGFX-dev` is checked to equal `libraries/GyverGFX-dev` |
| `redraw.js` `drawClock`, `drawTime`, `dots` | `src/redraw.cpp` | hours < 10: the leading zero or a space; «--» «--» before NTP sync; dots by the clock's ms within the second (fade in 0–99, on 100–499, fade out 500–600) with FastLED `blend` |
| `redraw.js` `drawBack`, `gradData`, `brezLine` | `src/redraw.cpp` `drawBack`, `GradData`; `src/brezline.cpp` | count = floor(millis / 64) × back_speed; the gradient covers all 128 LEDs at every angle (tested), so a frame never depends on the one before |
| `noise.js` `inoise16` | FastLED 3.7.7 `src/noise.cpp` (FASTLED_NOISE_FIXED 1) | Perlin: `inoise16(x·scale·64, y·scale·64, count·32)` per XY cell |
| `palettes.js` `PALETTES`, `gradientTo16`, `colorFromPalette16`, `getPaletteColor` | `src/palettes.cpp`; FastLED `colorpalettes.cpp`, `colorutils.h` (CRGBPalette16 = gradient), `colorutils.cpp` `fill_gradient_RGB` | the gradient palettes are read back from palettes.cpp in the tests (leo_gp keeps its odd «18») |
| `redraw.js` `isNight`, `brightNow` | `src/redraw.cpp` `isNight`, `applyBright` | night: night_color digits on black |
| `kaia.js` `buildTables` | `src/kaia.cpp` `buildTables` | float steps with `Math.fround`; `atan2f` is taken as `fround(Math.atan2)` |
| `kaia.js` `tent`, `smooth`, `wave`, `voice`, `comet`, `mix`, `dim`, `put`, `dimAll`; lib8 `sin8` | `src/kaia.cpp`; FastLED `lib8tion/trig8.h` `sin8_C` | `fr.sc` (kaia_bright, ×77/255 at night with rule 1) and `fr.dg` (what the digit balls keep) |
| `kaia.js` `rippleState`/`Shot`, `orbitState`/`Shot`, `sparksState`/`Shot`, `mark`, `pict`, `shot_ms` | `src/kaia.cpp` | the error thump (`expf`) and the orbit/sparks wakes (`powf`, floats) use `Math.fround` steps |
| `frame.js` `kaiaDraw`, `resolvePlay`, `duckStep`, `backScale` | `src/kaia.cpp` `kaiaDraw`, `kaiaBackScale` | the night rule 2 hides the overlay; done / error / notify default to green / red / amber |
| `wakes.js` | `src/kaia.cpp` (v1.5) `wakeLength`, `dawnShot` … `rainShot` | see below; the C++ keeps `b_col`, `b_row`, `b_x` in one byte a ball (`b_cr`, column and row) and computes `h1`–`h3` inline: the same values, 640 B less RAM |
| `looks.js`, the v1.6 helpers of `kaia.js`, wakes 12–14 | for `src/kaia.cpp` v1.6 (the firmware task) | see «Changes the firmware task copies into kaia.cpp (v1.6)» |
| `styles.js`, `lookOf`, `wakeOf` | for `src/kaia.cpp` v1.8 (the firmware task) | see «Changes the firmware task copies into kaia.cpp (v1.8)» |
| `nature.js`, `look_style`, `style_look`, `wake_style`, `style_wake` | for `src/kaia.cpp` v1.9 (the firmware task) | see «Changes the firmware task copies (v1.9, part 1)» |
| `games.js` | for `src/kaia.cpp` v1.9 (the firmware task) | see «Changes the firmware task copies (v1.9, part 2)» |

Not modelled: NeoPixel's `setBrightness` pre-multiplies the strip and `getPixelColor` scales back, so on the clock a
read-modify-write (the dots, `put`, `dimAll`) at brightness < 255 loses low bits. The brightness belongs to the
output: the frames are the colours as drawn, and the preview shows the brightness as a gain of 0.3 + 0.7·b/255.
`atan2f`, `expf` and `powf` may differ from the JS by an ulp; that only matters at exact ties.

## Changes the firmware task copies into kaia.cpp (v1.5)

- `sparksState(n, t, col, k)` gains `k` (how far it shows, 255 = all) like the other two states.
- `rippleShot` / `orbitShot` (A_WAKE) no longer draw the listening themselves; `wakeDraw` does it on real time.
- `fr` gains `lt` (the listening's time, t − the wake's real length) and `ls` (the listening's style); the sparks
  wake's mark settles into the sparks breath at `fr.lt` when `fr.ls == 3`, else fades out.
- `wakeDraw(style, wake, speed, t, col)`, `wakeLength`, `wake_ms`, the boot tables `b_col`, `b_row`, `b_x`,
  `h1`–`h3` (`(uint32_t)(i + 1) * 2654435761u >> 24`, `2246822519u`, `3266489917u`) and the 8 new wakes in
  `wakes.js`: integers only, no closures; `x / y | 0` is valid C++ as it is (or drop the `| 0`), `let` / `const`
  are `int` (`uint32_t` for colours), the small arrays are `static const` tables.
- A wake turns into listening after `wakeLength(wake ? wake : style, speed)` = base × 100 / speed: `ov.start += that`.

## Changes the firmware task copies into kaia.cpp (v1.6)

The looks are KAIA-173's catalog as it is (the owner dropped none), in the same integer-only style:

- **Settings** (0 by default): `kaia_listen`, `kaia_think`, `kaia_speak`, `kaia_done`, `kaia_error`, `kaia_notify`,
  each 0 = «Как у стиля» (the version of `kaia_anim`), 1–3 = the Рябь / Орбита / Искры version with any style, 4–8 =
  the new ones. `kaia_wake` gains 12–14 (`WAKE_COUNT` 15). «Выкл» (`kaia_anim` 0) still turns Kaya off.
- **Helpers** (`kaia.js`): `ballRX(x, row)` and `ballAt(p, q)` (the nearest ball or −1), `oct(dx, dy)` (max + 3/8 min,
  no square root), `segDist(p, q, seg, v)` (the distance to a stroke drawn up to v/256), `hash8(n)` =
  `(uint32_t)(n + 1) * 2654435761u >> 24` (h1 for any number), `putb(i, c, a)` (`put` that skips −1).
  p = 4·(x − 19), q = 7·(row − 3) come from `b_cr`: no new per-ball tables.
- **Small const tables** (`looks.js`, `wakes.js`): `aur_fall[4]`, `bub_x[10]`, `atom_sh[3]`, `chk_s1/2`, `conf_v[16][2]`,
  `pict_ok`, `crs_s1/2`, `knock_t[4]`, `pict_mail`, `pict_flap`, `pict_kaya` (К А Я, 11×5); `look_ms[3][5]`.
  Small per-frame stack arrays: `int[3]` ×3 (neurons), `int[13]` (equalizer), `int[7]` (glitch), `int[4]` ×2 (bunny).
- **Dispatch**: `stateLook(style, look, n, t, col, k)` and `shotLook(style, look, n, t, col)` (look < 4 → the style
  functions with `look ? look : style`; a look past the last is the last), `shotLength(n, look, style)` (one-shot
  lengths per look, not per style any more).
- **`wakeDraw(style, wake, lk, speed, t, col)`** moves to `looks.js` and gains `lk`, the listening's look: the
  listening that fades in under the wake and goes on after it is `stateLook(style, lk, A_LISTENING, …)`;
  `fr.ls` = `lk >= 4 ? 0 : lk ? lk : style` (the sparks wake's mark settles into the sparks breath only when the
  listening is Искры).
- **Play**: `{anim, style, look, lk, speed, t, color, ms}`; a wake past its length becomes the listening in look `lk`.
- **Cost**: at most 13 `voice()` calls, 8 hashes or 48 points a frame; no `inoise16`.
- **Long states**: the new looks multiply t by at most 469 (`voice`): in a 32-bit `int` they stay exact for 76 minutes
  of one state (v1.5's ripple, t·2464, for 14 minutes).

## Changes the firmware task copies into the firmware (v1.7): the Digit fade

While Kaya's animation plays the time (the digits and the dots) fades out; when it ends it fades back in. It is written
here first, integer-only, and copied line by line (`frame.js`, `matrix.js`, `kaia.js`; `test/hide.test.mjs` holds it).

- **Settings** (the keys, their ranges and defaults are `db.init`'s; a value out of range reads as its default, as
  `savedLook` does, and `/kaia/state` shows the value read that way):

  | key | range | default | site label | classic page (group K.A.I.A.) |
  |---|---|---|---|---|
  | `kaia_hide` | 0 / 1 | 1 | «Прятать цифры» | switch «Прятать цифры» |
  | `kaia_hide_out` | 100–3000 ms | 600 | «Исчезают за» | slider «Исчезают за, мс» |
  | `kaia_hide_in` | 100–5000 ms | 1200 | «Появляются за» | slider «Появляются за, мс» |
  | `kaia_hide_hold` | 0–5000 ms | 1000 | «Пауза перед появлением» | slider «Пауза перед появлением, мс» |
  | `kaia_hide_keep` | 0–100 % | 0 | «Остаётся от цифр» | slider «Остаётся от цифр, %» |

  The classic page builds them in a `noinline` function of their own with `F()` labels (the 4 KB cont stack).
  `kaia_hide_hold` bridges the gap after a one-shot until Kaya's next state arrives (`clock_indicator.py` sends an
  animation only on a change, and a one-shot gives the screen back by itself), so the time does not flicker back between
  a wake and the listening after it.
- **API**: `/kaia/state` `settings` gains the five keys. Nothing else in the API changes (no new route, no new field in
  `play`, `/kaia/frame` is the real LEDs as ever). The page shows its block only when the state carries `kaia_hide`.
- **The level** `ov.hide`, 16 bits (0 = the time shown, 65535 = gone), stepped by real milliseconds with
  `hideStep(h, dt, playing, sinceEnd, S)` (in C++ a static function on `uint16_t` / `uint32_t`):
  - `kaia_hide == 0` gives 0 at once;
  - `dt` is capped at 60000 (65535 * 60000 < 2^32, so the `uint32_t` product cannot overflow);
  - playing: `h += 65535 * dt / kaia_hide_out`, clamped at 65535;
  - not playing and `sinceEnd >= kaia_hide_hold`: `h -= 65535 * dt / kaia_hide_in`, clamped at 0; before that it stays;
  - a new animation just starts adding from where `h` stands: no jump. The division truncates (a 50 ms frame at 600 ms
    adds 5461, not 5461.25), so "full" comes a frame or so after `kaia_hide_out` ms of playing.
- **Where it runs**: in `kaiaDraw`, once a frame, **before** its early returns (it must keep stepping down while nothing
  draws), after the mode updates (a one-shot that has ended, a state whose `ms` has passed, a wake that turned into
  listening). `hideTrack(L, S, playing, now)` is that sequence: `dt = now - L.t` (`ov.hideT`), the end of the last
  animation (`ov.hideEnd`, set on the first frame without one), then `hideStep`. **playing** = an animation is drawn this
  frame: `ov.mode` is `M_SHOT` or `M_STATE` after the updates, `kaia_anim != 0`, and not (night and `kaia_night == 2`).
  The running text (`M_TEXT`) never counts. The level `redraw` uses in a frame is the one `kaiaDraw` stepped in the
  frame before (as the duck is).
- **`kaiaDigitScale()`** (`digitHide(S, h)` in JS), for `redraw.cpp`: 0 when `kaia_hide == 0`, else
  `smooth(0, 65535, ov.hide) * (100 - kaia_hide_keep) / 100`, 0 to 255 (kaia.cpp's `smooth()`; an `h` under 257 is still 0).
- **redraw.cpp**: `uint8_t hd = kaiaDigitScale();` before the clock, `matrix.markAlpha = 255 - hd;`, then `beginMarks()`,
  `drawClock()`, `endMarks()`, `matrix.markAlpha = 255;`, then `kaiaDraw(...)` with `fr.hd = hd`. `renderFrame` is exactly
  this (`c.hide` is the level; absent = 0).
- **matrix.h**: `uint8_t markAlpha = 255;` and, in `setXY` / `setLED(x, y, c)` while `marking`:
  `if (markAlpha < 255) color = mix(getLED(idx), color, markAlpha);`. `mix()` of kaia.cpp (per channel
  `old + (new - old) * k / 255`, truncating toward zero) moves to a header both include (`matrix.js` holds it, `kaia.js`
  re-exports it). The digits go through `fastSet` and the dots through `setXY` (`dots()` blends the old ball colour with the
  clock's first, then `setXY` takes the result), so both melt into the (ducked) background under them, at night into
  black: never dark holes.
- **put()** (kaia.js): on a marked ball `a = a * (fr.dg + (255 - fr.dg) * fr.hd / 255) / 255`: the digit balls take the
  overlay as the time goes, at `fr.hd == 255` like any other ball, so no ghost of the time stays inside the animation.
  `fr.hd` is set by `kaiaDraw` while it draws (0 after), so a look that sets `fr.dg` itself still gets the lift.
- **Identical when off**: with `kaia_hide == 0`, or `kaia_hide_keep == 100`, or no level, every frame is v1.6.2's bit for
  bit (`test/frames.mjs` folds 850 frames into one SHA-256 taken on the sources of v1.6.2; `hide.test.mjs` checks it).
  At the full level with keep 0 the digit balls equal a frame drawn with `clock_style` 0, with and without an overlay.
- **RAM**: a few bytes in `ov`: `uint16_t hide`, `uint32_t hideT`, `uint32_t hideEnd` and one bit for "an animation drew"
  (11 bytes with a `uint8_t`). `mix` and the alpha need no tables.
- **The page**: "Черновик" and "Сейчас" each keep a level (`P.hideD`, `P.hideN`) stepped every drawn frame by the real ms
  with `hideTrack`: "Сейчас" from `playNow()` and the saved settings, "Черновик" from the event pressed (so after a
  one-shot the time comes back after the pause and the whole cycle shows). The tiles and the event thumbnails draw the
  time at the full level with the draft's keep (`digitHide(S, 65535)`), as it looks mid-animation. A clock before v1.7
  (no `kaia_hide` in its state) never fades in the preview and its Кая tab has no block. "Показать на часах" plays on the
  clock with the digit settings saved there; the block says so.

## Changes the firmware task copies into kaia.cpp (v1.8): Kaya's styles

KAIA-195's catalog as the owner accepted it (all six kept), in `src/styles.js`: integer-only like `looks.js`, copied
line by line (`test/styles.test.mjs` holds it). A style is a whole visual language, its own version of all 7 events.

- **Ids, appended.** The old ones never move: `kaia_anim` 0–3, looks 0–8 and wakes 0–14 draw v1.7's frames bit for bit
  (`test/frames.mjs` `idsDigestOf`: 2268 frames of every old id, one SHA-256 taken on the sources of v1.7).

  | setting | v1.7 | appended in v1.8 |
  |---|---|---|
  | `kaia_anim` («Стиль») | 0 Выкл, 1 Рябь, 2 Орбита, 3 Искры | 4 Пинг-понг, 5 Калейдоскоп, 6 Лава-лампа, 7 Мордашка, 8 Галактика, 9 Сканер (`STYLE_COUNT` 9) |
  | `kaia_listen` … `kaia_notify` | 0–8 | 9–14: the versions of styles 4–9, look = style + 5 (`LOOK_COUNT` 9 → 15) |
  | `kaia_wake` | 0–14 | 15–20: the wakes of styles 4–9, wake = style + 11 (`WAKE_COUNT` 15 → 21) |

- **The classic page** (group K.A.I.A.): «Стиль» becomes a Select of 10 in `STYLE_NAMES` order: Выкл, Рябь, Орбита,
  Искры, Пинг-понг, Калейдоскоп, Лава-лампа, Мордашка, Галактика, Сканер. Each event's Select appends the same six names
  as 9–14 (`LOOK_NAMES`), «Пробуждение» as 15–20 (`WAKE_NAMES`). The strings in flash like v1.6's lists. Home's
  profile (`src/profiles/ballclock.ts`) appends them by index the same way (Home's own task).
- **settings.cpp**: the ranges `kaia_anim` 0–9, the six looks 0–14, `kaia_wake` 0–20 (out of range reads as the
  default, as `savedLook` does).
- **Dispatch** (`looks.js`): `lookOf(style, look)` = `look || style <= 3 ? look : style + 5`, so look 0 with style 4–9
  plays that style's version. `stateLook` and `shotLook` start with `look = lookOf(style, look)`, then send 9–14 to
  `styleState(look - 5, n, t, col, k)` / `styleShot(look - 5, n, t, du, col)` (`styles.js`: a switch per event, as
  stateLook's). `shotLength(n, look, style)` takes `lookOf` too and reads `fam_ms[look - 9][n - A_DONE]` for 9–14.
- **Wakes**: `wakeOf(style, wake)` (`wakes.js`) = `wake ? wake : style <= 3 ? style : style + 11`; `wakeDraw` and the
  wake → listening switch (`wakeLength(wakeOf(style, look), speed)`) use it. `wake_ms[15..20]` = 1800, 2000, 2000,
  1900, 2000, 2000. In `wakeDraw`: `if (id >= 15) styleShot(id - 11, A_WAKE, u, du, col); else switch (id) {…}`; the
  listening fades in over the last 800 ms of u, as under every themed wake. `kaia_wake_speed` scales them too.
- **`fr.ls`** = `lk >= 4 ? 0 : lk ? lk : style <= 3 ? style : 0`. After a new style's wake the listening is
  `stateLook(style, lk, …)`: with `kaia_listen` 0 the style's own listening takes over (the sparks mark only checks 3).
- **Play**: `ov.style` and `play.style` 1–9 (`resolvePlay` takes 1 – `STYLE_COUNT`).
- **Helpers** (`styles.js`, no tables): `kfold(a)` (the six-fold fold of an angle), `ell(dx, dy, w, h)` (an ellipse's
  measure), `blob(dx, dy, r)` (a metaball's field), `lavaPut`, `ppScene`, `ppY`, `ppRally`, `ppServeX`, `ppServeY`,
  `face(…)` (the whole face, 11 parameters), `arm(i, d, rot)`, `galStar(i, t)`; and v1.6's `oct`, `segDist`, `hash8`.
- **Small const tables** (under 100 bytes together): `pp_bt[4]`, `pp_bh[3]`, `pp_smash[4]`, `kal_sp[12]`,
  `lava_from[6]`, `drip_x[3]`, `drip_t[3]`, `scan_row[7]`, `fam_ms[6][3]` (uint16_t: done, error, notify). No per-ball
  tables: p = 4·(x − 19), q = 7·(row − 3) from `b_cr` as in v1.6, `b_dist`, `b_ang` and `h1`–`h3` of the boot. Stack
  arrays a frame: `int[3]` ×2 (Пинг-понг), `int[4]` ×2 (Лава-лампа · Слияния), `int[4]` (Сканер), `int[4]` (Комета's
  segment).
- **Cost per frame**, within v1.6's budget. `test/cost.mjs` counts from the source the integer divisions a frame (the
  ESP8266 has no divider, so they dominate; `put` with its `mix` is 5), every loop and helper counted in, both sides of
  every if. By that count v1.6's heaviest look is Тук-тук (3458) and its heaviest wake Салют (5355); the heaviest new
  animation is Пинг-понг · Подача (3874), and `styles.test.mjs` holds every new one under Салют's count. At most 3
  `voice()` a frame (v1.6: Осциллограф calls it for every ball, 128; the equalizer 13), 2 `hash8()` (v1.6: 8), no
  `inoise16`. Мордашка dims the display (`dimAll`) and draws
  the face over it. `GET /kaia/test` (the firmware task) will give the real times.

| style | event | function | name | length | div | voice | hash8 |
|---|---|---|---|---|---|---|---|
| 4 Пинг-понг | Пробуждение | `ppWake` | Подача | 1800 ms | 3874 | 0 | 0 |
|  | Слушает | `ppListen` | Розыгрыш | 2.8 s | 1807 | 0 | 0 |
|  | Думает | `ppThink` | Быстрый розыгрыш | 1.04 s | 1810 | 0 | 0 |
|  | Говорит | `ppSpeak` | Подскоки | voice | 2080 | 3 | 0 |
|  | Готово | `ppDone` | Смэш | 1500 ms | 2834 | 0 | 0 |
|  | Ошибка | `ppError` | В сетку | 1600 ms | 1548 | 0 | 0 |
|  | Уведомление | `ppNotify` | Мячик | 1600 ms | 1544 | 0 | 0 |
| 5 Калейдоскоп | Пробуждение | `kalWake` | Мандала | 2000 ms | 1807 | 0 | 0 |
|  | Слушает | `kalListen` | Вращение | 5 s (the turn / 6), breath 5.1 s | 2310 | 0 | 0 |
|  | Думает | `kalThink` | Узоры | 1.3 s, a turn 5 s | 1931 | 0 | 0 |
|  | Говорит | `kalSpeak` | Дыхание лепестков | voice | 1942 | 2 | 0 |
|  | Готово | `kalDone` | Цветок | 1600 ms | 2574 | 0 | 0 |
|  | Ошибка | `kalError` | Осколки | 1600 ms | 1416 | 0 | 0 |
|  | Уведомление | `kalNotify` | Лепестки по кругу | 1700 ms | 1286 | 0 | 0 |
| 6 Лава-лампа | Пробуждение | `lavaWake` | Всплытие | 2000 ms | 2070 | 0 | 0 |
|  | Слушает | `lavaListen` | Дрейф | 15, 11 and 8.5 s | 2063 | 0 | 0 |
|  | Думает | `lavaThink` | Слияния | 2.6–4.2 s | 2198 | 0 | 0 |
|  | Говорит | `lavaSpeak` | Пульс | voice | 2084 | 3 | 0 |
|  | Готово | `lavaDone` | Слияние | 1600 ms | 2829 | 0 | 0 |
|  | Ошибка | `lavaError` | Стекает | 1600 ms | 2829 | 0 | 0 |
|  | Уведомление | `lavaNotify` | Пузырь | 1600 ms | 2962 | 0 | 0 |
| 7 Мордашка | Пробуждение | `faceWake` | Просыпается | 1900 ms | 2704 | 0 | 0 |
|  | Слушает | `faceListen` | Смотрит | blinks 8.4 s, glance 12.6 s | 2700 | 0 | 0 |
|  | Думает | `faceThink` | Задумалась | 3.2 s | 2701 | 0 | 0 |
|  | Говорит | `faceSpeak` | Говорит | voice | 2702 | 1 | 0 |
|  | Готово | `faceDone` | Подмигивает | 1700 ms | 2700 | 0 | 0 |
|  | Ошибка | `faceError` | Огорчение | 1600 ms | 2697 | 0 | 0 |
|  | Уведомление | `faceNotify` | Удивление | 1500 ms | 2706 | 0 | 0 |
| 8 Галактика | Пробуждение | `galWake` | Большой взрыв | 2000 ms | 2065 | 0 | 0 |
|  | Слушает | `galListen` | Спираль | 10 s | 1540 | 0 | 0 |
|  | Думает | `galThink` | Вихрь ядра | 2.6 s, the whirl 0.6 s | 1800 | 0 | 0 |
|  | Говорит | `galSpeak` | Пульс ядра | voice | 1942 | 2 | 0 |
|  | Готово | `galDone` | Сверхновая | 1700 ms | 1423 | 0 | 0 |
|  | Ошибка | `galError` | Чёрная дыра | 1700 ms | 1804 | 0 | 0 |
|  | Уведомление | `galNotify` | Комета | 1500 ms | 2183 | 0 | 0 |
| 9 Сканер | Пробуждение | `scanWake` | Запуск | 2000 ms | 1553 | 0 | 0 |
|  | Слушает | `scanListen` | Луч | 3.2 s | 2059 | 0 | 0 |
|  | Думает | `scanThink` | Два луча | 1.28 s | 2189 | 0 | 0 |
|  | Говорит | `scanSpeak` | Ширина голосом | voice | 1295 | 1 | 0 |
|  | Готово | `scanDone` | Проход | 1500 ms | 1548 | 0 | 0 |
|  | Ошибка | `scanError` | Сбой | 1600 ms | 1288 | 0 | 2 |
|  | Уведомление | `scanNotify` | Три прохода | 1500 ms | 2061 | 0 | 0 |

- **Long states**: a state multiplies t by at most 500 (Калейдоскоп · Узоры, `t * 500 / 1000`; `voice` 469,
  Галактика's stars 213, the turns 256): t × 500 stays exact in a 32-bit `int` for 71 minutes of one state.

The six styles, as the owner saw them in KAIA-195 (each animation's comment in `styles.js` says what it does):

| id | style | what |
|---|---|---|
| 4 | Пинг-понг | the clock is made of ping-pong balls, so a rally: a ball, the net in the middle of the bottom rows, paddles at the edges, the bottom row is the table |
| 5 | Калейдоскоп | the hexagon's own six-fold symmetry: `b_ang` folded into six mirrored sectors (`kfold`) |
| 6 | Лава-лампа | soft blobs (metaballs, Σ 256·r²/d²): they merge and split by themselves |
| 7 | Мордашка | Kaya as a tiny face, two eyes in row 2 and a mouth in rows 4–6; the face takes the display, the time steps back |
| 8 | Галактика | a two-armed spiral `(2·b_ang + 9·d − rot) & 255` round the core; stars twinkle on `h1 < 40` |
| 9 | Сканер | the Knight Rider light: a band across all rows, brightest in the middle one (`scan_row`), with a trail |

## The ids of v1.9: the contract of its three parts

The owner's picks from the 2026-10-27 catalogs: from A (KAIA-201) the styles Снежинка, Светлячки and Пламя; from B
(KAIA-202) all six; from C (KAIA-203) all 28 single animations. About 91 new animations, so the site takes them in three
tasks, each followed by its firmware port, then one release (v1.9.0). The ids are fixed now for all three; they are
appended and the old ones never move. An id becomes valid (in `STYLE_COUNT`, `LOOK_COUNT`, `WAKE_COUNT`, the play's and
the API's ranges) only in the part that brings its drawing.

| setting | v1.8 | v1.9 part 1 | part 2 | part 3 |
|---|---|---|---|---|
| `kaia_anim` («Стиль») | 0 Выкл, 1–9 | 10 Снежинка, 11 Светлячки, 12 Пламя | 13 Аркада, 14 Тетрис, 15 Механизм, 16 Неон, 17 Маятник, 18 Гирлянда | — |
| `kaia_listen` … `kaia_notify` | 0–14 | 15–17: the versions of styles 10–12 | 18–23: styles 13–18 | 24–27: catalog C's singles, per event |
| `kaia_wake` | 0–20 | 21–23: the wakes of styles 10–12 | 24–29: styles 13–18 | 30–33: Занавес, Кофе, Будильник, Спидометр |

A style's versions sit at look = style + 5 and wake = style + 11, as v1.8's do; the dispatch reads tables, not that
rule, so a later id can go anywhere. Catalog C's singles, looks 24–27 in the catalog's order:

| event | 24 | 25 | 26 | 27 |
|---|---|---|---|---|
| Слушает (`kaia_listen`) | Облака | Листопад | Дюны | Нить |
| Думает (`kaia_think`) | Спиннер | ДНК | Лабиринт | Сортировка |
| Говорит (`kaia_speak`) | Шёлк | Сфера | Телеграф | Брызги |
| Готово (`kaia_done`) | Радуга | Звезда | Солнце | Кубок |
| Ошибка (`kaia_error`) | Обвал | Трещина | Тучка | Замыкание |
| Уведомление (`kaia_notify`) | Вибрация | Птица | Стадион | Подарок |

Пламя is the catalog's default, the cold flame in Kaya's colour; the warm variant is not taken.

## Changes the firmware task copies (v1.9, part 1): catalog A's styles

KAIA-201's catalog as the owner accepted it (Снежинка, Светлячки and Пламя, each whole), in `src/nature.js`: integer-only
like `styles.js`, copied line by line (`test/nature.test.mjs` holds it). The code is the catalog's own, unchanged.

- **Ids**: `kaia_anim` 10–12 (`STYLE_COUNT` 12), looks 15–17 (`LOOK_COUNT` 18), wakes 21–23 (`WAKE_COUNT` 24). Every v1.8
  id (styles 1–9, looks 0–14, wakes 0–20) draws v1.8's frames bit for bit (`test/frames.mjs` `v18DigestOf`: 4698 frames,
  one SHA-256 taken on the sources of v1.8, main at 85c9f66).
- **Dispatch through tables** (PROGMEM `uint8_t`, about 70 bytes), in place of v1.8's `style + 5` / `style + 11`:
  - `look_style[LOOK_COUNT]` (`looks.js`): the style a look is the version of, 0 for none:
    `{0,0,0,0,0,0,0,0,0, 4,5,6,7,8,9, 10,11,12}`; `style_look[STYLE_COUNT + 1]`: `{0,0,0,0, 9,…,14, 15,16,17}`.
  - `wake_style[WAKE_COUNT]` (`wakes.js`): `{0 ×15, 4,5,6,7,8,9, 10,11,12}`; `style_wake[STYLE_COUNT + 1]`:
    `{0,1,2,3, 15,…,20, 21,22,23}`.
  - `lookOf(style, look)` = `look || style <= 3 ? look : style_look[style]`; `wakeOf(style, wake)` = `wake ? wake :
    style_wake[style]`.
  - `stateLook` / `shotLook`: `if (look_style[look]) styleState(look_style[look], …)` / `styleShot(look_style[look], …)`
    (was `look >= 9` with `look - 5`); `shotLength`: `fam_ms[look_style[look] - 4][n - A_DONE]`; `wakeDraw`:
    `if (wake_style[id]) styleShot(wake_style[id], A_WAKE, u, du, col)` (was `id >= 15`, `id - 11`). Part 3's singles
    (look_style 0, id ≥ 24) will get their own switch after these.
  - `styleState` / `styleShot` (`styles.js`): each switch gains `case 9` (Сканер, was the default), `case 10` (snow…),
    `case 11` (fly…), `default` (flame…).
- **Lengths**: `fam_ms` gains three rows (done, error, notify): 10 {1800, 1800, 1600}, 11 {1700, 1500, 1400}, 12 {1800,
  2000, 1500}; `wake_ms[21..23]` = 2000, 2000, 2000. The listening fades in over the wake's last 800 ms, as in v1.8.
- **Names**: `STYLE_NAMES` appends Снежинка, Светлячки, Пламя; every event's `LOOK_NAMES` appends them as 15–17, the
  wake's as 21–23. The classic page's «Стиль» Select lists 13, each event's Select 18, «Пробуждение» 24; settings.cpp's
  ranges: `kaia_anim` 0–12, the six looks 0–17, `kaia_wake` 0–23. Home's profile appends them by index (its own task).
- **Helpers** (`nature.js`, no tables of their own): `bell(x, w)` (a smoothstep of `tent`), `glint(i, t, rate)` (a
  ball's slow glitter from `h2`, `h3`); Снежинка: `flakeGeo(i)` (the ball's place on the flake from `b_col`, `b_row`:
  `D | s << 2 | k << 3`, or −1), `flakeLit(g, la, li, lb)`, `rime(i, t)`; Светлячки: `flyX(j, t)`, `flyY(j, t)`,
  `flyGlow(j, t)`, `flies(m, px, py, gl, col, g)`; Пламя: `flame(w, h, ph, col, g)`, `embers(nm, t, per, z0, col, g)`.
  From v1.6/v1.8: `tent`, `smooth`, `wave`, `voice`, `oct`, `posMod`, `mix`, `put`, `ringOf`, `b_dist`.
- **Small const tables** (PROGMEM, 94 bytes): `snow_fx[4]`, `snow_dx[4]`, `snow_dq[4]` (int8), `snow_dt[4]` (int16),
  `ff_bx[6]`, `ff_wx[6]`, `ff_wy[6]`, `ff_in[12]`, `em_x[8]`, `fl_bv[16]`, `fl_sv[20]` (int8). No per-ball tables.
- **Stack arrays a frame** (`[]` in the JS; the C++ gives them the size the loop fills): at most three `int[18]`
  (Светлячки · Хоровод: px, py, gl), else `int[12]` ×3 (Слетаются, Разлетелись), `int[10]` ×3 (Треск), `int[8]` ×3
  (embers, Костёр), `int[6]` (the flake's `lb`), `int[4]` ×2 (snow, drops), `int[3]` (the voices of Хор).
- **Cost per frame.** The static count of v1.8 (`costOf`) assumes every light of a loop on every ball; catalog A skips
  the balls far from a light with a cheap |dx|, |dy| test before it divides, so here the test counts the divisions a
  frame really runs (`cost.mjs` `styleDivs`: V8 block coverage over 2 s of frames, helpers and `put` included). v1.8's
  heaviest frame by that count is Пинг-понг · Смэш, 2010; Мордашка's wake, the slowest on the clock (3.2 ms by
  `GET /kaia/test`), runs 961. No new frame goes over 2010. The catalog measured the time in the browser against
  Мордашка's wake (× that); the browser charges function calls more than the ESP8266, where divisions dominate, so the
  two disagree on Светлячки · Хоровод (18 lights): `GET /kaia/test` will give the real times. At most 3 `voice()` a
  frame (Хор), no `hash8()`, no `inoise16`.

| style | event | function | name | length | divisions a frame | catalog: × Мордашка's wake | voice |
|---|---|---|---|---|---|---|---|
| 10 Снежинка | Пробуждение | `snowWake` | Иней | 2000 ms | 1447 | 1.64 | 0 |
|  | Слушает | `snowListen` | Блеск | 4.8 s a round, snow 5.2–7.3 s | 300 | 1.16 | 0 |
|  | Думает | `snowThink` | Иней на кончиках | 1.2 s | 439 | 1.16 | 0 |
|  | Говорит | `snowSpeak` | Рост голосом | voice | 367 | 0.92 | 2 |
|  | Готово | `snowDone` | Идеальная снежинка | 1800 ms | 807 | 0.88 | 0 |
|  | Ошибка | `snowError` | Оттепель | 1800 ms | 257 | 0.84 | 0 |
|  | Уведомление | `snowNotify` | Блик по кругу | 1600 ms | 432 | 1.04 | 0 |
| 11 Светлячки | Пробуждение | `flyWake` | Слетаются | 2000 ms | 487 | 1.80 | 0 |
|  | Слушает | `flyListen` | Огоньки | drift 17–36 s, glow 2.6–4.1 s | 392 | 1.12 | 0 |
|  | Думает | `flyThink` | Хоровод | 3 s a turn | 731 | 3.12 | 0 |
|  | Говорит | `flySpeak` | Хор | voice | 413 | 1.24 | 3 |
|  | Готово | `flyDone` | Рой | 1700 ms | 598 | 1.24 | 0 |
|  | Ошибка | `flyError` | Разлетелись | 1500 ms | 481 | 1.36 | 0 |
|  | Уведомление | `flyNotify` | Вспышка | 1400 ms | 368 | 1.04 | 0 |
| 12 Пламя | Пробуждение | `flameWake` | Розжиг | 2000 ms | 1216 | 0.68 | 0 |
|  | Слушает | `flameListen` | Тихий огонь | tongues ~2.8 s, an ember every 1.7 s | 1217 | 1.68 | 0 |
|  | Думает | `flameThink` | Пляска | ~1.5 s | 1454 | 1.92 | 0 |
|  | Говорит | `flameSpeak` | Голос огня | voice | 1435 | 1.08 | 1 |
|  | Готово | `flameDone` | Костёр | 1800 ms | 1933 | 1.96 | 0 |
|  | Ошибка | `flameError` | Угасание | 2000 ms | 1219 | 0.80 | 0 |
|  | Уведомление | `flameNotify` | Треск | 1500 ms | 1554 | 2.16 | 0 |

- **Long states**: a state multiplies t by at most 469 (`voice`; the glints 123, the glows 97, the rounds 256): exact in
  a 32-bit `int` for 76 minutes of one state, as v1.6's.
- **Deliberate differences**: none in the code. One thing the owner may want to know: Светлячки · Разлетелись's
  fireflies have flown past the edges by 0.73 s, so the rest of its 1.5 s is the empty display (the time stays hidden
  under it); that is how the catalog plays it.
- **Size**: the page is 69,821 B gzipped (v1.8: 64,345 B), the three styles, their names and the grouped picker.

## Changes the firmware task copies (v1.9, part 2): catalog B's styles

KAIA-202's catalog as the owner accepted it (all six families, each whole), in `src/games.js`: integer-only like
`nature.js`, copied line by line (`test/games.test.mjs` holds it). The code is the catalog's own, re-indented; the
42 functions draw the catalog's frames bit for bit (checked against the catalog page's own script over every 37 ms of
every animation, and to 72 minutes of the two states changed below).

- **Ids**: `kaia_anim` 13–18 (`STYLE_COUNT` 18), looks 18–23 (`LOOK_COUNT` 24), wakes 24–29 (`WAKE_COUNT` 30).
  Every id of v1.8 and of part 1 draws its frames bit for bit (`test/frames.mjs` `v18DigestOf` and `v19aDigestOf`:
  4896 frames of styles 1–12, looks 0–17, wakes 0–23, one SHA-256 taken on the sources of part 1, main at 2924f2c).
- **Dispatch**: the tables of part 1 grow, nothing else changes. `look_style` appends `13, 14, 15, 16, 17, 18` (looks
  18–23), `style_look` appends `18, …, 23`; `wake_style` appends `13, …, 18` (wakes 24–29), `style_wake` appends
  `24, …, 29`. `styleState` / `styleShot` (`styles.js`): each switch gains `case 12` (flame…, was the default),
  `case 13` arc…, `case 14` tet…, `case 15` gear…, `case 16` neon…, `case 17` pend…, `default` gar….
- **Lengths** (wake, done, error, notify), as the catalog gives them: Аркада 1800, 1700, 1700, 1500; Тетрис 2000, 1600,
  1800, 1500; Механизм 2000, 1600, 1600, 1600; Неон 2000, 1600, 1700, 1500; Маятник 2000, 1600, 1700, 1400; Гирлянда
  2000, 1700, 1700, 1500. So `fam_ms` gains six rows (done, error, notify) and `wake_ms[24..29]` = 1800, 2000, 2000,
  2000, 2000, 2000. The listening fades in over the wake's last 800 ms, as in v1.8.
- **Names**: `STYLE_NAMES` appends Аркада, Тетрис, Механизм, Неон, Маятник, Гирлянда; every event's `LOOK_NAMES` appends
  them as 18–23, the wake's as 24–29. The classic page's «Стиль» Select lists 19, each event's Select 24, «Пробуждение»
  30. settings.cpp's ranges: `kaia_anim` 0–18, the six looks 0–23, `kaia_wake` 0–29. Home's profile appends them by
  index (its own task).
- **Helpers** (`games.js`, no tables of their own unless named): `psin(a)`, `pcos(a)` (sin8 − 128), `pang(dx, dy)`
  (an angle without atan, one division); Аркада: `chomp(dp, dq, r, dir, m)`, `ghost(dp, dq, t)`, `arcDot(i, p, t)`;
  Тетрис: `tetStack(r, p)`, `tetQ(r, p, j)`, `tetPlace(xs, ys, j0, x, y, ang)`, `tetAt(p, q, xs, ys, n)`; Механизм:
  `gear(i, x0, r0, R, N, th)`, `gears(i, th)`; Неон: `neon(d)`, `neonTrace(p, q, h)`; Маятник: `pendX(px, th)`,
  `pendY(th)`; Гирлянда: `garCol(k, c0)`, `garPut(i, p, q, g, cb, w, k)`. From v1.6/v1.8: `oct`, `segDist`, `tent`,
  `smooth`, `wave`, `voice`, `posMod`, `mix`, `put`, `ringOf`, `b_pos`, `ring_len`, `b_ang`. No `h1`–`h3`, no
  `hash8`, no `inoise16`; at most 3 `voice()` a frame.
- **Small const tables** (PROGMEM, 149 bytes at the narrowest types; the catalog's «about 230 B» counts int16s):
  `arc_ch[6]`, `tet_pc[8]`, `tet_cx[4]`, `tet_lx[3]`, `neon_pt[16]`, `neon_ck[6]`, `neon_ar[12]`, `gar_b[22]` (int8);
  `tet_sh[3]`, `tet_la[3]`, `neon_len[8]`, `gar_ph[11]`, `gar_sp[11]` (uint8); `tet_dt[4]` (int16); `tet_st[3]` (the
  stack's three 20-bit rows) and `gar_pal[4]` (colours) (uint32). No per-ball tables.
- **Colours**: `C_STEM` 0x5fd05a (the cherries' stems), `C_PINK` 0xff3fa8 (Неон's second tube), `C_WIRE` 0xffe2b0
  (the garland's wire), `C_WARM` 0xfff0d8 (every fourth bulb, in place of Kaya's colour, in Ошибка and Уведомление).
- **Stack arrays a frame** (`[]` in the JS; the C++ gives them the size the loop fills): `int[12]` ×2 and `int[3]`
  (Тетрис · Ливень), `int[4]` ×2 (a piece; Тетрис · Стопка's falls), `int[3]` ×2 and `int[4]` (Маятник · Качание),
  `int[11]` and `uint32_t[11]` (every Гирлянда: brightness and colour per bulb), `int[4]` (a segment for `segDist`),
  `int[3]` (three voices).
- **Arithmetic right shifts.** `>>` on a negative int rounds down in JS (−4 >> 3 is −1), and GCC's `>>` on `int` does
  the same (implementation-defined before C++20, arithmetic in GCC and required from C++20). Four places rely on it:
  `tetPlace`'s `(ox * cs - oy * sn + 64) >> 7` and `(ox * sn + oy * cs + 64) >> 7` (a piece's block left or above
  its centre), `tetStack`'s `(p + 76 - 4 * (r - 3)) >> 3` (a ball left of the stack's row gives k < 0, so nothing),
  and Маятник · Обрыв's `sx >> 1` and `(sy - 45) >> 1` (the half string left after the snap). Keep them `>>`: `/ 2`
  or `/ 8` round towards 0 and move those balls by one (`games.test.mjs` holds the shifts).
- **Long states.** The firmware's `wave(int t, int w)` computes `t * w` in a 32-bit `int`, and `GET /kaia/test` draws
  every state at 70 minutes. The catalog's Аркада · Погоня had `wave(t, 640)` and the ghost's `wave(t, 768)`, and
  Гирлянда · Бегущие огни `t * 1536 / 1000`: those overflow after 56, 47 and 23 minutes of one state. Each term repeats
  exactly (every 400, 1000 and 500 ms), so here they take `posMod(t, 400)`, `tg = posMod(t, 1000)` (passed to `ghost`)
  and `posMod(t, 500)`: the same frames bit for bit, and the largest factor of t in a state is again `voice`'s 469
  (exact for 76 minutes). These are the only differences from the catalog's code.
- **Cost per frame.** The divisions a frame really runs (`cost.mjs` `styleDivs`, as in part 1). v1.8's heaviest frame is
  Пинг-понг · Смэш, 2010; KAIA-202 was held to about 3× v1.8's heaviest. Two of the 42 go over 2010: **Маятник · В
  такт, 4317** (five balls, each with its string's `segDist` and `tent` on every ball) and Маятник · Прыжки, 2185. The
  catalog measured its frames in the browser against Мордашка's wake (3.2 ms on the clock by `GET /kaia/test`, 961
  divisions); its report gave the heaviest as Маятник · В такт ≈ 4.9 ms, then Неон · Схема ≈ 4.4 and Гирлянда ·
  Перегорела ≈ 4.2. A re-run of the catalog page here gave the column below (В такт 7.4 ms): browser timings drift from
  run to run, the division counts do not. Both put В такт first. `GET /kaia/test` will give the real times; the
  budget is the 50 ms frame.

| style | event | function | name | length | divisions a frame | catalog page: ms (est.) | voice |
|---|---|---|---|---|---|---|---|
| 13 Аркада | Пробуждение | `arcWake` | Забег | 1800 ms | 370 | 2.4 | 0 |
|  | Слушает | `arcListen` | Патруль | 8.8 s there and back | 300 | 4.0 | 0 |
|  | Думает | `arcThink` | Погоня | 2.6 s a round | 375 | 2.6 | 0 |
|  | Говорит | `arcSpeak` | Ам-ам | voice | 299 | 1.6 | 1 |
|  | Готово | `arcDone` | Энерджайзер | 1700 ms | 958 | 4.0 | 0 |
|  | Ошибка | `arcError` | Пойман | 1700 ms | 567 | 4.2 | 0 |
|  | Уведомление | `arcNotify` | Бонус | 1500 ms | 1247 | 3.0 | 0 |
| 14 Тетрис | Пробуждение | `tetWake` | Стопка | 2000 ms | 350 | 3.6 | 0 |
|  | Слушает | `tetListen` | Фигура | a piece every 6 s, four columns | 426 | 3.5 | 0 |
|  | Думает | `tetThink` | Ливень | 0.9 s | 434 | 2.8 | 0 |
|  | Говорит | `tetSpeak` | Верхний ряд | voice | 438 | 1.2 | 3 |
|  | Готово | `tetDone` | Линия | 1600 ms | 449 | 3.4 | 0 |
|  | Ошибка | `tetError` | Конец игры | 1800 ms | 1546 | 3.8 | 0 |
|  | Уведомление | `tetNotify` | Новая фигура | 1500 ms | 415 | 2.3 | 0 |
| 15 Механизм | Пробуждение | `gearWake` | Завод | 2000 ms | 904 | 2.8 | 0 |
|  | Слушает | `gearListen` | Ход | 12 s a turn, breath 5.7 s | 899 | 2.4 | 0 |
|  | Думает | `gearThink` | Быстрый ход | 1.5 s a turn | 773 | 2.7 | 0 |
|  | Говорит | `gearSpeak` | Тик | voice | 911 | 2.6 | 1 |
|  | Готово | `gearDone` | Щелчок | 1600 ms | 1403 | 5.9 | 0 |
|  | Ошибка | `gearError` | Заклинило | 1600 ms | 1084 | 5.4 | 0 |
|  | Уведомление | `gearNotify` | Кукушка | 1600 ms | 1144 | 6.5 | 0 |
| 16 Неон | Пробуждение | `neonWake` | Зажигание | 2000 ms | 489 | 2.8 | 0 |
|  | Слушает | `neonListen` | Гул | 6.4 s, breath 6.9 s | 519 | 1.0 | 0 |
|  | Думает | `neonThink` | Схема | 2.27 s a round | 1897 | 6.0 | 0 |
|  | Говорит | `neonSpeak` | Пульс трубок | voice | 476 | 0.7 | 2 |
|  | Готово | `neonDone` | Неоновая галочка | 1600 ms | 1166 | 3.8 | 0 |
|  | Ошибка | `neonError` | Искрит | 1700 ms | 653 | 1.9 | 0 |
|  | Уведомление | `neonNotify` | Стрелка | 1500 ms | 1596 | 4.2 | 0 |
| 17 Маятник | Пробуждение | `pendWake` | Толчок | 2000 ms | 1101 | 4.4 | 0 |
|  | Слушает | `pendListen` | Качание | 2.8 s | 1109 | 2.4 | 0 |
|  | Думает | `pendThink` | Колыбель Ньютона | 1.2 s | 716 | 4.5 | 0 |
|  | Говорит | `pendSpeak` | Прыжки | voice | **2185** | 3.4 | 3 |
|  | Готово | `pendDone` | В такт | 1600 ms | **4317** | 7.4 | 0 |
|  | Ошибка | `pendError` | Обрыв | 1700 ms | 968 | 2.8 | 0 |
|  | Уведомление | `pendNotify` | Тик-так | 1400 ms | 1020 | 4.8 | 0 |
| 18 Гирлянда | Пробуждение | `garWake` | По цепочке | 2000 ms | 855 | 4.4 | 0 |
|  | Слушает | `garListen` | Мерцание | each bulb 3.9–6.6 s | 803 | 3.1 | 0 |
|  | Думает | `garThink` | Бегущие огни | 0.5 s | 837 | 3.3 | 0 |
|  | Говорит | `garSpeak` | Вспышки | voice | 810 | 3.7 | 3 |
|  | Готово | `garDone` | Праздник | 1700 ms | 842 | 4.0 | 0 |
|  | Ошибка | `garError` | Перегорела | 1700 ms | 1244 | 5.1 | 0 |
|  | Уведомление | `garNotify` | Двойной бег | 1500 ms | 834 | 3.0 | 0 |

- **Size**: the page is 78,820 B gzipped (part 1: 69,821 B), with the six styles, their names and the picker's texts:
  about 9 KB of the 96 KB limit.

The six styles, as the owner saw them in KAIA-202 (each animation's comment in `games.js` says what it does). In the
«Стиль» picker, Аркада, Тетрис, Механизм and Маятник join Пинг-понг in «Игры», and Неон and Гирлянда join Калейдоскоп in
«Узоры и свет», as KAIA-201's design placed them:

| id | style | what |
|---|---|---|
| 13 | Аркада | an 8-bit chomper in Kaya's colour (a two-ball disc with a wedge of a mouth), a violet ghost (a dome of seven balls with white eyes), dots on every other ball of the middle row, a power dot at the left edge |
| 14 | Тетрис | blocks on the diagonal grid: a block is a ball, a piece four, the stack the three bottom rows (`tet_st`); pieces fall by the grid's step and turn by 60°, which maps the grid onto itself |
| 15 | Механизм | two big wheels on the grid's own hex rings (6 teeth on 18 balls) meshed in the middle, turning against each other, and a pinion at each edge three times as fast |
| 16 | Неон | neon tubes in the dark: a white-hot core, a faint glow; the frame is the rim (ring 0) in Kaya's colour, the second tube (ring 2) pink |
| 17 | Маятник | a pendulum hung above the top edge at (0, −45), 53 long: the bob hangs in the middle of row 4; the angle goes as a sine, fast at the bottom and still at the ends |
| 18 | Гирлянда | 11 bulbs on a sagging wire, one ball each, in turn Kaya's colour, amber, rose and green (`gar_pal`); no halo, so neighbouring colours never mix; done, error and notify take the event's colour |

## Kaya's looks per event (v1.6)

Every event lists 0 «Как у стиля» and 1–3 Рябь, Орбита, Искры first (the style versions of v1.5; one-shot lengths
`shot_ms` 1200–1600). The new ones, by id. A one-shot fades out over its last 300 ms (a wake over its last 400 ms of
its own time); states run until the call's ms ends. v1.8 appends 9–14 to every event: the versions of styles 4–9
(Пинг-понг, Калейдоскоп, Лава-лампа, Мордашка, Галактика, Сканер; see the table above), v1.9 15–17 (Снежинка,
Светлячки, Пламя).

### Слушает (`kaia_listen`, Kaya's colour; a loop)

| id | name | loop | what |
|---|---|---|---|
| 4 | Эхо | 1.6 s | arcs come in from both sides to the middle; the outer columns keep a faint glow |
| 5 | Прилив | 4 s (exact 64 s) | water in the bottom rows rises and falls, its surface rolls; the crest is whiter |
| 6 | Сияние | 6.4 s and 9.5 s | slow curtains of light hang from the top rows and drift |
| 7 | Взгляд | 6.9 s × 4.2 s | a soft spot drifts round the display, as if Kaya's attention follows the owner |
| 8 | Пузырьки | 2.2–3.2 s a bubble | ten bubbles rise from the bottom and wobble; each is dark where it wraps |

### Думает (`kaia_think`, Kaya's colour half violet)

| id | name | loop | what |
|---|---|---|---|
| 4 | Змейка | 3.5 s | a snake runs the rows back and forth, like a loading bar |
| 5 | Нейроны | a flash every 0.25 s | a ball fires and a ring spreads three balls out; its place is hash8 of its number, so it never wraps |
| 6 | Песочные часы | 3 s | sand runs from the top bulb to the bottom one in 2.7 s, then the glass turns over |
| 7 | Три точки | 1.2 s | the «typing» dots in the bottom rows jump one after another |
| 8 | Атом | 1.3, 1.5, 1.7 s a turn | three electrons on tilted ellipses with short tails; the nucleus throbs |

### Говорит (`kaia_speak`, Kaya's colour, all driven by `voice(t)`)

| id | name | loop | what |
|---|---|---|---|
| 4 | Эквалайзер | voice | 13 bars grow up and down from the middle row; the top of a bar is whiter |
| 5 | Осциллограф | voice | a wave line along the middle; its height follows the voice, spreading from the centre |
| 6 | Лучи | voice | 18 rays from the centre along the spark paths, each one's length a little later |
| 7 | Динамики | voice | two speakers left and right; their cones push out (the right one 60 ms later) |
| 8 | Губы | voice | lips across the middle: a line in a pause, open with the voice |

### Готово (`kaia_done`, green unless the call gives a colour)

| id | name | length | what |
|---|---|---|---|
| 4 | Галочка | 1600 ms | a big check drawn stroke by stroke with a white pen (0.1–0.7 s), a flash, it holds; the time steps back |
| 5 | Шкала | 1500 ms | a bar fills the display left to right with a rolling front (0–0.8 s), flashes at 100 % |
| 6 | Конфетти | 1800 ms | 16 bits burst from the middle, fly up and out, turn and fall |
| 7 | Кольцо | 1700 ms | a ring round the middle closes from 12 o'clock both ways, its inside flashes, a wave goes out |
| 8 | «ОК» | 1600 ms | «OK» stamped in white with a shock ring, then green; the time steps back |

### Ошибка (`kaia_error`, red unless the call gives a colour)

| id | name | length | what |
|---|---|---|---|
| 4 | Нет-нет | 1400 ms | a ring round the middle shakes its head three times, smaller each time |
| 5 | Крест | 1600 ms | a big cross drawn stroke by stroke (0.1–0.75 s), blinks twice; the time steps back |
| 6 | Сбой | 1300 ms | the display glitches for 1 s: rows tear in 70 ms bursts, frames flash, the time flickers out |
| 7 | Сирена | 1600 ms | two beams 180° apart turn round a lamp in the middle, 2½ turns |
| 8 | Отключение | 1500 ms | like an old TV switched off: a flash, the picture squeezes into a line, the line into a dot |

### Уведомление (`kaia_notify`, amber unless the call gives a colour)

| id | name | length | what |
|---|---|---|---|
| 4 | «!» | 1500 ms | a big «!» in the middle columns blinks three times, each blink starting white |
| 5 | Тук-тук | 1500 ms | two knocks, a pause, two knocks: the bottom row flashes and an arc rises from under it |
| 6 | Маяк | 1600 ms | a lighthouse beam from under the bottom edge sweeps left to right; a flash as it faces you |
| 7 | Конверт | 1700 ms | an envelope slides in from the left, settles, its flap flashes white; the time steps back |
| 8 | Значок | 1600 ms | a badge drops into the top right corner, bounces, pings twice and stays lit |

## The wakes (kaia_wake)

| id | name | base length (100 %) | what |
|---|---|---|---|
| 0 | Как у стиля | the style's: 1900 / 2000 / 2000; 4–9: theirs | the style's own wake (the default); with style 4–9 its wake 15–20 |
| 1 | Рябь | 1900 | three rings out of the centre (rippleShot); listening fades in from 1100 |
| 2 | Орбита | 2000 | a comet speeds round the rim, the rings close like an iris (orbitShot); from 1500 |
| 3 | Искры | 2000 | 18 sparks fly in, the mark pops (sparksShot); from 1600 |
| 4 | Рассвет | 2000 | the dawn rises from the bottom row |
| 5 | Радар | 1800 | one beam turn from 12 o'clock with a trail and blips |
| 6 | Спираль | 2000 | two arms unwind from the centre |
| 7 | Сердцебиение | 1900 | a 7×5 heart beats twice; the time hides on purpose |
| 8 | Глаз | 2200 | a slit opens into an eye, the pupil looks left and right, a blink |
| 9 | Звёзды | 2000 | stars twinkle denser, then a flash |
| 10 | Салют | 2200 | a rocket up the middle, a burst along the spark paths, glitter |
| 11 | Дождь | 2000 | drops run down both diagonals |
| 12 | Включение | 1800 | like an old TV switched on: a dot, a line along the middle row, the picture opens (v1.6) |
| 13 | Зайчик | 2000 | a spot of light bounces off the edges like a sunbeam from a mirror, with a short trail (v1.6) |
| 14 | «КАЯ» | 2200 | Kaya writes her name column by column with a white pen, holds it, and it scatters (v1.6) |
| 15–20 | Пинг-понг … Сканер | 1800, 2000, 2000, 1900, 2000, 2000 | the wakes of styles 4–9 (v1.8): Подача, Мандала, Всплытие, Просыпается, Большой взрыв, Запуск |

`kaia_wake_speed` 50–200 %: the wake runs on u = t·speed/100 and lasts base·100/speed (e.g. Глаз at 150 %:
1466 ms); the listening under it and after it keeps real time and is the listening's look (`kaia_listen`). The
themed wakes fade out over their last 400 ms of u and the listening fades in over the last 800.

### Formulas and timings of the wakes

These were on the page in v1.5 («Пробуждения по кадрам», the formula box, «Формулы и тайминги…»); v1.6 keeps them
here. t and u in ms, d = `b_dist` (quarter-balls), x = `b_x` (half-balls, 19 = the middle), row 0..6, ang = `b_ang`.

- **1 Рябь** (rippleShot): three rings out of the centre, a whitish flash at the start.
  r_k = (t − 220k)·0.544 (k = 0..2, 1/16 quarter-ball); f_k = (832 − r_k)/832;
  a = max(fl·tent(16d, 176), max_k tent(16d − r_k, 88)·f_k)·242/255; fl = 255·(1 − t/350), the colour 70 % towards
  white with fl. 0–1.9 s; the listening from 1.1 s. Tables: b_dist.
- **2 Орбита** (orbitShot): a comet speeds up round the rim, then the rings close like an iris.
  h = 6tc + 50.69tc³ balls, tail = 6 + 36.4tc, tc = min(t, 1100)/1000; rim: a = 26 + 230·comet(pos, h, n0, tail)/255;
  t > 1100: rings 1..3 flash at 1100 + 150r ms: 217·tent(t − …, 220). 0–2.0 s; the listening from 1.5 s.
  Tables: b_pos, the rings, ring_len.
- **3 Искры** (sparksShot): 18 sparks fly from the rim to the centre, the mark flashes and settles.
  j = (u/750)^1.6·len, a tail of 4 balls 255/153/77/31 (u = t − 45·((7k) mod 18)); t > 1500: a ring
  102·tent(16d − r, 80), r = (t − 1500)·0.64; mark(g): g = 217·arrived/18 → a flash at 1550 → the breath.
  0–2.0 s; the listening from 1.6 s. Tables: spark[18][12], the lens.
- **4 Рассвет**: the dawn rises from the bottom row to the top, whiter at its edge, brighter in the middle.
  F = smooth(0, 1500, u)·140/255 (the edge, 1/16 row from the bottom); dp = F − 16·(6 − row);
  dp < −24: 0; −24..0: the glow 90·(24 + dp)/24; dp ≥ 0: a = (70 + 185·max(0, 96 − dp)/96)·(190 + 65·(255 − 4|x − 19|)/255)/255,
  the colour mix(Kaya, white, 140·max(0, 48 − dp)/48); fo = smooth(du, du − 400, u).
  0–1.5 s rising, holds to 1.6, out by 2.0; the listening from 1.2 s. Tables: row, x.
- **5 Радар**: one beam turn clockwise from 12 o'clock with a trail; some balls light up as blips.
  th = u·256/1400; dl = th − ang (dl < 0: nothing); the trail ((96 − dl)/96)² for dl < 96, the head (dl < 12) whiter;
  a blip: h1 < 34 and dl < 150 → max(a, 215·(150 − dl)/150), white; weight by radius (150 + 105·d/38)/255;
  the hub tent(u − 100, 300) for d < 10. 0–1.4 s the turn, out by 1.8 s. Tables: b_ang, b_dist, h1.
- **6 Спираль**: two arms unwind from the centre to the rim and turn.
  R = smooth(0, 1250, u)·46/255 (the front, quarter-balls); rho = u·256/1700; v = (2·ang + 7d − rho) & 255,
  dd = min(v, 256 − v); a = tent(dd, 56)·(255 − 3d)/255 for d ≤ R; the front (R − d < 7) whiter; the centre
  flashes tent(u − 150, 350)·(9 − d)/9 for u < 500. 0–1.25 s the arms grow, they turn until 2.0 s. Tables: b_ang, b_dist.
- **7 Сердцебиение**: the time steps away on purpose; a heart beats twice (lub-dub) and melts into the listening.
  beat(q, pk) = q < 90 ? pk·q/90 : max(0, pk − pk·(q − 90)/380); env = max(beat(u − 150, 255), beat(u − 540, 190));
  hide = smooth(0, 140, u)·fo/255, dimAll(255 − 200·hide); the heart 0x36 0x7f 0x7f 0x3e 0x08: a = 60 + 195·env/255,
  towards white 110·env/255; a halo on the lens-1 balls 70·env/255. Beats at 0.15 and 0.54 s, holds to 1.5, out by 1.9 s.
  Tables: the lens, pict().
- **8 Глаз**: a slit along the middle row opens into an eye; the pupil looks left, right and back; a blink.
  w = smooth(0, 250, u)·17/255 (the slit's half-length); o = smooth(250, 950, u)·(255 − 215·smooth(1750, 1980, u)/255)/255;
  ax = |x − 19|, dr = row − 3; H = o·(255 − (255·ax/17)²/255)/255, m = H − 85|dr|; m ≥ 0: 45 (the white);
  a = max(a, 230·tent(m, 64)/255) (the lid); the pupil: px = 4(x − 19) − off, d2 = px² + (7dr)², d2 ≤ 169 → 255,
  fading to 340. 0–0.25 the slit, to 0.95 it opens, looks 1.0–1.7, blinks 1.75–1.98, until 2.2 s. Tables: row, x.
- **9 Звёзды**: stars twinkle denser and denser, then one flash from the centre.
  dth = 10 + smooth(0, 1250, u)·240/255; h1 < dth → a star: ph = h2 + u·(220 + (h3 & 63))/1000,
  s = 255 − 2|ph − 128|, a = s²/255; the flash tent(u − 1500, 200)·(255 − 3d)/255, white.
  0–1.25 s denser, the flash 1.3–1.7 s, until 2.0 s. Tables: h1, h2, h3.
- **10 Салют**: a rocket up the middle column bursts: 18 rays along the spark paths, then glitter.
  The rocket (u < 780): hr = 96 − smooth(0, 720, u)·48/255, columns |x − 19| ≤ 1; the burst q = u − 780: a flash
  tent(q − 70, 160)·tent(d, 16); the rays: head = (len − 1)·e, e = x(2 − x), x = min(q, 650)/650; glitter q > 400:
  t2 = q − 400 − h2·5/3, 0..500 → 220·(500 − t2)/500 where h3 < 120 and d > 10.
  The rocket 0–0.78 s, the burst 0.78–1.43, glitter to 2.1, until 2.2 s. Tables: spark, row, x, h2, h3.
- **11 Дождь**: drops run down both diagonals of the grid with a faint trail.
  Stream A: key = col; stream B: key = col − row + 6; head = (u − delay(key))·128/1000 − 16 (8 rows a second);
  delay_A = ((37key + 11) & 31)·26, delay_B = ((29key + 5) & 31)·26 + 110; df = head − 16·row;
  0 ≤ df < 96: ((96 − df)/96)², df ≥ 96: 26 (the trail). Drops 0–1.7 s, the trail until 2.0 s. Tables: col, row.
- **12 Включение**: 0–200 ms a white dot in the middle (d < 3); 200–600 the middle row, |x − 19| ≤ hw + 1,
  hw = 20·smooth(200, 550, u)/255; 600–950 the picture opens, hv = 56·smooth(600, 950, u)/255 (1/16 row), its edges
  whiter; it settles to 65 (950–1400). 1.8 s; the listening from 1.0 s.
- **13 Зайчик**: P = a triangle wave of u·150/1000 over ±60, Q = of u·56/1000 over ±14 (it bounces off the edges);
  the spot r = 14 (255, towards white 170), 3 trail points 45 ms apart (r = 10: 170, 130, 90); brightness
  smooth(0, 150, u)·(255 − smooth(1300, 1700, u))/255. 2.0 s: it bounces 0–1.3 s, out by 1.7 s; the listening from 1.2 s.
- **14 «КАЯ»**: `pict_kaya` (11×5: 0x523 0x655 0x473 0x655 0x555) drawn like a clock glyph; pixel (gx, gy) shows at
  100 + 70gx + 10gy ms, white for its first 0.2 s; it scatters at 1450 + 40·((7gx + 3gy) mod 11) ms in 0.15 s;
  the time hides (dimAll 55, 0.2–1.5 s) and comes back by 1.9 s; fr.dg = 255. 2.2 s; the name is whole at 0.9 s.

## The palettes (back_pal)

`back_pal` 0–60: 0–30 never move (the saved setting and Home's palette list use the index); 31–60 are KAIA-172's,
appended to `paletteArr` and `paletteList` in `firmware/src/palettes.cpp` (38–40 resampled from FastLED's
Pacifica.ino and TwinkleFox.ino). Each new one loops (its last stop is its first). The picker shows the Russian names
and groups below; the clock's list keeps the Latin names.

| index | name | picker | group |
|---|---|---|---|
| 0 | HeatColors | Жар | Огонь |
| 1 | Fire | Огонь | Огонь |
| 2 | WoodFireColors | Дрова | Огонь |
| 3 | NormalFire | Пламя | Огонь |
| 4 | LithiumFireColors | Литий | Тёплые |
| 5 | SodiumFireColors | Натрий | Огонь |
| 6 | CopperFireColors | Медь | Природа |
| 7 | AlcoholFireColors | Спирт | Холодные |
| 8 | LavaColors | Лава | Огонь |
| 9 | PartyColors | Вечеринка | Неон |
| 10 | RainbowColors | Радуга | Неон |
| 11 | RainbowStripeColors | Радуга-полосы | Неон |
| 12 | CloudColors | Облака | Холодные |
| 13 | OceanColors | Океан | Холодные |
| 14 | ForestColors | Лес | Природа |
| 15 | Sunset_Real | Закат | Тёплые |
| 16 | Dkbluered | Сине-красная | Разное |
| 17 | OptimusPrime | Оптимус | Разное |
| 18 | WarmGrad | Тёплая | Тёплые |
| 19 | ColdGrad | Холодная | Холодные |
| 20 | HotGrad | Горячая | Огонь |
| 21 | PinkGrad | Розовая | Тёплые |
| 22 | Comfy | Уют | Разное |
| 23 | Cyperpunk | Киберпанк | Неон |
| 24 | Girl | Девчачья | Тёплые |
| 25 | Xmas | Новый год | Разное |
| 26 | Acid | Кислота | Неон |
| 27 | BlueSmoke | Синий дым | Спокойные |
| 28 | Gummy | Мармелад | Неон |
| 29 | Leo | Лев | Разное |
| 30 | Aurora | Аврора | Природа |
| 31 | Amber | Янтарь | Тёплые |
| 32 | Candle | Свеча | Тёплые |
| 33 | Terracotta | Терракота | Тёплые |
| 34 | PeachFizz | Персик | Тёплые |
| 35 | Coral | Коралл | Тёплые |
| 36 | Honey | Мёд | Тёплые |
| 37 | Embers | Угли | Огонь |
| 38 | Pacifica | Пасифика | Холодные |
| 39 | PacificaDeep | Тихий океан | Холодные |
| 40 | IceTwinkle | Лёд | Холодные |
| 41 | Glacier | Ледник | Холодные |
| 42 | Lagoon | Лагуна | Холодные |
| 43 | Twilight | Сумерки | Спокойные |
| 44 | Moonlight | Лунный свет | Спокойные |
| 45 | Meadow | Луг | Природа |
| 46 | Moss | Мох | Природа |
| 47 | Autumn | Осень | Природа |
| 48 | Sakura | Сакура | Природа |
| 49 | Dunes | Дюны | Природа |
| 50 | Tropics | Тропики | Природа |
| 51 | Dawn | Заря | Тёплые |
| 52 | NeonNight | Неон | Неон |
| 53 | Synthwave | Синтвейв | Неон |
| 54 | Toxic | Токсик | Неон |
| 55 | Electric | Электрик | Неон |
| 56 | Candy | Леденец | Неон |
| 57 | Laser | Лазер | Неон |
| 58 | Ultraviolet | Ультрафиолет | Неон |
| 59 | Linen | Лён | Спокойные |
| 60 | DuskMist | Дымка | Спокойные |

## The site's API (BallClock v1.5)

All calls: same origin, relative URLs (`kaia/state`, `settings?…`), GET, one at a time, 5 s each. With a page
password every call carries `auth=<hash32(password) as lowercase hex>`; hash32 is h = h·33 + c over the bytes of
the string, uint32, from 0 (as Home/src/gyver/driver.ts). A 401 asks for the password; the page remembers it in
this browser (`localStorage`) until «Выйти».

Unchanged from v1.4.1:
- `GET /kaia/state` → `{name, version, time, synced, rssi, light, bright, night, overlay, anim, uptime, reset, heap, block, crash, settings}`;
  `settings`: every key of the classic page but wifi_ssid, wifi_pass and page_pass, plus night_trsh and log_host.
- `GET /kaia/anim?name=wake|listening|thinking|speaking|done|error|notify|off[&color=RRGGBB][&ms=100–60000]` → `{ok:true}`.
- `GET /settings?action=set&id=<hex>&value=<raw>`, `GET /settings?action=click&id=<hex>` (the answer is not read).
  id = `keyId(key)` = hash32(key) & 0x1fffffff; the full hash32 for wifi_save, check_updates, ota_update.
  Raw values: numbers in decimal, a switch 0/1, a colour as its 24-bit number in decimal, a time as seconds since
  midnight, text as it is. Buttons: click wifi_save after setting wifi_ssid and wifi_pass; click check_updates;
  click adc_min / adc_max. The update: set id hash32("ota_update") = b7d52286, value 1.

New in v1.5:
- `/kaia/state` adds `ms` (millis() of the answer: the preview's time base), `update` (a newer firmware waits) and
  `play`: null or `{name, style (1–3), wake (0–N), speed (50–200), t (ms since it started), color ("RRGGBB")}`.
  The page reads `color` as the colour it is drawn with: the call's colour, or the default (Kaya's colour; green,
  red, amber for done, error, notify). A wake that turned into listening shows as listening, its `t` from the
  listening's start. A running text is overlay "text" with play null. Settings gain `kaia_wake` and `kaia_wake_speed`.
- `GET /kaia/frame` → `{ms, bright, night, leds}`: 768 hex characters, LED 0…127 RRGGBB as drawn. The page asks
  at most 4 a second, one at a time, only while the mirror is shown and the tab is visible.
- `GET /kaia/wifi` → `{ssid, ip, rssi, ap}` (never a password).
- `/kaia/anim` adds `style=1–3`, `wake=0–N`, `speed=50–200`: a try-out, nothing is saved; an explicit style plays
  even when the saved one is «Выкл».
- `GET /` and `/index.html` serve this site (gzip, ETag, Cache-Control: no-cache); every other path keeps the
  classic page, linked as `old`.
- With a page password, set and click without the right auth → 401.

New in v1.5.1:
- `update` stays true while a newer firmware waits (before, the first poll used it up). `/kaia/state` adds
  `update_last`: null, or the result of the last update over the air as the log wrote it, e.g.
  `"result=ok from=1.5.1 kb=645"`, `"result=lowmem try=1 free=… block=… need=…"`,
  `"result=connect try=3 stage=connect kb=0/0 heap=… block=… ssl=-1000"`, `"result=crash try=1 stage=write kb=256/645 …"`,
  `"result=wifi ms=20000"`. See `../firmware/README.md`.
- The update (ota_update = 1) answers, then the clock restarts within 0.5 s and updates before its server starts:
  for about a minute the page gets no answer (connection refused), then the new version, or the old one with
  `update_last` saying why.

New in v1.5.3:
- `GET /` answers 304 only when the request's If-None-Match holds the page's ETag. Before, a request without
  If-None-Match after one that sent the ETag got a bodiless 304 too (the core keeps a cleared header's old bytes):
  a blank page on a first visit.
- `update_last` of a successful update carries the update boot's heap: `"result=ok from=1.5.3 kb=… heap0=… block0=…
  heap_min=… block_min=…"` (also on `same`). An update run by a v1.5.2 update boot still ends at `kb=`.

## The site's API (BallClock v1.6): the contract with the firmware task

v1.5's stays as above. Added:
- `/kaia/anim` takes `look=0–N` for every name but off: that event's animation for this call, a try-out, nothing
  saved. N = 14 for the wake (`WAKE_COUNT` − 1), 8 for the others (`LOOK_COUNT` − 1). Absent = the saved key of that
  event (`kaia_wake`, `kaia_listen`, `kaia_think`, `kaia_speak`, `kaia_done`, `kaia_error`, `kaia_notify`).
  `wake=` stays as the old name of look for name=wake. A bad look (not a number, or past N) → 400 `{error}`.
  An explicit style still plays when the saved one is «Выкл»; look 0 follows that style.
- `/kaia/state` `play` adds `look`: the animation playing within its event. A wake that turned into listening shows
  as listening with the listening's look (`kaia_listen`).
- `/kaia/state` `settings` gain `kaia_listen`, `kaia_think`, `kaia_speak`, `kaia_done`, `kaia_error`, `kaia_notify`
  (0–8, 0 by default); `kaia_wake` runs 0–14.
- `back_pal` runs 0–60: the new palettes from 31.
- Nothing else changes.

New in v1.6.1 (diagnostics, the page does not read them):
- `/kaia/state` adds `stack`: the lowest free cont stack since boot, in bytes of 4096 (`ESP.getFreeContStack()`).
- `crash` adds `reason`: `exception`, `hw_wdt`, `soft_wdt`, `stack` (the cont stack overflowed) or `panic` (panic,
  abort, a failed assert or new). A `stack` or `panic` crash used to leave `crash` null: it boots as
  `reset` "Software/System restart", like a plain restart.

## The site's API (BallClock v1.7)

v1.6's stays. `/kaia/state` `settings` gain `kaia_hide`, `kaia_hide_out`, `kaia_hide_in`, `kaia_hide_hold` and
`kaia_hide_keep` (ranges and defaults above). Nothing else changes. They are written through the Settings API like every
other key (`set` by the key's hash).

## The site's API (BallClock v1.8)

v1.7's stays. Only the ranges grow (the ids are appended, the old ones mean what they meant):
- `/kaia/anim` `style=1–9` (`STYLE_COUNT`); `look=0–14` for listening … notify (`LOOK_COUNT` − 1) and `look=` /
  `wake=` `0–20` for the wake (`WAKE_COUNT` − 1). A value out of range (or not a number) → 400 `{error}` as today
  (`style: 1-9`, `wake: 0-20`, …). An explicit style still plays when the saved one is «Выкл»; look 0 follows that
  style, with 4–9 its version.
- `/kaia/state` `play.style` 1–9; `play.look` up to 14 (20 for a wake).
- `/kaia/state` `settings`: `kaia_anim` 0–9, `kaia_listen` … `kaia_notify` 0–14, `kaia_wake` 0–20.
- `GET /kaia/test` (the firmware task's self-test) is not called by the page.

## The site's API (v1.9)

v1.8's stays. Only the ranges grow, each part to what it adds (see «The ids of v1.9»); out of range or not a number is
400 `{error}` as before:

| | part 1 | part 2 (this) | part 3 = v1.9.0 |
|---|---|---|---|
| `/kaia/anim` `style=` | 1–12 | 1–18 | 1–18 |
| `look=` (listening … notify) | 0–17 | 0–23 | 0–27 |
| `look=` / `wake=` (the wake) | 0–23 | 0–29 | 0–33 |

`/kaia/state` `play.style`, `play.look` and `settings` (`kaia_anim`, `kaia_listen` … `kaia_notify`, `kaia_wake`) take the
same ranges. Nothing else changes; `GET /kaia/test` draws the new animations too.

## How the page uses it

The state every 5 s while the tab is visible; «Сейчас» runs the renderer on the saved settings with the clock's
millis, night, brightness and play (its `look`; v1.5's `wake` for a wake), and the dots in step with NTP: each state
rules out the phases of NTP's second that would have put its time in another second (`clock.js`), so after a few
answers the dots blink with the clock's. «Зеркало» shows `/kaia/frame`; during a running text «Сейчас» always uses it.
Save writes the changed keys one at a time (page_pass last, then the page uses the new password), then reads the
state again.

«Показать на часах» (in the preview panel and under the event's gallery) plays the event in view with the draft's
choice and saves nothing: `kaia/anim?name=<event>&style=<kaia_anim>&look=<the event's key>`, plus
`&speed=<kaia_wake_speed>` for the wake and `&ms=6000` for a state (`tryOut` in `api.js`). While it plays the page says
«Идёт на часах: … · ещё 1,1 с», then «Сыграно на часах: … Ничего не сохранено.» With a new style in the draft it sends
`style=4–9`.

«Стиль» (v1.8, KAIA-195): ten tiles, 0 Выкл and 1–9, each with a live thumbnail of the style's listening, or with
«Миниатюры: Все 7 событий» its seven events in a row as «Как у стиля» plays them (the wake with 1.6 s of listening,
thinking, speaking, done, error, notify). The tile of the draft's style is selected, the saved one says «на часах»,
4–9 say «новый»; under them the selected style's version of each event with its length. A tap is a draft like any
setting (the save bar). Every event's gallery ends with «Версии новых стилей» (9–14, the wake 15–20).

v1.9 (KAIA-201's design): the tiles sit in groups, each with its heading: Классика (Выкл, Рябь, Орбита, Искры, Сканер,
Мордашка), Природа (Лава-лампа, Снежинка, Светлячки, Пламя), Космос (Галактика), Игры (Пинг-понг, and from part 2
Аркада, Тетрис, Механизм, Маятник), Узоры и свет (Калейдоскоп, and from part 2 Неон, Гирлянда) (`STY_GROUPS` in
`app.js`: every style in exactly one group). Chips above them, «Все» and one per group with its count, show all groups or one; until a chip is pressed a
wide screen shows all and the phone (≤ 520 px) the chosen style's group. «Сейчас выбран: 12 · Пламя · группа «Природа»»
under the chips always names the draft's style, also while another group is shown. «новый» marks 10–18 now. The
galleries' «Версии новых стилей» run 9–23 (the wake 15–29), from the id tables.

The unlit balls (⚙ on the preview): a colour and a transparency 0–100 % for the balls without light, on the big
preview, the mini bar and the tiles. Only this page's look: kept in this browser's `localStorage` under
`ballclock.unlit` (`{"c":"#rrggbb","tr":0–100}`), never sent to the clock; «Как в v1.5.2» puts back the ivory, opaque
(and stores nothing). `paint.js` redraws its cached unlit layer when the setting changes.
