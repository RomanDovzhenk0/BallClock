# BallClock firmware

`pio run -e d1_mini` in this folder builds it against the library copies in `../libraries` (only d1_mini
compiles: `LED_PIN D5` is an ESP8266 pin name). `move_binary.py` copies `firmware.bin` and `firmware.elf` to
`bin/d1_mini/`; the elf decodes the crash addresses of the log with `xtensa-lx106-elf-addr2line -f -C -e`.

The site and its API are described in `../web/README.md`.

## The update over the air (v1.5.1)

A TLS download from GitHub takes about 33 KB of heap (ESP8266 core 3.1.2): BearSSL's own stack 6200, the client
context 3408, the receive buffer 16709 (GitHub sends the bin in 16 KB records, so it cannot be smaller), the send
buffer 597, the Updater's flash sector 4096, plus lwIP's receive window. A running clock has 28-32 KB free, so the
update runs in a boot of its own (`src/otaboot.cpp`):

1. The «Обновить» confirm (the classic page, or `settings?action=set&id=b7d52286&value=1` from the site) keeps a
   request with the network in RTC user memory, logs `ota update result=restart` and restarts 0.5 s later.
2. The next boot finds the request in `setup()`, right after the crash record is read and before the LEDs, the
   DB, the web server, NTP, the animations and the log target start. It connects Wi-Fi as a station only (20 s)
   and runs `ota.updateNow()` up to 3 times, 2 s apart. Before each try it checks the heap: below 33058 free or a
   largest block below 20117 it gives up with `result=lowmem`.
3. `updateNow()` (`../libraries/AutoOTA/AutoOTA.h`, changes marked `BallClock`) reads `project.json` with 1 KB TLS
   buffers, then the bin with the full ones. It flashes exactly the response's Content-Length: `Update.begin(length)`,
   the bytes written counted, `Update.end()` without evenIfRemaining. A bin without a length, a stalled or a short
   download is not flashed (`result=size`) and the old firmware stays. On success it restarts into the new firmware.
4. A failure ends the update boot and the clock boots on as usual; the result goes into the DB key `ota_last`,
   `/kaia/state` `update_last` and a log line after the boot line. A crash in the update boot leaves the record
   behind: the next boot reports `result=crash` with the stage it had reached (the boot line has the crash itself).

No server listens during the download: pollers get a refused connection instead of piling up on the clock.

Log lines of an update (the ring keeps them; the log target gets them once the normal boot sets it):

```
ota update result=restart                                              the confirm
ota update boot from=1.5.1 heap=… block=…                              the update boot starts
ota update stage=wifi|json|connect|headers|begin|write|end|restart try=N kb=done/total heap=… block=…
ota update try=N ssl=<BearSSL error> what="<text>"                     a failed TLS connect
ota update result=connect try=1 stage=connect kb=0/0 heap=… block=… ssl=…   a try that will be retried
ota update result=<word> …                                             the last result, after the boot line
```

Results: `ok from=<old version> kb=<size> heap0=… block0=… heap_min=… block_min=…` (written by the new firmware),
`same kb=<size> heap0=…` (the same version came back), `lowmem`, `wifi`, `connect`, `timeout`, `http`, `nofile`,
`noversion`, `noplatform`, `nopath`, `size`, `otastart`, `otaend` (the flash refused the image: not retried), `crash`.

A successful update boot restarts inside `updateNow()`, before the log target is set, so its `boot` and `stage`
lines are lost with the RAM ring. From v1.5.3 on the update record keeps its heap instead and the new firmware
reports it with `ok` / `same`: `heap0`/`block0` free heap and largest block at the update boot's start (the `boot`
line), `heap_min`/`block_min` the lowest over its `stage` lines (the two minima can come from different stages).
An update run by a v1.5.2 (or older) update boot has no such numbers: its `ok` ends at `kb=`.

RTC user memory (512 bytes, 4-byte words): 0-31 eboot (the OTA bootloader's command), 32-59 the crash record
(`src/crash.cpp`), 64-105 the update record (`src/otaboot.cpp`; the network is wiped as soon as the update boot
has read it). Words 64-101 keep the layout of v1.5.1-1.5.2 with their checksum, so a record written by an older
update boot still reads; 102-105 (the heap, from v1.5.3 on) have a checksum of their own. It survives a restart and
a crash, not a power cut.

The access point: the clock opens it while it connects and when it cannot connect. Once the station is up,
`WiFiConnector` switches it off for real (`softAPdisconnect(true)`, mode WIFI_STA); before v1.5.1 only its SSID was
emptied and the SDK kept the AP's heap and answered probe requests with it. `WiFi.persistent(false)`: the mode
changes do not write the SDK's config to flash (the network lives in the DB).

### The first update to v1.5.1

The firmware that runs the update is the old one: from v1.4.1 or v1.5.0 the update to v1.5.1 still goes through
the old code, in the running clock, with ~29 KB of heap. Each try either works or crashes / times out and restarts
the old firmware, so trying again costs nothing. If it keeps failing, flash v1.5.1 once over USB; from then on the
updates run in the update boot.

## The cont stack (v1.6.1)

`setup()`, `loop()` and every web handler run on the core's cont stack: 4096 bytes, no more. d1_mini builds with
`build_type = debug` (-Og), which keeps every temporary of a function in its own frame slot, so a function with many
widgets or `db.init` calls gets a frame of 1-1.5 KB. v1.6.0 overflowed it: `/settings?action=load` (and every
switch with `b.reload()`, such as the night mode) builds the whole classic page inside the request, and that chain
took about 4176 bytes (the settings ticker 1296, `build()` 1584, the web server and the Settings library about
900, BSON and realloc about 200). The overflow overwrote the stack's guard, `cont_check` at the end of `loop()`
called `__stack_chk_fail`, and the clock restarted before the DB was written.

v1.6.1 keeps the big frames off that path: the ticker's setup block is a function of its own (`settingsBegin`), and
`build()` calls one function per group, so only one group's frame is live at a time: the same path takes about
2144 bytes (the ticker 32, `build()` 240, the deepest group, K.A.I.A., 928 with its widgets), and the palette list
goes to its Select as a flash Text instead of a 650-byte String. Measure a build's frames
from the elf (call0 prologues: `addi a1, a1, -N`, or `movi aN, N` + `sub a1, a1, aN`):

```
xtensa-lx106-elf-objdump -d -C bin/d1_mini/firmware.elf
```

On the clock, `/kaia/state` `stack` is the lowest free cont stack since boot. A stack overflow or a panic restarts
through `system_restart`, so the next boot reads "Software/System restart" as for `ESP.restart()`; the crash record
keeps the core's reason (253 stack, 254 panic) and is reported as `crash.reason` `stack` / `panic` and `crash=` in
the boot line. The Kernel counts only Exception and the watchdogs as unexpected restarts, not these.

## The Digit fade (v1.7)

While Kaya's animation plays the time (the digits and the dots) fades out, and after it fades back in. It is a line by
line copy of the site's renderer (`../web/src/frame.js` `hideStep` / `hideTrack` / `digitHide`, `matrix.js` `alpha`,
`kaia.js` `put`); `../web/README.md` «Changes the firmware task copies into the firmware (v1.7)» is the spec.

| key | range | default | classic page (group K.A.I.A., after the looks) |
|---|---|---|---|
| `kaia_hide` | 0 / 1 | 1 | switch «Прятать цифры» |
| `kaia_hide_out` | 100–3000 ms | 600 | slider «Исчезают за», мс |
| `kaia_hide_in` | 100–5000 ms | 1200 | slider «Появляются за», мс |
| `kaia_hide_hold` | 0–5000 ms | 1000 | slider «Пауза перед появлением», мс |
| `kaia_hide_keep` | 0–100 % | 0 | slider «Остаётся от цифр», % |

A value out of range reads as its default (`savedHide`, as `savedLook` does), and `/kaia/state` `settings` shows the
five keys read that way. The classic page builds them in `buildKaiaHide()`, a `noinline` group function of its own with
`F()` labels and units; none of them reloads the page.

- **The level** `ov.hide` (16 bits, 0 = shown, 65535 = gone) steps in `kaiaDraw()` once a frame, right after the mode
  updates and before its early returns, by the real ms since the last frame (`ov.hideT`, capped at 60 s): up by
  65535 per `kaia_hide_out` ms while an animation is drawn (`ov.mode` is a one-shot or a state, `kaia_anim` is not
  «Выкл» and the night rule does not hide it; the running text never counts), down by 65535 per `kaia_hide_in` ms once
  `kaia_hide_hold` ms have passed since the last one ended (`ov.hideEnd`, `ov.hideOn`). A new animation turns it round
  where it stands. `kaia_hide` 0 sets it to 0 at once.
- **The redraw** takes `kaiaDigitScale()` (smoothstep of the level, less by `kaia_hide_keep` %) before the clock:
  `matrix.markAlpha = 255 - hd`, so `setLED(x, y, c)` blends every marked ball (the digits through `fastSet`, the dots)
  from what is under it, the ducked background or black at night, towards the clock colour; back to 255 after
  `endMarks()`. The level used is the one `kaiaDraw()` stepped in the frame before, as the duck is.
- **`put()`** lifts what the digit balls keep of the overlay by `fr.hd` (set by `kaiaDraw()` while a look draws):
  `fr.dg + (255 - fr.dg) * fr.hd / 255`, so at the full level the overlay covers them like any other ball.
- **Off**: with `kaia_hide` 0, or `kaia_hide_keep` 100, the alpha stays 255 and `fr.hd` 0: every frame is v1.6.2's.
- `mix()` moved from `kaia.cpp` to `matrix.cpp` (declared in `matrix.h`): out of line, as the `static` one was, since an
  inline one is copied into every look by -Og (8 KB of flash).
- Deliberate differences from the JS: the settings come from the DB (`hideSet()`, read inside `hideTrack()` so they
  stay out of `kaiaDraw()`'s frame while the looks run) instead of the `S` object; `hideStep` works on `int32_t` /
  `uint32_t` (the same values, the products cannot overflow); "playing" is `ov.mode` after the updates (JS
  `isPlaying` asks `resolvePlay`, which is the same thing for the clock's own play).
- Port check (KAIA-175's method, no host C++ compiler): normalized token streams of `hideStep`, `digitHide` /
  `kaiaDigitScale`, `hideTrack`, `put`, `mix`, the mark alpha (`setXY` / `setLED(x, y, c)`), the frame order
  (`renderFrame` / the redraw timer) and `fr.hd` around the look in `kaiaDraw` match the JS but for the differences
  above, the parentheses of the `(int32_t)` casts and the marks as a bitset (as since v1.4).

Sizes (d1_mini, -Og), v1.6.2 → v1.7.0:

| | v1.6.2 | v1.7.0 |
|---|---|---|
| static RAM (.data + .rodata + .bss) | 40,168 B | 40,188 B (`ov` +12, `matrix` +4, alignment) |
| flash used / bin | 701,217 B / 705,376 B | 704,629 B / 708,784 B (1,349 B of it the v1.7 site page) |
| `/settings` build chain, K.A.I.A. group | ≈ 2,144 B (`buildKaia` 400, `buildKaiaLooks` 192) | ≈ 2,176 B (`buildKaiaHide` 224) of 4096 |
| redraw frames | `kaiaDraw` 112, `put` 32 | `kaiaDraw` 144, `put` 48 (+48 B on the deepest look) |

The timer lambda (96), `drawClock`, `drawTime` and `dots` (112 each) keep their frames; `kaiaDigitScale()` (48, with
`hideSet` 16 and `savedHide` 80 under it) runs before the clock, not under the looks. The new code reads its flash
tables only through `pgm_read_*` (no `l8ui` / `l16ui` on a 0x402… address, KAIA-186).

## Kaya's styles (v1.8)

Six new styles beyond Рябь, Орбита and Искры (KAIA-195's catalog, all six kept), each a whole visual language with
its own version of all 7 events. A line by line copy of `../web/src/styles.js` (and the dispatch in `looks.js`,
`wakes.js`); `../web/README.md` «Changes the firmware task copies into kaia.cpp (v1.8)» is the spec and lists every
animation with its name and length.

The ids are appended, the old ones never move:

| setting | v1.7 | appended in v1.8 |
|---|---|---|
| `kaia_anim` (classic page «Анимации») | 0 Выкл, 1 Рябь, 2 Орбита, 3 Искры | 4 Пинг-понг, 5 Калейдоскоп, 6 Лава-лампа, 7 Мордашка, 8 Галактика, 9 Сканер (`STYLE_COUNT` 9) |
| `kaia_listen` … `kaia_notify` | 0–8 | 9–14: the versions of styles 4–9, look = style + 5 (`LOOK_COUNT` 15) |
| `kaia_wake` | 0–14 | 15–20: the wakes of styles 4–9, wake = style + 11 (`WAKE_COUNT` 21) |

- **Dispatch**: `lookOf(style, look)` (look 0 with style 4–9 is that style's version) at the top of `stateLook`,
  `shotLook` and `shotLength`; 9–14 go to `styleState` / `styleShot` with `look - 5`. `wakeOf(style, wake)` picks the
  wake in `wakeDraw` and in `playLength` (the wake → listening switch); 15–20 go to `styleShot(id - 11, A_WAKE, …)`
  with the listening fading in over the last 800 ms, as under every themed wake. `fr.ls` is 0 after a new style's
  wake, so with `kaia_listen` 0 the style's own listening takes over.
- **Tables** in PROGMEM, read with `pgm_read_*`: `pp_bt`, `pp_bh`, `pp_smash`, `kal_sp`, `lava_from`, `drip_x`,
  `drip_t`, `scan_row`, `fam_ms` (the one-shot lengths), `wake_ms[15..20]`; no per-ball tables (`b_cr`, `b_dist`,
  `b_ang` and the hashes of the boot).
- **Settings**: `savedStyle()` reads `kaia_anim` 0–9 (out of range: the default 1, as `savedLook` does) for the
  frame, `/kaia/anim` and `/kaia/state`; `savedLook` follows the new counts. The classic page's «Анимации» lists the
  ten names of `STYLE_NAMES` (`kaia_style_names`, in flash through `FPSTR`; before, a RAM literal with longer names),
  every event's list and «Пробуждение» append the six names.
- **API**: `/kaia/anim` `style=1–9`, `look=0–14` for listening … notify, `look=` / `wake=` `0–20` for the wake; past
  them 400 (`style: 1-9`, `wake: 0-20`, `look: 0-14`, `look: 0-20 for wake`). `/kaia/state` `play.style` 1–9.
- **Deliberate differences from the JS**: Галактика · Комета passes its tail segment as a stack `int[4]` (its ends run
  past an `int8_t`), so `segDist` has an overload for a segment in RAM next to v1.6's PROGMEM one; declarations of
  mixed types are split (`uint32_t` colours apart), which moves a few of them in the token order. Nothing else.
- **Port check** (KAIA-175's method, no host C++ compiler): normalized token streams of the 56 functions of
  `styles.js` and of `lookOf`, `shotLength`, `stateLook`, `shotLook`, `wakeDraw`, `wakeOf`, `wakeLength`: 48 match
  as they are; the other 15 differ only by the declaration order above, the `tl` array, and grouping parentheses that
  the JS needs for its `| 0` and C++ keeps (the same truncation: `88 * (t * (2800 - t) / 1400) / 1400`). The tables
  and the name lists equal the JS ones.

### GET /kaia/test

A self-test, so a release can check every animation on the real CPU before the owner meets a crash (KAIA-186 was a
boot loop from one bad read). With a page password it takes `auth=` like every `/kaia/*` call. It draws, into the
strip without `show()`:

- each style's own version of every event (styles 1–9, look 0): 9 × 7;
- every look of listening … notify (1–14, with style 1): 14 × 6;
- every wake (1–20, with style 1);

a one-shot (a wake at 100 %) at its start, its middle and 50 ms before its end, a state at 0, 15 s, 29.95 s (the end of
a call's default 30 s), 60 s and 70 min: 639 draws. Each is timed with `micros()`, a `yield()` follows every
animation (the network and the watchdog get their turn), and at the end `redrawFrame()` (the redraw timer's body, now
a function of its own) draws and shows the normal frame. Kaya's own state (`ov`) is not touched; `fr` is set per draw
as `kaiaDraw` sets it. The answer, and one log line `kaia test n=… slowest="…" us=… ms=…`:

```
{"ok":true,"n":639,"slowest":{"name":"<the slowest draw>","us":<its µs>},"ms":<the whole run>}
```

`name` is `style=<1–9> <event> t=<ms>`, `look=<1–14> <event> t=<ms>` or `wake=<1–20> t=<ms>`. The clock draws a frame
every 50 ms, so `slowest.us` well under 50,000 is the check; `ms` is the whole run (the LEDs hold their last frame
meanwhile). The numbers come from the clock: nothing here was run on it.

Sizes (d1_mini, -Og), v1.7.0 → v1.8.0:

| | v1.7.0 | v1.8.0 |
|---|---|---|
| static RAM (.data + .rodata + .bss) | 40,188 B | 40,104 B (−84: the old «Анимации» literal left `.rodata`; no new RAM symbols) |
| flash used / bin | 704,629 B / 708,784 B | 739,325 B / 743,472 B (+25.8 KB the 77 new functions and tables, +8.9 KB the v1.8 site page of KAIA-196) |
| `/settings` build chain | 1,200 B (`build` 240, `buildKaia` 400, `buildKaiaHide` 224) | the same |
| redraw path, deepest | 544 B (the timer 96, `kaiaDraw` 144, `wakeDraw` 48, …) | 608 B (the timer 16, `redrawFrame` 96, `kaiaDraw` 128, `wakeDraw` 64, `styleShot` 16, `faceDone` 80, `face` 96, `put` 48, …) |
| `/kaia/test` under the web server | – | 832 B deepest (`handleTest` 32, `testReply` 208, the log's UDP send); the draws 560 B (`testAnim` 48, `testDraw` 112, then the redraw path's looks); about 300 B of web server and Looper below it |

The new frames: `ppWake` and `ppRally` 112–128, `face` 96, the rest 64–96. Every flash table is read through
`pgm_read_*`: the elf has no `l8ui` / `l16ui` from a 0x402… address in the new code (the loads the disassembly shows
there are literal-pool bytes decoded as code, as in v1.7.0, or the RAM tables). The flash layout is 4m1m, so an update
over the air has 3 MB below the file system for the running image and the new one.

## Kaya's styles of v1.9, part 1 (catalog A)

Three more styles, the owner's picks from KAIA-201's catalog A: 10 Снежинка, 11 Светлячки and 12 Пламя (the cold flame
in Kaya's colour), each a whole visual language with its own version of all 7 events. A line by line copy of
`../web/src/nature.js` and of the id tables in `looks.js` / `wakes.js`; `../web/README.md` «Changes the firmware task
copies (v1.9, part 1)» is the spec, and «The ids of v1.9» fixes the ids of all three parts (styles 13–18, looks 18–27
and wakes 24–33 come with parts 2 and 3).

| setting | v1.8 | appended in v1.9 part 1 |
|---|---|---|
| `kaia_anim` (classic page «Анимации») | 0 Выкл, 1–9 | 10 Снежинка, 11 Светлячки, 12 Пламя (`STYLE_COUNT` 12) |
| `kaia_listen` … `kaia_notify` | 0–14 | 15–17: the versions of styles 10–12 (`LOOK_COUNT` 18) |
| `kaia_wake` | 0–20 | 21–23: the wakes of styles 10–12 (`WAKE_COUNT` 24) |

- **Dispatch through tables** (PROGMEM `uint8_t`, read with `pgm_read_byte`), in place of v1.8's `style + 5` /
  `style + 11`: `look_style[LOOK_COUNT]` and `style_look[STYLE_COUNT + 1]`, `wake_style[WAKE_COUNT]` and
  `style_wake[STYLE_COUNT + 1]`. `lookOf`, `wakeOf`, `shotLength` (`fam_ms[look_style[look] - 4]`), `stateLook`,
  `shotLook` and `wakeDraw` read them, so a later id can go anywhere. `styleState` / `styleShot` gain `case 9`
  (Сканер, was the default), `case 10`, `case 11` and the default Пламя.
- **Lengths**: `fam_ms` gains three rows (10 {1800, 1800, 1600}, 11 {1700, 1500, 1400}, 12 {1800, 2000, 1500}),
  `wake_ms[21..23]` 2000 each; the listening fades in over a wake's last 800 ms, as in v1.8.
- **Tables** in PROGMEM (94 B): `snow_fx`, `snow_dx`, `snow_dq`, `snow_dt`, `ff_bx`, `ff_wx`, `ff_wy`, `ff_in`, `em_x`,
  `fl_bv`, `fl_sv`; no per-ball tables. The arrays of a frame are on the stack, sized as the loop that fills them (at
  most three `int[18]`, Светлячки · Хоровод).
- **Settings and API**: `savedStyle()` reads `kaia_anim` 0–12, `savedLook` 0–17 and the wake 0–23 (out of range: the
  default). The classic page's «Анимации» lists 13 names, each event's Select 18, «Пробуждение» 24 (the names in flash
  through `FPSTR`). `/kaia/anim` `style=1–12`, `look=0–17`, `look=` / `wake=` `0–23` for the wake; past them 400
  (`style: 1-12`, `wake: 0-23`, `look: 0-17`, `look: 0-23 for wake`). `/kaia/state` `play.style` 1–12.
- **`GET /kaia/test`** draws the new ones too, by the same loops: styles 1–12 × 7 events, looks 1–17 × 6, wakes 1–23:
  12 × 27 + 17 × 24 + 23 × 3 = **801 draws** (v1.8: 639). `name` is `style=<1–12> …`, `look=<1–17> …` or
  `wake=<1–23> …`. The times come from the clock: nothing here was run on it.
- **Deliberate differences from the JS**: Снежинка · Блик по кругу fills its `lb` (six 16s) with a loop: an `int[6]`
  initializer that is not all zeros is copied from `.rodata`, and `.rodata` is RAM on the ESP8266 (24 B). Declarations
  of mixed types are split (`uint32_t` colours apart) and the JS `[]` arrays are sized stack arrays. Nothing else.
- **Port check** (KAIA-175's method, no host C++ compiler): normalized token streams of the 32 functions of
  `nature.js` and of `lookOf`, `shotLength`, `stateLook`, `shotLook`, `wakeDraw`, `wakeOf`, `wakeLength`, `styleState`,
  `styleShot`: 22 match as they are; the other 19 differ only by the declarations above (and `shotLength` by a nested
  `pgm_read_*` the normalizer does not unwrap). The tables and the name lists equal the JS ones.

Sizes (d1_mini, -Og), v1.8.0 → v1.9.0 part 1 (frames from the elf's call0 prologues, the calls followed through
`l32r` + `callx0`):

| | v1.8.0 | v1.9.0 (part 1) |
|---|---|---|
| static RAM (.data + .rodata + .bss) | 40,104 B | 40,104 B (no new RAM symbols; the tables and names are in flash) |
| flash used / bin | 739,325 B / 743,472 B | 761,645 B / 765,792 B of 1,044,464 (+16.8 KB the 32 new functions and their tables, +5.5 KB the v1.9 site page of KAIA-204) |
| `/settings` build chain | 1,216 B (`build` 240, `buildKaia` 400, `buildKaiaHide` 224, …) | the same |
| redraw path, deepest | 608 B (the timer 16, `redrawFrame` 96, `kaiaDraw` 128, `wakeDraw` 64, `styleShot` 16, `faceDone` 80, `face` 96, `put` 48, …) | 720 B (… `wakeDraw` 64, `stateLook` 48, `styleState` 16, `flySpeak` 144, `flies` 96, `put` 48, …) |
| `/kaia/test` draws | 528 B (`testAnim` 48, `testDraw` 112, then the redraw path's looks) | 640 B (the same, then `flySpeak` and `flies`) |

The new frames: `flyThink` 272 (three `int[18]`), `flyWake` and `flyError` 224, `flameNotify` 192, the rest 160 or
less. Every flash table is read through `pgm_read_*` (aligned `l32i` + shift): no `l8ui` / `l16ui` / `l16si` in the
new functions loads from a 0x402… address.
