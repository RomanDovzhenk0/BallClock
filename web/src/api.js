// The clock's API (BallClock v1.5), as the page calls it: same origin, relative URLs, GET, one request at a
// time (the ESP8266 answers one at a time), 5 s each. With a page password every call carries
// auth = hash32(password) in lowercase hex, as Home does (Home/src/gyver/driver.ts). 401 = ask for the password.

import { ANIM_NAMES } from "./kaia.js";
import { LOOK_KEYS } from "./settings.js";

// h = h·33 + c over the string's bytes (UTF-8), uint32 from 0: StringUtils su::hash
export function hash32(s) {
    let h = 0;
    for (const c of new TextEncoder().encode(s)) h = (h + (h << 5) + c) >>> 0;
    return h;
}

// a GyverDB key's id: hash32 & DB_HASH_MASK (29 bits)
export const keyId = (key) => hash32(key) & 0x1fffffff;

// the ids made with "name"_h are the full hash
export const ID_WIFI_SAVE = hash32("wifi_save"), ID_CHECK_UPDATES = hash32("check_updates"), ID_OTA_UPDATE = hash32("ota_update");

export class AuthError extends Error {}
export class OfflineError extends Error {}

export class ClockApi {
    // send(url, signal) → Promise<{status, json}>; the page's fetch, or the mock's
    constructor(send, timeoutMs = 5000) {
        this.send = send;
        this.timeoutMs = timeoutMs;
        this.pass = "";
        this.tail = Promise.resolve();
        this.busy = 0;
    }

    // one call after the ones before it
    call(path, params = {}) {
        const run = () => this.once(path, params);
        const p = this.tail.then(run, run);
        this.tail = p.catch(() => {});
        return p;
    }

    async once(path, params) {
        const qs = new URLSearchParams(params);
        if (this.pass) qs.set("auth", hash32(this.pass).toString(16));
        const q = qs.toString(), url = path + (q ? "?" + q : "");
        const ac = typeof AbortController === "function" ? new AbortController() : null;
        let timer = 0;
        this.busy++;
        try {
            const res = await Promise.race([
                this.send(url, ac && ac.signal),
                new Promise((_, no) => {
                    timer = setTimeout(() => {
                        if (ac) ac.abort();
                        no(new OfflineError("timeout"));
                    }, this.timeoutMs);
                }),
            ]);
            if (res.status === 401) throw new AuthError("401");
            if (res.status < 200 || res.status > 299) throw new Error(path + ": HTTP " + res.status);
            return res.json;
        } catch (e) {
            if (e instanceof AuthError || e instanceof OfflineError || /HTTP/.test(e.message)) throw e;
            throw new OfflineError(e.message || "offline");
        } finally {
            clearTimeout(timer);
            this.busy--;
        }
    }

    state() {
        return this.call("kaia/state");
    }

    frame() {
        return this.call("kaia/frame");
    }

    wifi() {
        return this.call("kaia/wifi");
    }

    // name: wake | listening | …; extra: {style, look, speed, color, ms}
    anim(name, extra = {}) {
        return this.call("kaia/anim", { name, ...extra });
    }

    // a raw value: numbers in decimal, a switch 0/1, a colour as its 24-bit number, a time in seconds, text as it is
    set(id, raw) {
        return this.call("settings", { action: "set", id: (id >>> 0).toString(16), value: String(raw) });
    }

    click(id) {
        return this.call("settings", { action: "click", id: (id >>> 0).toString(16) });
    }
}

// how long a state plays as a try-out, ms
export const TRY_STATE_MS = 6000;

// «Показать на часах»: the event with the draft's choice (s), nothing saved:
// kaia/anim?name=<event>&style=…&look=…, plus &speed=… for the wake and &ms=6000 for a state
export function tryOut(name, s) {
    const n = ANIM_NAMES.indexOf(name);
    const q = { style: s.kaia_anim, look: s[LOOK_KEYS[n]] };
    if (n === 0) q.speed = s.kaia_wake_speed;
    if (n >= 1 && n <= 3) q.ms = TRY_STATE_MS;
    return q;
}

// the browser's transport: the answer may be the classic page as BSON (set, click): it is not read
export async function fetchSend(url, signal) {
    const res = await fetch(url, { cache: "no-store", signal });
    let json = null;
    if ((res.headers.get("content-type") || "").includes("json")) {
        try {
            json = await res.json();
        } catch {
            json = null;
        }
    }
    return { status: res.status, json };
}

// /kaia/frame leds: 768 hex characters → 128 colours
export function parseLeds(hex) {
    const out = new Uint32Array(128);
    if (typeof hex !== "string") return out;
    for (let i = 0; i < 128; i++) out[i] = parseInt(hex.substr(i * 6, 6), 16) || 0;
    return out;
}

export function ledsHex(leds) {
    let s = "";
    for (let i = 0; i < 128; i++) s += (leds[i] >>> 0).toString(16).padStart(6, "0");
    return s;
}
