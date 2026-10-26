// The API client: one request at a time, relative URLs, auth = hash32(password) hex, 401 and the timeout;
// the ids; the clock's time between two states; the mock clock.
import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthError, ClockApi, hash32, ID_CHECK_UPDATES, ID_OTA_UPDATE, ID_WIFI_SAVE, keyId, OfflineError, parseLeds, tryOut } from "../src/api.js";
import { ClockSync, parseTime } from "../src/clock.js";
import { DEFAULTS, rawOf } from "../src/settings.js";

// h = h·33 + c, uint32, from 0 — done with BigInt, apart from the code under test
const ref = (s) => [...Buffer.from(s, "utf8")].reduce((h, c) => (h * 33n + BigInt(c)) % 2n ** 32n, 0n);

test("hash32 and keyId as the firmware makes them", () => {
    assert.equal(hash32("ota_update"), 0xb7d52286);
    assert.equal(ID_OTA_UPDATE, 0xb7d52286);
    assert.equal(keyId("kaia_anim"), 0x10ca5f5a);
    assert.equal(BigInt(keyId("kaia_anim")), ref("kaia_anim") & 0x1fffffffn);
    for (const s of ["wifi_save", "check_updates", "kaia_wake", "kaia_wake_speed", "page_pass", "пароль"]) assert.equal(BigInt(hash32(s)), ref(s), s);
    assert.equal(ID_WIFI_SAVE, hash32("wifi_save"));
    assert.equal(ID_CHECK_UPDATES, hash32("check_updates"));
});

test("raw values: decimal numbers, switches 0/1, colours as 24-bit numbers, text as it is", () => {
    assert.equal(rawOf("kaia_color", 0x00d1ff), "53759");
    assert.equal(rawOf("back_angle", -90), "-90");
    assert.equal(rawOf("auto_bright", 1), "1");
    assert.equal(rawOf("night_mode_auto_since", 82800), "82800");
    assert.equal(rawOf("ntp_host", "pool.ntp.org"), "pool.ntp.org");
});

function fakeClock(answer, delay = 20) {
    const log = [];
    let inFlight = 0, most = 0;
    const send = (url) => {
        log.push(url);
        inFlight++;
        most = Math.max(most, inFlight);
        return new Promise((ok) => setTimeout(() => {
            inFlight--;
            ok(answer(url));
        }, delay));
    };
    return { log, send, most: () => most };
}

test("one request at a time, relative URLs, GET query strings", async () => {
    const f = fakeClock(() => ({ status: 200, json: { ok: true } }));
    const api = new ClockApi(f.send);
    await Promise.all([api.state(), api.frame(), api.wifi(), api.anim("wake", { style: 2, wake: 5, speed: 150 }), api.set(keyId("kaia_wake"), 5), api.click(ID_CHECK_UPDATES)]);
    assert.equal(f.most(), 1);
    assert.deepEqual(f.log, [
        "kaia/state", "kaia/frame", "kaia/wifi", "kaia/anim?name=wake&style=2&wake=5&speed=150",
        "settings?action=set&id=" + keyId("kaia_wake").toString(16) + "&value=5", "settings?action=click&id=" + ID_CHECK_UPDATES.toString(16),
    ]);
    for (const u of f.log) assert.ok(!u.startsWith("/") && !/^\w+:/.test(u), "relative: " + u);
});

test("the try-out query for each event: the draft's style and look, the wake's speed, a state's 6 s", async () => {
    const f = fakeClock(() => ({ status: 200, json: { ok: true } }));
    const api = new ClockApi(f.send);
    const s = { ...DEFAULTS, kaia_anim: 2, kaia_wake: 13, kaia_wake_speed: 150, kaia_listen: 4, kaia_think: 0, kaia_speak: 8, kaia_done: 3, kaia_error: 6, kaia_notify: 7 };
    for (const name of ["wake", "listening", "thinking", "speaking", "done", "error", "notify"]) await api.anim(name, tryOut(name, s));
    assert.deepEqual(f.log, [
        "kaia/anim?name=wake&style=2&look=13&speed=150",
        "kaia/anim?name=listening&style=2&look=4&ms=6000",
        "kaia/anim?name=thinking&style=2&look=0&ms=6000",
        "kaia/anim?name=speaking&style=2&look=8&ms=6000",
        "kaia/anim?name=done&style=2&look=3",
        "kaia/anim?name=error&style=2&look=6",
        "kaia/anim?name=notify&style=2&look=7",
    ]);
});

test("a failed request does not stop the queue", async () => {
    let n = 0;
    const api = new ClockApi((url) => (n++ === 0 ? Promise.reject(new Error("net")) : Promise.resolve({ status: 200, json: { url } })));
    await assert.rejects(api.state(), OfflineError);
    assert.deepEqual(await api.wifi(), { url: "kaia/wifi" });
});

test("auth: every call carries hash32(password) in lowercase hex; 401 asks for the password", async () => {
    const pass = "Secret1";
    const f = fakeClock((url) => (new URLSearchParams(url.split("?")[1]).get("auth") === hash32(pass).toString(16) ? { status: 200, json: {} } : { status: 401, json: null }));
    const api = new ClockApi(f.send);
    await assert.rejects(api.state(), AuthError);
    api.pass = pass;
    await api.state();
    await api.set(keyId("bright"), 100);
    const auth = hash32(pass).toString(16);
    assert.match(auth, /^[0-9a-f]+$/);
    assert.ok(f.log.slice(1).every((u) => u.includes("auth=" + auth)));
});

test("a request that does not answer in time is offline", async () => {
    const api = new ClockApi(() => new Promise(() => {}), 50);
    await assert.rejects(api.state(), OfflineError);
});

test("frame leds: 768 hex characters, LED 0 first", () => {
    const leds = parseLeds("ff0000" + "00ff00" + "0".repeat(750) + "0000ff");
    assert.equal(leds[0], 0xff0000);
    assert.equal(leds[1], 0x00ff00);
    assert.equal(leds[127], 0x0000ff);
});

test("the clock's time between states: the NTP second's phase comes into step", () => {
    const phase = 437;  // NTP's second starts at millis ≡ 437
    const sec0 = 14 * 3600 + 32 * 60 + 5, at = (ms) => sec0 + Math.floor((ms - phase) / 1000);
    const text = (s) => [s / 3600 | 0, (s % 3600) / 60 | 0, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
    const sync = new ClockSync();
    let ms = 1000123;
    for (let k = 0; k < 40; k++) {
        sync.add(parseTime(text(at(ms))), ms);
        ms += 5000 + ((k * 137) % 97);  // the polls drift a little
    }
    assert.ok(sync.spread() <= 100, "window " + sync.spread());
    const t = sync.at(ms + 250);
    const want = (ms + 250 - phase) % 1000;
    assert.ok(Math.abs(t.ms - want) <= 60 || Math.abs(t.ms - want) >= 940, t.ms + " vs " + want);
    assert.equal(t.hour, 14);
    assert.equal(parseTime("09:05:07"), 9 * 3600 + 5 * 60 + 7);
});

test("the mock clock answers the whole API", async () => {
    globalThis.performance ??= { now: () => Date.now() };
    const { createMock, MOCK_PASS } = await import("../src/mock.js");
    const mock = createMock();
    const api = new ClockApi(mock.send);
    const st = await api.state();
    for (const k of ["name", "version", "time", "synced", "rssi", "light", "bright", "night", "overlay", "anim", "uptime", "reset", "heap", "block", "crash", "settings", "ms", "play", "update"]) assert.ok(k in st, k);
    assert.ok(!("wifi_pass" in st.settings) && !("page_pass" in st.settings) && !("wifi_ssid" in st.settings));
    assert.ok("kaia_wake" in st.settings && "kaia_wake_speed" in st.settings && "night_trsh" in st.settings && "log_host" in st.settings);
    const fr = await api.frame();
    assert.equal(fr.leds.length, 768);
    const w = await api.wifi();
    assert.deepEqual(Object.keys(w).sort(), ["ap", "ip", "rssi", "ssid"]);
    await api.anim("wake", { style: 3, wake: 9, speed: 200 });
    const p = (await api.state()).play;
    assert.equal(p.name, "wake");
    assert.equal(p.style, 3);
    assert.equal(p.wake, 9);
    assert.equal(p.speed, 200);
    await api.set(keyId("kaia_wake_speed"), 150);
    assert.equal((await api.state()).settings.kaia_wake_speed, 150);
    // v1.6: the looks per event are settings, look= is a try-out of one, a bad look is 400
    for (const k of ["kaia_listen", "kaia_think", "kaia_speak", "kaia_done", "kaia_error", "kaia_notify"]) assert.equal(st.settings[k], 0, k);
    await api.set(keyId("kaia_listen"), 6);
    await api.anim("wake", { style: 1, look: 12, speed: 100 });
    let q = (await api.state()).play;
    assert.equal(q.look, 12);
    assert.equal(q.wake, 12);
    await new Promise((r) => setTimeout(r, 1900));  // the wake (1,8 s) turned into listening: the listening's look
    q = (await api.state()).play;
    assert.equal(q.name, "listening");
    assert.equal(q.look, 6);
    await api.anim("done", { style: 2, look: 5 });
    q = (await api.state()).play;
    assert.deepEqual([q.name, q.style, q.look], ["done", 2, 5]);
    await api.anim("notify", {});
    assert.equal((await api.state()).play.look, 0, "absent = the saved key");
    await assert.rejects(api.anim("done", { look: 9 }), /HTTP 400/);
    await assert.rejects(api.anim("wake", { look: 15 }), /HTTP 400/);
    await assert.rejects(api.anim("error", { look: "x" }), /HTTP 400/);
    await api.anim("wake", { wake: 14 });  // the old name of look for the wake
    assert.equal((await api.state()).play.look, 14);
    assert.equal((await api.state()).settings.kaia_wake, 0, "a try-out saves nothing");
    mock.M.mode = "auth";
    await assert.rejects(api.state(), AuthError);
    api.pass = MOCK_PASS;
    await api.state();
});
