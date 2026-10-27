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
`build()` calls one function per group, so only one group's frame is live at a time. Measure a build's frames
from the elf (call0 prologues: `addi a1, a1, -N`, or `movi aN, N` + `sub a1, a1, aN`):

```
xtensa-lx106-elf-objdump -d -C bin/d1_mini/firmware.elf
```

On the clock, `/kaia/state` `stack` is the lowest free cont stack since boot. A stack overflow or a panic restarts
through `system_restart`, so the next boot reads "Software/System restart" as for `ESP.restart()`; the crash record
keeps the core's reason (253 stack, 254 panic) and is reported as `crash.reason` `stack` / `panic` and `crash=` in
the boot line. The Kernel counts only Exception and the watchdogs as unexpected restarts, not these.
