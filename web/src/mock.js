// ?mock: a clock inside the page. It answers the whole v1.8 API (v1.6, the Digit fade keys, styles 1–9) from sample data (never the owner's) with a
// running clock, and draws /kaia/frame with the same renderer, so the page works from disk and in the shots.
import { hash32, keyId, ID_CHECK_UPDATES, ID_OTA_UPDATE, ID_WIFI_SAVE, ledsHex } from "./api.js";
import { A_WAKE, ANIM_NAMES, dimAll, useMatrix } from "./kaia.js";
import { BallMatrix, gfx_font_3x5 } from "./matrix.js";
import { duckAfter, hideTrack, isPlaying, playColor, renderFrame, resolvePlay } from "./frame.js";
import { brightNow, isNight } from "./redraw.js";
import { LOOK_COUNT } from "./looks.js";
import { DEFAULTS, LOOK_KEYS, TEXT_KEYS } from "./settings.js";
import { STYLE_COUNT } from "./styles.js";
import { WAKE_COUNT } from "./wakes.js";

export const MOCK_PASS = "kaia";

export function createMock() {
    const t0 = performance.now(), boot = 4123456;
    const S = Object.assign({}, DEFAULTS, {
        clock_style: 1, clock_color: 0xffffff, back_mode: 2, back_pal: 13, back_bright: 200, back_speed: 50, back_scale: 50,
        auto_bright: 1, bright_min: 10, bright_max: 255, adc_min: 40, adc_max: 880,
        night_mode: 1, night_mode_auto: 1, night_mode_auto_since: 82800, night_mode_auto_to: 25200,
        kaia_anim: 1, kaia_wake: 0, kaia_wake_speed: 100, log_host: "192.168.1.20:9000", wifi_ssid: "HomeNet-2G",
    });
    const M = {
        mode: "ok", update: false, text: false, version: "1.6.0", wifi: { ssid: "HomeNet-2G", ip: "192.168.1.47", rssi: -58 },
        pass: "", play: null, down: 0, old: false, settings: S,
    };
    const hide = { h: 0, t: boot, end: 0, on: 0 };  // the Digit fade's level, stepped by each frame asked for
    const millis = () => boot + Math.floor(performance.now() - t0);
    // 14:32:05.370 at the mock's boot
    const secAt = (ms) => (Math.floor((ms - boot + 52325370) / 1000) % 86400);
    const msIn = (ms) => (ms - boot + 52325370) % 1000;
    const light = (ms) => 412 + Math.round(9 * Math.sin(ms / 1700));
    const synced = () => M.mode !== "ap";
    const two = (n) => String(n).padStart(2, "0");
    const timeText = (ms) => {
        const s = secAt(ms);
        return two((s / 3600) | 0) + ":" + two(((s % 3600) / 60) | 0) + ":" + two(s % 60);
    };
    const night = (ms) => {
        const s = secAt(ms);
        return isNight(S, light(ms), (s / 3600) | 0, ((s % 3600) / 60) | 0);
    };
    const keyOf = (id) => Object.keys(DEFAULTS).find((k) => keyId(k) === id);

    // what plays now, as the firmware reports it
    function playing(ms) {
        if (!M.play) return null;
        const p = resolvePlay({ ...M.play, t: ms - M.play.start });
        if (!p) {
            M.play = null;
            return null;
        }
        return p;
    }

    function frameLeds(ms) {
        const m = new BallMatrix(), s = secAt(ms), p = playing(ms), nt = night(ms);
        const on = !!(p && !(nt && S.kaia_night === 2));
        hideTrack(hide, S, isPlaying(S, nt, p), ms);
        const c = { millis: ms, synced: synced(), hour: (s / 3600) | 0, minute: ((s % 3600) / 60) | 0, ms: msIn(ms), night: nt, play: p, duck: on ? duckAfter(0, true, (p.t / 50) | 0) : 0, hide: hide.h };
        renderFrame(m, S, c);
        if (M.text) {  // a running text: the clock dims and the digits run by
            useMatrix(m);
            dimAll(46);
            m.setModeDiag();
            m.setFont(gfx_font_3x5);
            m.setColor24(0x00ff00);
            m.setCursor(20 - (((ms / 100) | 0) % 44), 1);
            m.print("192.168.1.47".replace(/\./g, " "));
        }
        return m.leds;
    }

    function state(ms) {
        const p = playing(ms);
        return {
            name: "BallClock", version: M.version, time: synced() ? timeText(ms) : "00:00:00", synced: synced(), rssi: M.wifi.rssi,
            light: light(ms), bright: brightNow(S, light(ms)), night: night(ms), overlay: M.text ? "text" : p ? "anim" : "none",
            anim: p ? ANIM_NAMES[p.anim] : null, uptime: (ms / 1000) | 0, reset: "Power On", heap: 23816, block: 17432, crash: null,
            ms, update: M.update,
            play: p && !M.text ? {
                name: ANIM_NAMES[p.anim], style: p.style, look: p.look, wake: M.play.anim === A_WAKE ? M.play.look : S.kaia_wake, speed: p.speed, t: p.t,
                color: playColor(S, p).toString(16).padStart(6, "0"),
            } : null,
            // M.old: a clock before v1.7 carries no Digit fade keys
            settings: Object.fromEntries(Object.keys(DEFAULTS).filter((k) => !["wifi_ssid", "wifi_pass", "page_pass"].includes(k) && !(M.old && k.startsWith("kaia_hide"))).map((k) => [k, S[k]])),
        };
    }

    function answer(path, q, ms) {
        const pass = M.mode === "auth" ? MOCK_PASS : M.pass;
        if (pass && q.get("auth") !== hash32(pass).toString(16)) return { status: 401, json: { error: "unauthorized" } };
        switch (path) {
            case "kaia/state":
                return { status: 200, json: state(ms) };
            case "kaia/frame":
                return { status: 200, json: { ms, bright: brightNow(S, light(ms)), night: night(ms), leds: ledsHex(frameLeds(ms)) } };
            case "kaia/wifi":
                return { status: 200, json: M.mode === "ap" ? { ssid: S.wifi_ssid, ip: "192.168.4.1", rssi: 0, ap: true } : { ...M.wifi, ap: false } };
            case "kaia/anim": {
                const n = ANIM_NAMES.indexOf(q.get("name"));
                if (n < 0) return { status: 400, json: { error: "name" } };
                if (n === 7) {
                    M.play = null;
                    return { status: 200, json: { ok: true } };
                }
                // look= (wake= is its old name for the wake): this call's look, a try-out; absent = the saved one
                const lq = q.has("look") ? q.get("look") : n === A_WAKE && q.has("wake") ? q.get("wake") : null;
                if (lq != null && !(/^\d+$/.test(lq) && +lq < (n === A_WAKE ? WAKE_COUNT : LOOK_COUNT))) return { status: 400, json: { error: "look" } };
                // style= 1–9 (v1.8), as the clock: another value is 400; without it the saved style, and «Выкл» plays nothing
                if (q.has("style") && !(/^\d+$/.test(q.get("style")) && +q.get("style") >= 1 && +q.get("style") <= STYLE_COUNT)) return { status: 400, json: { error: "style" } };
                const style = q.has("style") ? +q.get("style") : S.kaia_anim;
                if (!(style >= 1 && style <= STYLE_COUNT)) return { status: 200, json: { ok: true } };
                M.text = false;
                M.play = {
                    anim: n, style, start: ms, ms: q.has("ms") ? +q.get("ms") : 30000,
                    look: lq != null ? +lq : S[LOOK_KEYS[n]], lk: S.kaia_listen,
                    speed: n === A_WAKE && q.has("speed") ? +q.get("speed") : S.kaia_wake_speed,
                    color: q.has("color") ? parseInt(q.get("color"), 16) : null,
                };
                return { status: 200, json: { ok: true } };
            }
            case "settings": {
                const id = parseInt(q.get("id") || "", 16) >>> 0;
                if (q.get("action") === "set") {
                    if (id === ID_OTA_UPDATE) {
                        M.down = ms + 4000;
                        M.update = false;
                        M.version = "1.6.1";
                        return { status: 200, json: null };
                    }
                    const k = keyOf(id);
                    if (k) {
                        const v = q.get("value") || "";
                        S[k] = TEXT_KEYS.includes(k) ? v : Math.trunc(+v) || 0;
                        if (k === "page_pass") M.pass = v;
                    }
                } else if (q.get("action") === "click") {
                    if (id === keyId("adc_min")) S.adc_min = light(ms);
                    else if (id === keyId("adc_max")) S.adc_max = light(ms);
                    else if (id === ID_WIFI_SAVE) {
                        M.wifi.ssid = S.wifi_ssid;
                        if (M.mode === "ap") M.mode = "ok";
                    } else if (id === ID_CHECK_UPDATES) M.update = M.update || M.version === "1.6.0";
                }
                return { status: 200, json: null };
            }
        }
        return { status: 404, json: null };
    }

    // the transport the ClockApi calls instead of fetch
    function send(url) {
        const ms = millis(), [path, qs] = url.split("?");
        const offline = M.mode === "offline" || ms < M.down;
        return new Promise((ok, no) => setTimeout(() => (offline ? no(new Error("offline")) : ok(answer(path, new URLSearchParams(qs || ""), millis()))), offline ? 400 : 30 + Math.random() * 60));
    }

    return { M, send };
}
