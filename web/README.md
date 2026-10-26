# BallClock web: the clock's site (firmware v1.5)

The site the clock serves from its flash at `/`: a big live preview of the 128 balls, Kaya's states and wakes,
every setting of the classic page, and saving. It is the KAIA-161 variant B «Сцена» (big preview, tabs under it,
a bottom tab bar on the phone). The classic Settings page stays at `/old`.

One self-contained page: inline CSS and JS, no external requests, only relative URLs (it runs from the clock's
own access point and behind the Kernel's gateway alike), Russian UI. No npm dependencies: Node built-ins only.

## Run, build, test

| | |
|---|---|
| `dist/site.html?mock` | open from disk in a browser: a mock clock inside the page answers the whole API from sample data with a running clock. The dashed «Макет» bar switches what it does: password (401, the mock's password is `kaia`), no answer, access point, update available, running text. |
| `npm run build` | `src/` → `dist/site.html` (committed) → `../firmware/src/site_page.h` (`site_page_gz[] PROGMEM`, `site_page_gz_len`, `SITE_PAGE_ETAG`); prints the raw and gzip sizes and fails over 48 KB gzipped. The gzip is deterministic: the same input gives the same bytes. |
| `npm test` | `node --test`: the renderer against hand-computed values and the firmware's own tables, the wakes, the API client and the mock. |
| `npm run test:render` | headless Edge over CDP: `dist/site.html?mock` at 390×844 and 1280×800 in 19 states; shots in `shots/` (git-ignored). In-page check: nothing wider than the viewport, no overlapping controls, no cut text, touch targets ≥ 44 px on the phone, no request off the page; the save, login and try-out flows; ≥ 18 frames a second with the CPU 4× slower. `node test/render.mjs <state>…` runs some states only. Run `npm run build` first. |

The build joins the ES modules of `src/` in import order into one strict scope: top-level names must be unique
across modules (the build checks), and strings never span lines (it drops whole-line comments and indentation).

## Files

| file | what |
|---|---|
| `src/lib8.js` | FastLED 3.7.7 lib8tion as the ESP8266 compiles it (the C versions, SCALE8_FIXED and BLEND_FIXED): sin8, scale8, qadd8, nscale8_video, blend8 / nblend, scale16, ease16InOutQuad, lerp15by16, avg15 |
| `src/noise.js` | `inoise16(x, y, z)` (noise.cpp) |
| `src/palettes.js` | the 31 palettes as CRGBPalette16 and `getPaletteColor` |
| `src/matrix.js` | `BallMatrix`: the layout, the strip, the marks, GyverGFX colour and `print` |
| `src/redraw.js` | the clock under the overlay: background, digits, dots, night, brightness |
| `src/kaia.js` | Kaya: the ball tables, the helpers, the 3 styles |
| `src/wakes.js` | the wakes of v1.5 (ids, names, base lengths, the new ones, the speed) |
| `src/frame.js` | one 50 ms frame: `renderFrame(matrix, settings, clock)`; what plays at t (`resolvePlay`); the duck |
| `src/paint.js` | the canvas layer (the only DOM part of the drawing) |
| `src/api.js` | the API client: one request at a time, 5 s, auth; `hash32`, `keyId` |
| `src/clock.js` | the clock's time between two states (the NTP second's phase) |
| `src/mock.js` | the mock clock of `?mock` |
| `src/settings.js` | the keys, their defaults (db.init) and raw values |
| `src/app.js`, `page.html`, `style.css` | the page |

## The renderer: the firmware's drawing in JS

Pure (no DOM), so the tests import it: the same settings and time give the same 128 colours. Integer maths keep
C++ semantics: every division is `a / b | 0` (truncates toward zero), `(uint8_t)` is `& 255`, uint16 / int16 wrap
where the C++ types do, and the float steps of the boot tables and the old wakes are `Math.fround` per operation.

| JS | C++ | notes |
|---|---|---|
| `matrix.js` `xyToLed`, `diagToLed`, `ledXY`, `ledDiag` | `src/matrix.cpp` | the tests compare them with the C source |
| `BallMatrix.setXY` / `getXY`, `beginMarks`, `marked` | `src/matrix.h` | the digit balls are marked while the clock draws |
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
| `wakes.js` | `src/kaia.cpp` (v1.5) `wakeDraw`, `wakeLength`, `dawnShot` … `rainShot` | see below; the C++ keeps `b_col`, `b_row`, `b_x` in one byte a ball (`b_cr`, column and row) and computes `h1`–`h3` inline: the same values, 640 B less RAM |

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

## The wakes (kaia_wake)

| id | name | base length (100 %) | what |
|---|---|---|---|
| 0 | Как у стиля | the style's: 1900 / 2000 / 2000 | the style's own wake (the default) |
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

`kaia_wake_speed` 50–200 %: the wake runs on u = t·speed/100 and lasts base·100/speed (e.g. Глаз at 150 %:
1466 ms); the listening under it and after it keeps real time. The new wakes fade out over their last 400 ms of u
and the style's listening fades in over the last 800.

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

How the page uses it: the state every 5 s while the tab is visible; «Сейчас» runs the renderer on the saved settings
with the clock's millis, night, brightness and play, and the dots in step with NTP: each state rules out the
phases of NTP's second that would have put its time in another second (`clock.js`), so after a few answers the
dots blink with the clock's. «Зеркало» shows `/kaia/frame`; during a running text «Сейчас» always uses it.
Save writes the changed keys one at a time (page_pass last, then the page uses the new password), then reads the
state again. «Показать на часах» sends `kaia/anim?name=wake&style=…&wake=…&speed=…` from the draft.
