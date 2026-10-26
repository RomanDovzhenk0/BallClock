// The page (KAIA-161 variant B «Сцена»): a big preview with «Сейчас» / «Черновик» / «Сравнить», Kaya's states
// beside it, the settings in tabs under it, the wake gallery and the save bar.
import { AuthError, ClockApi, fetchSend, ID_CHECK_UPDATES, ID_OTA_UPDATE, ID_WIFI_SAVE, keyId, OfflineError, parseLeds } from "./api.js";
import { ClockSync, parseTime } from "./clock.js";
import { animOf, duckStep, isState, kaiaDraw, renderFrame, resolvePlay } from "./frame.js";
import { A_WAKE, ANIM_NAMES, shot_ms, useMatrix } from "./kaia.js";
import { BallMatrix } from "./matrix.js";
import { createMock, MOCK_PASS } from "./mock.js";
import { fitCanvas, paint } from "./paint.js";
import { PAL_NAMES, PALETTES } from "./palettes.js";
import { brightNow, isNight } from "./redraw.js";
import { normalize, rawOf } from "./settings.js";
import { WAKE_COUNT, WAKE_NAMES, wake_ms, wakeLength } from "./wakes.js";

const QS = new URLSearchParams(location.search);
const MOCK = QS.has("mock");
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mock = MOCK ? createMock() : null;
const api = new ClockApi(mock ? mock.send : fetchSend);
const PASS_KEY = "ballclock.pass";

const lsGet = (k) => {
    try {
        return localStorage.getItem(k) || "";
    } catch {
        return "";
    }
};
const lsSet = (k, v) => {
    try {
        if (v) localStorage.setItem(k, v);
        else localStorage.removeItem(k);
    } catch {
        // private mode: the password lives only in this tab
    }
};
api.pass = lsGet(PASS_KEY);

// ================= state =================

let SAVED = normalize(null);
const DRAFT = {};
const W = { ssid: "", pass: "" };  // the Wi-Fi fields: applied with «Подключить», not with Save
let LIVE = null, recvAt = 0, WIFI = null, FRAME = null, everOk = false;
const sync = new ClockSync();
const P = { conn: "wait", src: "draft", live: "calc", forceNight: null, M: null, duck: 0, cmp: 0.5, tab: "kaia", saving: false, upd: "" };

const S = () => Object.assign({}, SAVED, DRAFT);
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtS = (ms) => (ms / 1000).toFixed(1).replace(".", ",") + " с";
const hexs = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0"), unhex = (h) => parseInt(h.slice(1), 16);
const two = (n) => String(n).padStart(2, "0");
const hm = (sec) => two(Math.floor(sec / 3600) % 24) + ":" + two(Math.floor((sec % 3600) / 60));
const unhm = (s) => {
    const a = s.split(":");
    return +a[0] * 3600 + (+a[1] || 0) * 60;
};
const rgb = (c) => ((c >> 16) & 255) + "," + ((c >> 8) & 255) + "," + (c & 255);
const palCss = (p) => "linear-gradient(90deg," + PALETTES[p].map((c) => "rgb(" + rgb(c) + ")").join(",") + ")";
const STYLES = ["Выкл", "Рябь из центра", "Орбита по краю", "Искры в знак"];
const wakeId = (s, w) => (w ? w : s.kaia_anim || 1);

// ================= the settings groups =================

const WDOC = {
    1: ["Как сейчас (rippleShot). Три кольца расходятся от центра, белёсая вспышка в начале; со 1,1 с проявляется слушание стиля.",
        "r_k = (t-220k)*0.544            // k = 0..2, 1/16 четверти шара\nf_k = (832-r_k)/832\na   = max( fl*tent(16d,176), max_k tent(16d-r_k,88)*f_k ) * 242/255\nfl  = 255*(1-t/350); цвет к белому на 70% при fl", "0–1,9 с; слушание с 1,1 с", "b_dist (уже есть)"],
    2: ["Как сейчас (orbitShot). Комета разгоняется по ободу, потом кольца схлопываются, как диафрагма.",
        "h = 6tc + 50.69tc³ (шаров), tail = 6 + 36.4tc, tc = min(t,1100)/1000\nободок: a = 26 + 230*comet(pos,h,n0,tail)/255\nt>1100: кольца r=1..3 вспыхивают в 1100+150r мс: 217*tent(t-…,220)", "0–2,0 с; слушание с 1,5 с", "b_pos, b_ring, ring_len (уже есть)"],
    3: ["Как сейчас (sparksShot). 18 искр летят с обода к центру, знак вспыхивает и оседает.",
        "j = (u/750)^1.6 * len;  хвост 4 шара 255/153/77/31  (u = t-45*((7k)%18))\nt>1500: кольцо 102*tent(16d-r,80), r = (t-1500)*0.64\nmark(g): g = 217*прилетело/18 → вспышка 1550 → «дыхание»", "0–2,0 с; слушание с 1,6 с", "spark[18][12], b_lens (уже есть)"],
    4: ["Заря поднимается от нижнего ряда до верхнего: кромка белее, у середины ярче. Время видно.",
        "F  = smooth(0,1500,u)*140/255            // кромка, 1/16 ряда от низа\ndp = F - 16*(6-row)\ndp<-24: 0;  -24..0: ореол 90*(24+dp)/24\ndp>=0: a = (70 + 185*max(0,96-dp)/96) * (190 + 65*(255-4*|x-19|)/255)/255\nцвет = mix(Кая, белый, 140*max(0,48-dp)/48)\nfo = smooth(du,du-400,u)   // гаснет", "0–1,5 с подъём, до 1,6 держит, до 2,0 гаснет; слушание с 1,2 с", "row, x"],
    5: ["Луч обходит центр один раз по часовой от 12 часов, за ним шлейф; часть шаров «засвечивается» метками. Время видно.",
        "th = u*256/1400                           // угол луча 0..256\ndl = th - ang[i];  dl<0: ничего\nшлейф: ((96-dl)/96)² при dl<96;  голова dl<12 → белее\nметка: h1[i]<34 && dl<150 → max(a, 215*(150-dl)/150), белая\nвес по радиусу: (150 + 105*d/38)/255;  ступица tent(u-100,300) при d<10", "0–1,4 с оборот, до 1,8 с гаснет", "b_ang, b_dist + h1"],
    6: ["Два рукава-спирали раскручиваются из центра к краю и вращаются. Время видно.",
        "R   = smooth(0,1250,u)*46/255              // фронт, четверти шара\nrho = u*256/1700\nv   = (2*ang + 7*d - rho) & 255;  dd = min(v, 256-v)\na   = tent(dd,56) * (255-3d)/255   при d<=R\nфронт (R-d<7) белее;  центр: вспышка tent(u-150,350)*(9-d)/9 при u<500", "0–1,25 с рукава растут, вращаются до 2,0 с", "b_ang, b_dist"],
    7: ["Время нарочно уходит: сердце пульсирует дважды («тум-тум») и растворяется в слушании.",
        "beat(q,pk) = q<90 ? pk*q/90 : max(0, pk - pk*(q-90)/380)\nenv  = max( beat(u-150,255), beat(u-540,190) )\nhide = smooth(0,140,u) * fo/255;  dimAll(255 - 200*hide)\nсердце 0x36 0x7f 0x7f 0x3e 0x08: a = 60 + 195*env/255, к белому 110*env/255\nореол: шары линзы 1 — 70*env/255", "удары в 0,15 и 0,54 с, держит до 1,5 с, гаснет до 1,9 с", "b_lens + pict()"],
    8: ["Щель по средней строке раскрывается в глаз; зрачок смотрит влево, вправо и возвращается; глаз моргает. Фон и время приглушены.",
        "w = smooth(0,250,u)*17/255                    // длина щели, полушаров\no = smooth(250,950,u)*(255 - 215*smooth(1750,1980,u)/255)/255\nax = |x-19|, dr = row-3\nH = o*(255 - (255*ax/17)²/255)/255;  m = H - 85*|dr|\nm>=0: 45 (белок); a = max(a, 230*tent(m,64)/255)   // веко\nзрачок: px = 4(x-19) - off; d2 = px² + (7dr)²; d2<=169 → 255, до 340 спад", "0–0,25 щель, до 0,95 раскрытие, взгляд 1,0–1,7, моргание 1,75–1,98, до 2,2 с", "row, x"],
    9: ["Звёзды мерцают всё гуще, затем общая вспышка от центра.",
        "dth = 10 + smooth(0,1250,u)*240/255\nh1[i] < dth → звезда: ph = h2[i] + u*(220+(h3[i]&63))/1000\ns = 255 - 2*|ph-128|;  a = s²/255\nвспышка: f = tent(u-1500,200) * (255-3d)/255, белая", "0–1,25 с гуще, вспышка 1,3–1,7 с, до 2,0 с", "h1, h2, h3"],
    10: ["Ракета взлетает по средней колонке к центру и разрывается: 18 лучей по путям искр, затем россыпь.",
        "ракета (u<780): hr = 96 - smooth(0,720,u)*48/255;  колонка |x-19|<=1\nвзрыв q = u-780: вспышка tent(q-70,160)*tent(d,16)\nлучи: head = (len-1)*e, e = x(2-x), x = min(q,650)/650\nроссыпь q>400: t2 = q-400-h2*5/3; 0..500 → 220*(500-t2)/500 при h3<120, d>10", "ракета 0–0,78 с, взрыв 0,78–1,43, россыпь до 2,1, до 2,2 с", "spark, row, x, h2, h3"],
    11: ["Капли бегут по диагоналям решётки: влево-вниз и вправо-вниз; за ними остаётся лёгкий след. Время видно.",
        "поток A: key = col;  поток B: key = col - row + 6\nhead = (u - delay(key))*128/1000 - 16        // 8 рядов/с\ndelay_A = ((37key+11)&31)*26;  delay_B = ((29key+5)&31)*26 + 110\ndf = head - 16*row;  0<=df<96: ((96-df)/96)²;  df>=96: 26 (след)", "капли 0–1,7 с, след до 2,0 с", "col, row"],
};

const GROUPS = [
    { id: "clock", tab: "look", title: "Часы", f: [
        { k: "clock_style", t: "sel", l: "Шрифт", o: ["Нет", "Тип 1", "Тип 2", "Тип 3"] },
        { k: "clock_style_zero", t: "sw", l: "Ведущий ноль", h: "09:05 вместо 9:05" },
        { k: "clock_color", t: "col", l: "Цвет" }] },
    { id: "back", tab: "look", title: "Фон", f: [
        { k: "back_mode", t: "sel", l: "Режим", o: ["Нет", "Градиент", "Перлин"] },
        { k: "back_pal", t: "pal", l: "Палитра", w: 1, if: (s) => s.back_mode > 0 },
        { k: "back_bright", t: "rng", l: "Яркость", min: 0, max: 255, w: 1, if: (s) => s.back_mode > 0 },
        { k: "back_speed", t: "rng", l: "Скорость", min: 0, max: 100, w: 1, if: (s) => s.back_mode > 0 },
        { k: "back_scale", t: "rng", l: "Масштаб", min: 0, max: 100, w: 1, if: (s) => s.back_mode > 0 },
        { k: "back_angle", t: "rng", l: "Угол", min: -180, max: 180, w: 1, u: "°", if: (s) => s.back_mode === 1 }] },
    { id: "bright", tab: "light", title: "Яркость", f: [
        { k: "auto_bright", t: "sw", l: "Автояркость", h: "по датчику света" },
        { k: "_br", t: "live", l: "Сейчас на часах", live: "brnow" },
        { k: "_adc", t: "live", l: "Сигнал с датчика", live: "adc", if: (s) => s.auto_bright },
        { k: "bright_min", t: "rng", l: "Мин.", min: 0, max: 255, w: 1, if: (s) => s.auto_bright },
        { k: "bright_max", t: "rng", l: "Макс.", min: 0, max: 255, w: 1, if: (s) => s.auto_bright },
        { k: "_adcb", t: "btns", l: "Калибровка датчика", w: 1, h: "Закройте датчик и нажмите «мин.», посветите и нажмите «макс.».", if: (s) => s.auto_bright },
        { k: "bright", t: "rng", l: "Яркость", min: 0, max: 255, w: 1, if: (s) => !s.auto_bright }] },
    { id: "night", tab: "light", title: "Ночной режим", f: [
        { k: "night_mode", t: "sw", l: "Включен", h: "тёмная комната и красные цифры" },
        { k: "night_color", t: "col", l: "Цвет", if: (s) => s.night_mode },
        { k: "night_mode_auto", t: "sw", l: "По расписанию", if: (s) => s.night_mode },
        { k: "night_mode_auto_since", t: "time", l: "С", if: (s) => s.night_mode && s.night_mode_auto },
        { k: "night_mode_auto_to", t: "time", l: "До", if: (s) => s.night_mode && s.night_mode_auto },
        { k: "_thr", t: "live", l: "Порог датчика", live: "thr", h: "Ночью, пока сигнал ниже порога. На странице порог не меняется.", if: (s) => s.night_mode }] },
    { id: "kaia", tab: "kaia", wide: 1, title: "Кая", f: [
        { k: "kaia_anim", t: "sel", l: "Анимации", o: STYLES },
        { k: "kaia_wake", t: "wake", l: "Пробуждение", w: 1, if: (s) => s.kaia_anim > 0 },
        { k: "kaia_wake_speed", t: "spd", l: "Скорость пробуждения", w: 1, if: (s) => s.kaia_anim > 0 },
        { k: "kaia_color", t: "col", l: "Цвет Каи", if: (s) => s.kaia_anim > 0 },
        { k: "kaia_bright", t: "rng", l: "Яркость", min: 0, max: 255, w: 1, if: (s) => s.kaia_anim > 0 },
        { k: "kaia_night", t: "sel", l: "Ночью", o: ["Как обычно", "Тусклее", "Не показывать"], if: (s) => s.kaia_anim > 0 }] },
    { id: "time", tab: "net", title: "Время", f: [
        { k: "ntp_gmt", t: "num", l: "Часовой пояс", min: -12, max: 14 },
        { k: "ntp_host", t: "txt", l: "NTP-сервер", w: 1 },
        { k: "_sync", t: "led", l: "Синхронизировано" },
        { k: "_loc", t: "live", l: "Локальное время", live: "time" }] },
    { id: "wifi", tab: "net", title: "Wi-Fi", f: [
        { k: "_wst", t: "live", l: "Подключено", live: "wifi" },
        { k: "wifi_ssid", t: "wtxt", l: "Сеть (SSID)", w: 1 },
        { k: "wifi_pass", t: "wpwd", l: "Пароль сети", w: 1 },
        { k: "_wgo", t: "btnw", l: "", h: "Применяется сразу, без «Сохранить»: часы переподключатся." },
        { k: "show_ip", t: "sw", l: "Показывать IP", h: "на часах при старте" }] },
    { id: "sys", tab: "sys", title: "Система", f: [
        { k: "page_pass", t: "pwd", l: "Пароль страницы", w: 1, h: "Пустой — без пароля. После сохранения страница спросит его." },
        { k: "log_host", t: "txt", l: "Сервер логов", w: 1, h: "IP:порт" },
        { k: "_ver", t: "live", l: "Версия прошивки", live: "ver" },
        { k: "_chk", t: "btnc", l: "" }] }];

const TABS = [
    { id: "look", t: "Вид", i: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    { id: "light", t: "Свет", i: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>' },
    { id: "kaia", t: "Кая", i: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>' },
    { id: "net", t: "Сеть", i: '<path d="M5 12a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0"/><circle cx="12" cy="18.5" r="1"/>' },
    { id: "sys", t: "Система", i: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' }];

const FLD = {};
GROUPS.forEach((g) => g.f.forEach((f) => (FLD[f.k] = Object.assign({ g: g.title }, f))));

function fmtVal(k, v) {
    if (k === "kaia_wake_speed") return v + " % · " + String(v / 100).replace(".", ",") + "×";
    return v + ((FLD[k] && FLD[k].u) || "");
}

function fmtAny(k, v) {
    const f = FLD[k];
    if (!f) return String(v);
    switch (f.t) {
        case "sel": return f.o[v];
        case "sw": return v ? "вкл" : "выкл";
        case "col": return hexs(v);
        case "time": return hm(v);
        case "pal": return PAL_NAMES[v];
        case "wake": return WAKE_NAMES[v];
        case "pwd": return v ? "••••" : "пусто";
        case "num": return (v > 0 ? "+" : "") + v;
        case "spd": case "rng": return fmtVal(k, v);
    }
    return String(v) || "пусто";
}

const RVB = (k) => '<button class="rv" data-rv="' + k + '" title="Вернуть сохранённое" aria-label="Вернуть сохранённое">↺</button>';
const opts = (list, v) => list.map((o, i) => '<option value="' + i + '"' + (i === v ? " selected" : "") + ">" + esc(o) + "</option>").join("");

function fieldHTML(f, s) {
    const v = s[f.k], stack = f.w ? " stack" : "", lab = esc(f.l);
    const wrap = (c, rv = true) => '<div class="fld' + stack + '" data-f="' + f.k + '"><div class="fl"><span>' + lab + (f.h ? "<small>" + esc(f.h) + "</small>" : "") + "</span>" + (rv ? RVB(f.k) : "") + "</div>" + c + "</div>";
    switch (f.t) {
        case "sw": return wrap('<label class="sw"><input type="checkbox" data-k="' + f.k + '"' + (v ? " checked" : "") + ' aria-label="' + lab + '"><i></i></label>');
        case "sel": return wrap('<select data-k="' + f.k + '" aria-label="' + lab + '">' + opts(f.o, v) + "</select>");
        case "pal": return wrap('<div class="pal"><select data-k="' + f.k + '" aria-label="' + lab + '">' + opts(PAL_NAMES, v) + '</select><i class="palbar" style="background:' + palCss(v) + '"></i></div>');
        case "col": return wrap('<input type="color" data-k="' + f.k + '" value="' + hexs(v) + '" aria-label="' + lab + '">');
        case "rng": return wrap('<div class="rng"><input type="range" data-k="' + f.k + '" min="' + f.min + '" max="' + f.max + '" value="' + v + '" aria-label="' + lab + '"><output>' + fmtVal(f.k, v) + "</output></div>");
        case "txt": return wrap('<input type="text" data-k="' + f.k + '" value="' + esc(v) + '" autocomplete="off" aria-label="' + lab + '">');
        case "pwd": return wrap('<input type="password" data-k="' + f.k + '" value="' + esc(DRAFT.page_pass || "") + '" autocomplete="new-password" placeholder="' + (api.pass ? "задан; новый — сюда" : "без пароля") + '" aria-label="' + lab + '">');
        case "wtxt": return wrap('<input type="text" data-w="ssid" value="' + esc(W.ssid) + '" autocomplete="off" aria-label="' + lab + '">', false);
        case "wpwd": return wrap('<input type="password" data-w="pass" value="' + esc(W.pass) + '" autocomplete="new-password" placeholder="только запись" aria-label="' + lab + '">', false);
        case "time": return wrap('<input type="time" data-k="' + f.k + '" value="' + hm(v) + '" aria-label="' + lab + '">');
        case "num": return wrap('<div class="step"><button data-step="-1" data-k2="' + f.k + '" aria-label="меньше">−</button><output>' + (v > 0 ? "+" : "") + v + '</output><button data-step="1" data-k2="' + f.k + '" aria-label="больше">+</button></div>');
        case "live": return wrap('<span class="val" data-live="' + f.live + '"></span>', false);
        case "led": return wrap('<span class="led" data-live="led"><i></i><span></span></span>', false);
        case "btns": return wrap('<div class="btns"><button class="btn sm" data-act="admin">Запомнить мин.</button><button class="btn sm" data-act="admax">Запомнить макс.</button></div>', false);
        case "btnw": return '<div class="fld stack"><div class="btns"><button class="btn pri" data-act="wifi">Подключить</button></div><div class="fl"><span><small>' + esc(f.h) + "</small></span></div></div>";
        case "btnc": return '<div class="fld stack"><div class="btns"><button class="btn" data-act="check">Проверить обновления</button>' + (LIVE && LIVE.update ? '<button class="btn pri" data-act="upd">Доступно обновление → Обновить</button>' : "") + '</div><div class="fl"><span><small id="chkst">' + esc(P.upd || (LIVE && LIVE.update ? "Доступна новая прошивка (сейчас " + LIVE.version + ")" : "Новых версий не видно")) + "</small></span></div></div>";
        case "wake": {
            const sty = s.kaia_anim || 1;
            const tiles = [];
            for (let id = 0; id < WAKE_COUNT; id++) {
                const eff = wakeId(s, id);
                tiles.push('<button class="tile' + (v === id ? " sel" : "") + '" data-tw="' + id + '"><canvas></canvas><span class="tn"><b>' + id + " · " + WAKE_NAMES[id] + "</b><i>" + (id ? fmtS(wakeLength(eff, s.kaia_wake_speed)) : "сейчас: " + WAKE_NAMES[sty]) + "</i></span></button>");
            }
            return '<div class="fld stack" data-f="' + f.k + '"><div class="fl"><span>' + lab + "<small>Отдельно от стиля. Нажмите плитку: она сыграет на большом превью выше.</small></span>" + RVB(f.k) + '</div><div class="wg">' + tiles.join("") + '</div><div id="wdoc">' + docHTML(v, s) + "</div>" + allDocs() + "</div>";
        }
        case "spd":
            return '<div class="fld stack spd" data-f="' + f.k + '"><div class="fl"><span>' + lab + "<small>Меняет только пробуждение; слушание после него идёт в своём темпе.</small></span><output>" + fmtVal(f.k, v) + "</output>" + RVB(f.k) + "</div>" +
                '<input type="range" data-k="' + f.k + '" min="50" max="200" step="5" value="' + v + '" aria-label="' + lab + '">' +
                '<div class="row">' + [[50, "½×"], [100, "1×"], [150, "1,5×"], [200, "2×"]].map((a) => '<button class="chip' + (v === a[0] ? " on" : "") + '" data-sp="' + a[0] + '">' + a[1] + "</button>").join("") + "</div>" +
                '<div class="btns"><button class="btn pri" data-act="onclock">Показать на часах</button></div><small class="hint">Играет на часах без сохранения: <code>/kaia/anim?name=wake&amp;style=…&amp;wake=…&amp;speed=…</code></small></div>';
    }
    return "";
}

function docHTML(id, s) {
    const eff = wakeId(s, id), d = WDOC[eff];
    return '<div class="doc"><h4>' + (id ? "№ " + id : "№ 0 → № " + eff) + " · " + WAKE_NAMES[eff] + "<span>" + fmtS(wake_ms[eff]) + " при 1× · " + fmtS(wakeLength(eff, s.kaia_wake_speed)) + " при " + s.kaia_wake_speed + " %</span></h4><p>" + d[0] + "</p><pre>" + esc(d[1]) + "</pre><p>Тайминг: " + d[2] + ". Таблицы: " + d[3] + ".</p></div>";
}

function allDocs() {
    let h = '<details class="all"><summary>Формулы и тайминги всех пробуждений (для прошивки)</summary>';
    for (let i = 1; i < WAKE_COUNT; i++) h += '<div class="doc"><h4>№ ' + i + " · " + WAKE_NAMES[i] + "<span>" + fmtS(wake_ms[i]) + "</span></h4><p>" + WDOC[i][0] + "</p><pre>" + esc(WDOC[i][1]) + "</pre><p>Тайминг: " + WDOC[i][2] + ". Таблицы: " + WDOC[i][3] + ".</p></div>";
    return h + "</details>";
}

// ================= rendering the groups =================

let tiles = [];
let filmT = 0;

function renderGroup(g) {
    const el = document.getElementById("g-" + g.id), s = S();
    if (!el) return;
    el.querySelector(".gbody").innerHTML = g.f.filter((f) => !f.if || f.if(s)).map((f) => fieldHTML(f, s)).join("");
    if (g.id === "kaia") bindTiles();
    markDirty();
    refreshLive();
    filmSoon();
}

function renderAll() {
    GROUPS.forEach(renderGroup);
}

function buildGroups() {
    $("#groups").innerHTML = GROUPS.map((g) => '<section class="card grp' + (g.wide ? " wide" : "") + '" id="g-' + g.id + '" data-tab="' + g.tab + '"><h2>' + g.title + '</h2><div class="gbody"></div></section>').join("") +
        '<section class="card film grp wide" id="film" data-tab="kaia"><h2>Пробуждения по кадрам</h2><p class="hint">Те же формулы, шесть моментов каждого пробуждения при 100 %, с вашими фоном, шрифтом и цветом Каи.</p><div id="filmbody"></div></section>';
    $("#tabs").innerHTML = TABS.map((t) => '<button class="tab" data-tab="' + t.id + '"><svg viewBox="0 0 24 24">' + t.i + "</svg><span>" + t.t + "</span></button>").join("");
}

function showTab(id) {
    P.tab = id;
    $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
    $$("#groups>.grp").forEach((g) => (g.hidden = g.dataset.tab !== id));
    requestAnimationFrame(() => {
        sizeTiles();
        if (id === "kaia") buildFilm();
    });
}

const groupOf = (k) => GROUPS.find((g) => g.f.some((f) => f.k === k));

function markDirty() {
    $$(".fld[data-f]").forEach((e) => e.classList.toggle("is-chg", e.dataset.f in DRAFT));
    $$(".tab").forEach((a) => a.classList.toggle("dirty", GROUPS.some((g) => g.tab === a.dataset.tab && g.f.some((f) => f.k in DRAFT))));
    const ks = Object.keys(DRAFT), bar = $("#sbar");
    bar.hidden = !ks.length || P.conn === "auth";
    if (!P.saving) $("#sbn").textContent = "Не сохранено: " + ks.length;
    $("#sbl").textContent = ks.map((k) => (FLD[k] ? FLD[k].l : k)).join(", ") + (P.conn === "offline" ? " · нет связи, сохранить нельзя" : "");
    $("#sbsave").disabled = P.conn !== "ok" || P.saving;
    hsum();
}

function hsum() {
    const s = S(), id = wakeId(s, s.kaia_wake);
    $("#hsum").innerHTML = s.kaia_anim ? "Пробуждение: <b>" + (s.kaia_wake ? s.kaia_wake + " · " : "0 → ") + WAKE_NAMES[id] + "</b><br>" + s.kaia_wake_speed + " % · " + fmtS(wakeLength(id, s.kaia_wake_speed)) + " · затем слушание «" + STYLES[s.kaia_anim] + "»" : "Анимации Каи выключены.";
}

function setVal(k, v) {
    if (v === SAVED[k] && k !== "page_pass") delete DRAFT[k];
    else DRAFT[k] = v;
    if (k === "page_pass" && v === "") delete DRAFT[k];
    if (P.src === "now") setSrc("draft");
    markDirty();
    if (k === "kaia_wake_speed" || k === "kaia_wake") updWakeUI();
    filmSoon();
}

function updWakeUI() {
    const s = S(), d = $("#wdoc");
    if (d) d.innerHTML = docHTML(s.kaia_wake, s);
    $$(".tile").forEach((t) => {
        const id = +t.dataset.tw, eff = wakeId(s, id);
        t.classList.toggle("sel", id === s.kaia_wake);
        t.querySelector("i").textContent = id ? fmtS(wakeLength(eff, s.kaia_wake_speed)) : "сейчас: " + WAKE_NAMES[eff];
    });
    $$("[data-sp]").forEach((b) => b.classList.toggle("on", +b.dataset.sp === s.kaia_wake_speed));
    $$('[data-f="kaia_wake_speed"] output').forEach((o) => (o.textContent = fmtVal("kaia_wake_speed", s.kaia_wake_speed)));
}

// ================= the live values =================

function refreshLive() {
    const s = S(), L = LIVE, light = L ? L.light : 0;
    const t = L ? sync.at(clockMillis()) : null;
    const map = {
        brnow: L ? L.bright + " из 255" : "—",
        adc: L ? light + "  [" + s.adc_min + " … " + s.adc_max + "]" : "—",
        thr: L ? "датчик " + light + " · ночь ниже " + s.night_trsh : "—",
        time: !L ? "—" : !L.synced ? "нет (на часах «-- --»)" : two(t.hour) + ":" + two(t.minute) + ":" + two(t.second),
        wifi: !WIFI ? "—" : WIFI.ap ? "своя точка доступа · " + WIFI.ip : (WIFI.ssid || "—") + " · " + WIFI.ip + " · " + WIFI.rssi + " дБм",
        ver: L ? L.version + (L.update ? " → есть новее" : "") : "—",
    };
    $$("[data-live]").forEach((e) => {
        if (e.dataset.live === "led") {
            const on = !!(L && L.synced);
            e.classList.toggle("on", on);
            e.lastChild.textContent = on ? "да" : "нет";
            return;
        }
        const v = map[e.dataset.live];
        if (v != null && e.textContent !== v) e.textContent = v;
    });
    const st = P.conn === "offline" ? ["err", "нет связи"] : P.conn === "auth" ? ["warn", "нужен пароль"] : P.conn === "wait" ? ["warn", "подключаюсь…"] : WIFI && WIFI.ap ? ["warn", "точка доступа"] : ["", "на связи"];
    $("#sdot").className = "dot " + st[0];
    $("#stxt").textContent = st[1];
    $("#ver").textContent = L ? "v" + L.version : "…";
    $("#logout").hidden = !api.pass;
}

function banners() {
    let h = "";
    if (P.conn === "offline") h += '<div class="ban err"><b>Часы не отвечают</b><span>' + (everOk ? "Показан последний кадр; изменения останутся в черновике." : "Страница не получила ответа от часов.") + '</span><button class="btn sm" data-act="retry">Повторить</button></div>';
    if (WIFI && WIFI.ap && P.conn === "ok") h += '<div class="ban warn"><b>Часы раздают свою сеть</b><span>Времени пока нет — на часах «-- --». Укажите домашнюю Wi-Fi сеть и нажмите «Подключить».</span><button class="btn sm" data-tab="net">К настройкам Wi-Fi</button></div>';
    if (LIVE && LIVE.update && P.conn === "ok") h += '<div class="ban acc"><b>Доступна новая прошивка</b><span>Сейчас ' + esc(LIVE.version) + '. Обновление займёт около минуты, часы перезагрузятся.</span><button class="btn sm pri" data-act="upd">Обновить</button></div>';
    if ($("#ban").innerHTML !== h) $("#ban").innerHTML = h;
    document.body.classList.toggle("off", P.conn === "offline");
    document.body.classList.toggle("auth", P.conn === "auth");
    const g = $("#g-wifi");
    if (g) g.classList.toggle("hl", !!(WIFI && WIFI.ap));
}

// ================= the clock: state every 5 s while the tab is visible =================

let pollT = 0, polling = false;
const clockMillis = () => (LIVE ? LIVE.ms + (performance.now() - recvAt) : performance.now());

function takeState(st) {
    const before = SAVED;
    LIVE = st;
    recvAt = performance.now();
    if (st.synced) sync.add(parseTime(st.time), st.ms);
    SAVED = normalize(Object.assign({}, st.settings, { page_pass: "", wifi_pass: "", wifi_ssid: WIFI ? WIFI.ssid : "" }));
    for (const k of Object.keys(DRAFT)) if (k !== "page_pass" && DRAFT[k] === SAVED[k]) delete DRAFT[k];
    const changed = Object.keys(SAVED).filter((k) => SAVED[k] !== before[k]);
    const act = document.activeElement;
    new Set(changed.map(groupOf).filter(Boolean)).forEach((g) => {
        const el = document.getElementById("g-" + g.id);
        if (!el || !el.contains(act) || act === document.body) renderGroup(g);
    });
}

async function poll(wifiToo) {
    if (polling) return;
    clearTimeout(pollT);
    polling = true;
    try {
        if (wifiToo || !WIFI) {
            WIFI = await api.wifi();
            if (!W.ssid && WIFI && WIFI.ssid) {
                W.ssid = WIFI.ssid;
                renderGroup(groupOf("wifi_ssid"));
            }
        }
        takeState(await api.state());
        P.conn = "ok";
        everOk = true;
        if ($("#modal").dataset.k === "login") closeModal();
    } catch (e) {
        if (e instanceof AuthError) {
            P.conn = "auth";
            loginModal();
        } else if (e instanceof OfflineError) {
            P.conn = "offline";
        } else {
            P.conn = "offline";
        }
    }
    polling = false;
    banners();
    markDirty();
    refreshLive();
    // every 5 s while the tab is visible; visibilitychange reads it again when it comes back
    if (P.conn !== "auth") pollT = setTimeout(() => !document.hidden && poll(false), 5000);
    if (mirrorWanted()) mirrorLoop();
}

// /kaia/frame: at most 4 a second, one at a time, only while the mirror is shown and the tab is visible
let mirrorOn = false;
const textNow = () => !!(LIVE && LIVE.overlay === "text");
const mirrorWanted = () => !document.hidden && P.conn === "ok" && (P.src === "now" || P.src === "cmp") && (P.live === "mirror" || textNow());

async function mirrorLoop() {
    if (mirrorOn) return;
    mirrorOn = true;
    while (mirrorWanted()) {
        const t = performance.now();
        try {
            const f = await api.frame();
            FRAME = { leds: parseLeds(f.leds), bright: f.bright, night: f.night, at: performance.now() };
        } catch (e) {
            if (e instanceof AuthError) {
                P.conn = "auth";
                loginModal();
            }
            break;
        }
        await new Promise((r) => setTimeout(r, Math.max(0, 250 - (performance.now() - t))));
    }
    mirrorOn = false;
}

// ================= the preview =================

const KS = [["wake", "Пробуждение"], ["listening", "Слушает"], ["thinking", "Думает"], ["speaking", "Говорит"], ["done", "Готово"], ["error", "Ошибка"], ["notify", "Уведомление"], ["off", "Стоп"]];
const gainOf = (b) => 0.3 + (0.7 * b) / 255;
let view = null, view2 = null;

// the clock's time now (from the state), or the browser's before the first answer
function timeNow() {
    if (LIVE) {
        const t = sync.at(clockMillis());
        return { millis: clockMillis(), synced: !!LIVE.synced, hour: t.hour, minute: t.minute, ms: t.ms };
    }
    const d = new Date(), ms = performance.now();
    return { millis: ms, synced: true, hour: d.getHours(), minute: d.getMinutes(), ms: d.getMilliseconds() };
}

// what the clock plays now, from the state, at this moment
function playNow() {
    const p = LIVE && LIVE.play;
    if (!p) return null;
    const el = performance.now() - recvAt;
    return { anim: animOf(p.name), style: p.style, wake: p.wake || 0, speed: p.speed || 100, t: p.t + el, color: p.color ? parseInt(p.color, 16) : null };
}

// the draft's play: the button or tile pressed, on the draft's settings
function playDraft(s) {
    const M = P.M;
    if (!M) return null;
    const t = RM && M.still ? M.still : performance.now() - M.t0;
    return { anim: M.anim, style: s.kaia_anim || 1, wake: M.wake != null ? M.wake : s.kaia_wake, speed: M.speed || s.kaia_wake_speed, t, color: null, ms: 7000 };
}

const lightNow = () => (LIVE ? LIVE.light : 500);
const nightFor = (s, tm) => (P.forceNight != null ? !!P.forceNight : isNight(s, lightNow(), tm.hour, tm.minute));
const work = new BallMatrix();

// «Сейчас»: the clock's own frame (mirror) or the renderer on the saved settings in step with the clock
function frameNow() {
    if (P.conn === "offline" && FRAME) return { leds: FRAME.leds, gain: gainOf(FRAME.bright) * 0.4, mirror: true };
    if ((P.live === "mirror" || textNow()) && FRAME && P.conn === "ok") return { leds: FRAME.leds, gain: gainOf(FRAME.bright), mirror: true, night: FRAME.night };
    const tm = timeNow(), play = playNow(), on = !!resolvePlay(play);
    const leds = renderFrame(work, SAVED, { ...tm, night: LIVE ? !!LIVE.night : false, play, duck: on ? duckSince(play) : 0 });
    return { leds: Uint32Array.from(leds), gain: gainOf(LIVE ? LIVE.bright : 128) * (P.conn === "offline" ? 0.4 : 1), night: LIVE && LIVE.night };
}

// the duck as it stands t ms into a play (it eases in over about 0.25 s)
function duckSince(play) {
    let d = 0;
    for (let n = Math.min(40, (play.t / 50) | 0); n > 0; n--) d = duckStep(d, true);
    return d;
}

function frameDraft() {
    const s = S(), tm = timeNow(), night = nightFor(s, tm);
    let play = playDraft(s);
    if (play && !resolvePlay(play)) {
        P.M = null;
        play = null;
        markKs();
    }
    const leds = renderFrame(work, s, { ...tm, night, play, duck: P.duck });
    return { leds: Uint32Array.from(leds), gain: gainOf(brightNow(s, lightNow())) * (P.conn === "offline" ? 0.4 : 1), night, play };
}

function status(fr, src) {
    const pre = src === "now" ? "Сейчас · " : "Черновик · ";
    if (src === "now") {
        if (P.conn === "offline") return "нет связи · последний кадр";
        if (fr.mirror) return pre + (textNow() ? "бегущая строка · кадры с часов" : "зеркало · кадры с часов");
        const p = playNow(), r = resolvePlay(p);
        if (!r) return pre + (fr.night ? "ночь" : "день") + ", без анимации";
        return pre + KS.find((k) => k[0] === ANIM_NAMES[r.anim])[1] + (r.anim === A_WAKE ? " · " + WAKE_NAMES[wakeId({ kaia_anim: r.style }, r.wake)] : "");
    }
    const s = S(), p = fr.play && resolvePlay(fr.play);
    if (!p) return pre + (fr.night ? "ночь" : "день") + ", без анимации";
    let t = pre + KS.find((k) => k[0] === ANIM_NAMES[p.anim])[1];
    if (p.anim === A_WAKE) {
        const id = wakeId(s, p.wake);
        t += " · " + WAKE_NAMES[id] + " · " + p.speed + " % · " + fmtS(wakeLength(id, p.speed));
    } else if (isState(p.anim)) t += " · пока не нажмёте «Стоп»";
    return t;
}

function wipe(c, L) {
    const x = Math.round(L.W * P.cmp), y = L.H / 2;
    c.save();
    c.fillStyle = "#00d1ff";
    c.fillRect(x - 1, 0, 2, L.H);
    c.beginPath();
    c.arc(x, y, 14, 0, 6.2832);
    c.fill();
    c.fillStyle = "#031a22";
    c.beginPath();
    c.moveTo(x - 8, y);
    c.lineTo(x - 3, y - 5);
    c.lineTo(x - 3, y + 5);
    c.fill();
    c.beginPath();
    c.moveTo(x + 8, y);
    c.lineTo(x + 3, y - 5);
    c.lineTo(x + 3, y + 5);
    c.fill();
    c.restore();
}

function draw() {
    if (!view) return;
    P.frames = (P.frames || 0) + 1;
    const wall = $("#wall");
    wall.classList.toggle("cmp", P.src === "cmp");
    const d = frameDraft();
    let shown = d;
    if (P.src === "cmp") {
        const n = frameNow(), x = Math.round(view.L.W * P.cmp);
        paint(view, n.leds, n.gain, [0, x]);
        paint(view, d.leds, d.gain, [x, view.L.W]);
        wipe(view.ctx, view.L);
        $("#badge").textContent = "";
    } else {
        shown = P.src === "now" ? frameNow() : d;
        paint(view, shown.leds, shown.gain);
        $("#badge").textContent = status(shown, P.src);
    }
    $("#pst").textContent = P.src === "cmp" ? "Слева «Сейчас», справа «Черновик»: тяните границу." : P.src === "now" ? (shown.mirror ? "«Сейчас»: кадры часов, 4 раза в секунду." : "«Сейчас»: расчёт на странице по состоянию часов.") : "«Черновик»: расчёт на странице по тем же данным.";
    if (view2 && document.body.classList.contains("minion")) paint(view2, shown.leds, shown.gain);
    // the duck of the draft: one step a frame
    P.duck = duckStep(P.duck, !!(d.play && !(d.night && S().kaia_night === 2) && S().kaia_anim));
}

function fit() {
    const wall = $("#wall"), cs = getComputedStyle(wall);
    const w = Math.floor(wall.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    if (w > 0 && (!view || view.L.W !== w)) view = fitCanvas($("#cv"), w);
    if (!view2) view2 = fitCanvas($("#cv2"), 240);
    sizeTiles();
}

function setSrc(v) {
    P.src = v;
    $$("[data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === v));
    $("#day").hidden = v === "now";
    $("#live").hidden = v === "draft";
    if (mirrorWanted()) mirrorLoop();
}

function setLive(v) {
    P.live = v;
    $$("[data-l]").forEach((b) => b.classList.toggle("on", b.dataset.l === v));
    if (mirrorWanted()) mirrorLoop();
}

function play(name, over) {
    if (name === "off") {
        P.M = null;
        markKs();
        return;
    }
    const s = S();
    if (!s.kaia_anim) {
        toast("Анимации выключены: выберите стиль в группе «Кая»");
        return;
    }
    if (P.src === "now") setSrc("draft");
    const anim = ANIM_NAMES.indexOf(name);
    P.M = Object.assign({ anim, t0: performance.now() }, over || {});
    if (RM) P.M.still = anim === A_WAKE ? (wakeLength(wakeId(s, P.M.wake != null ? P.M.wake : s.kaia_wake), P.M.speed || s.kaia_wake_speed) / 2) | 0 : isState(anim) ? 1200 : (shot_ms[(s.kaia_anim || 1) - 1][anim - 3] / 2) | 0;
    markKs();
}

function markKs() {
    $$("[data-ks]").forEach((c) => c.classList.toggle("on", !!P.M && c.dataset.ks === ANIM_NAMES[P.M.anim]));
}

// ================= the gallery =================

let tileIO = null;
const seen = new Set();

function bindTiles() {
    tiles = $$(".tile canvas").map((c) => ({ c, id: +c.closest(".tile").dataset.tw, t0: performance.now() - +c.closest(".tile").dataset.tw * 130, v: null, w: 0, play: false }));
    if ("IntersectionObserver" in window) {
        if (tileIO) tileIO.disconnect();
        seen.clear();
        tileIO = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))));
        tiles.forEach((t) => tileIO.observe(t.c));
    }
    sizeTiles();
}

function sizeTiles() {
    tiles.forEach((t) => {
        const w = t.c.clientWidth;
        if (!w || w === t.w) return;
        t.w = w;
        t.v = fitCanvas(t.c, w);
        t.v.simple = true;
    });
    tilesTick(true);
}

// the clock under the tiles: the draft's background and time, with any style a wake can play over
function tileBase() {
    const s0 = S(), s = Object.assign({}, s0, { kaia_anim: s0.kaia_anim || 1, kaia_night: s0.kaia_night === 2 ? 1 : s0.kaia_night });
    const tm = timeNow(), night = nightFor(s, tm);
    const base = new BallMatrix();
    renderFrame(base, s, { ...tm, night, play: null, duck: 255 });
    return { s, night, base, gain: gainOf(brightNow(s, lightNow())) };
}

function overlayOn(b, play) {
    work.leds.set(b.base.leds);
    work.marks.set(b.base.marks);
    useMatrix(work);
    kaiaDraw(b.s, b.night, play);
    return work.leds;
}

function tilesTick(force) {
    const live = tiles.filter((t) => t.v && t.c.isConnected && t.c.offsetParent && (!tileIO || seen.has(t.c) || force));
    if (!live.length) return;
    const b = tileBase(), now = performance.now();
    for (const tl of live) {
        const id = wakeId(b.s, tl.id), len = wakeLength(id, b.s.kaia_wake_speed), cyc = len + 1500;
        if (RM && !tl.play && !force) continue;
        let el = RM && !tl.play ? (len / 2) | 0 : (now - tl.t0) % cyc;
        if (RM && tl.play && now - tl.t0 > cyc) {
            tl.play = false;
            el = (len / 2) | 0;
        }
        paint(tl.v, overlayOn(b, { anim: A_WAKE, style: b.s.kaia_anim, wake: tl.id, speed: b.s.kaia_wake_speed, t: el, color: null }), b.gain);
    }
}

function filmSoon() {
    clearTimeout(filmT);
    filmT = setTimeout(buildFilm, 350);
}

function buildFilm() {
    const root = $("#filmbody");
    if (!root || !root.offsetParent) return;
    const b = tileBase(), cols = innerWidth <= 520 ? 3 : 6, Wd = Math.max(60, Math.floor((root.clientWidth - (cols - 1) * 6) / cols) - 8);
    root.innerHTML = "";
    for (let id = 1; id < WAKE_COUNT; id++) {
        const box = document.createElement("div");
        box.className = "shot";
        box.innerHTML = '<div class="nm">№ ' + id + " · " + WAKE_NAMES[id] + "<span>" + fmtS(wake_ms[id]) + ' при 1×</span></div><div class="frames"></div>';
        const fr = box.lastChild;
        for (let k = 0; k < 6; k++) {
            const u = Math.round((wake_ms[id] * (k + 0.5)) / 6), cell = document.createElement("div"), c = document.createElement("canvas");
            cell.appendChild(c);
            cell.insertAdjacentHTML("beforeend", "<small>" + (u / 1000).toFixed(2).replace(".", ",") + " с</small>");
            fr.appendChild(cell);
            const v = fitCanvas(c, Wd);
            v.simple = true;
            paint(v, overlayOn(b, { anim: A_WAKE, style: b.s.kaia_anim, wake: id, speed: 100, t: u, color: null }), b.gain);
        }
        root.appendChild(box);
    }
}

// ================= the loop: 20 frames a second, nothing in a hidden tab =================

let lastT = 0, lastTiles = 0, lastLive = 0;

function loop(now) {
    if (document.hidden) return;
    requestAnimationFrame(loop);
    if (now - lastT < 48) return;
    lastT = now;
    draw();
    if (now - lastTiles >= 98) {
        lastTiles = now;
        tilesTick(false);
    }
    if (now - lastLive >= 500) {
        lastLive = now;
        refreshLive();
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    requestAnimationFrame(loop);
    poll(false);
    if (mirrorWanted()) mirrorLoop();
});

// ================= dialogs =================

let toastT = 0;
function toast(h) {
    const t = $("#toast");
    t.innerHTML = h;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 3800);
}

function modal(h, on) {
    const m = $("#modal");
    m.innerHTML = '<div class="mb" role="dialog" aria-modal="true">' + h + "</div>";
    m.hidden = false;
    m.dataset.k = "";
    if (on) on(m);
}

function closeModal() {
    $("#modal").hidden = true;
    $("#modal").dataset.k = "";
}

function loginModal() {
    if ($("#modal").dataset.k === "login") return;
    modal('<h3>Страница защищена паролем</h3><p>Часы ответили 401. Введите пароль страницы.</p><input type="password" id="lp" placeholder="Пароль" autocomplete="current-password" aria-label="Пароль"><div class="err" id="le"></div><div class="acts"><button class="btn pri" id="lg">Войти</button></div>' + (MOCK ? '<p style="font-size:12px">Пароль макета: ' + MOCK_PASS + "</p>" : ""), (m) => {
        m.dataset.k = "login";
        const go = async () => {
            const v = $("#lp").value;
            if (!v) {
                $("#le").textContent = "Введите пароль";
                return;
            }
            const old = api.pass;
            api.pass = v;
            $("#lg").disabled = true;
            try {
                takeState(await api.state());
                lsSet(PASS_KEY, v);
                P.conn = "ok";
                closeModal();
                poll(true);
            } catch (e) {
                api.pass = old;
                $("#le").textContent = e instanceof AuthError ? "Неверный пароль" : "Часы не ответили";
                $("#lp").select();
            }
            const b = $("#lg");
            if (b) b.disabled = false;
        };
        $("#lg").onclick = go;
        $("#lp").onkeydown = (e) => {
            if (e.key === "Enter") go();
        };
        setTimeout(() => $("#lp") && $("#lp").focus(), 50);
    });
}

function updateModal() {
    modal("<h3>Обновить прошивку?</h3><p>Часы скачают новую прошивку и перезагрузятся, около минуты. Не выключайте их. Настройки сохранятся.</p><div class=\"acts\"><button class=\"btn\" id=\"un\">Отмена</button><button class=\"btn pri\" id=\"uy\">Обновить</button></div>", () => {
        $("#un").onclick = closeModal;
        $("#uy").onclick = async () => {
            $("#uy").disabled = true;
            try {
                await api.set(ID_OTA_UPDATE, 1);
                closeModal();
                toast("Часы обновляются и перезагрузятся. Страница подождёт их.");
            } catch (e) {
                closeModal();
                failed(e);
            }
        };
    });
}

function failed(e) {
    if (e instanceof AuthError) {
        P.conn = "auth";
        loginModal();
    } else {
        toast("Часы не ответили. Попробуйте ещё раз.");
    }
}

// ================= saving =================

async function save() {
    const ks = Object.keys(DRAFT).sort((a, b) => (a === "page_pass") - (b === "page_pass"));  // the password last
    if (!ks.length || P.saving || P.conn !== "ok") return;
    P.saving = true;
    markDirty();
    let done = 0;
    try {
        for (const k of ks) {
            $("#sbn").textContent = "Сохраняю " + (done + 1) + " из " + ks.length + "…";
            await api.set(keyId(k), rawOf(k, DRAFT[k]));
            if (k === "page_pass") {
                api.pass = DRAFT[k];
                lsSet(PASS_KEY, api.pass);
            } else {
                SAVED[k] = DRAFT[k];
            }
            delete DRAFT[k];
            done++;
        }
        toast("Сохранено: " + done + ". Часы обновились.");
    } catch (e) {
        failed(e);
    }
    P.saving = false;
    renderAll();
    await poll(false);
}

function reset() {
    const copy = Object.assign({}, DRAFT);
    Object.keys(DRAFT).forEach((k) => delete DRAFT[k]);
    renderAll();
    toast('Изменения сброшены <button class="btn sm" id="undo" style="margin-left:8px">Вернуть</button>');
    $("#undo").onclick = () => {
        Object.assign(DRAFT, copy);
        renderAll();
        $("#toast").hidden = true;
    };
}

function showChanges() {
    modal('<h3>Не сохранено</h3><ul class="chl">' + Object.keys(DRAFT).map((k) => "<li><b>" + esc(FLD[k].g + " · " + FLD[k].l) + "</b><span>" + esc(fmtAny(k, SAVED[k])) + " → " + esc(fmtAny(k, DRAFT[k])) + "</span></li>").join("") + '</ul><div class="acts"><button class="btn" id="mc">Закрыть</button></div>', () => ($("#mc").onclick = closeModal));
}

// «Показать на часах»: a try-out, nothing is saved
async function onclock() {
    const s = S();
    if (!s.kaia_anim) {
        toast("Анимации выключены: выберите стиль в группе «Кая»");
        return;
    }
    if (P.conn !== "ok") {
        toast("Нет связи с часами");
        return;
    }
    const q = { style: s.kaia_anim, wake: s.kaia_wake, speed: s.kaia_wake_speed };
    play("wake");
    try {
        await api.anim("wake", q);
        toast("Играет на часах, ничего не сохраняется<br><code>GET kaia/anim?name=wake&amp;style=" + q.style + "&amp;wake=" + q.wake + "&amp;speed=" + q.speed + "</code>");
        setTimeout(() => poll(false), 400);
    } catch (e) {
        failed(e);
    }
}

async function clickBtn(id, msg) {
    try {
        await api.click(id);
        if (msg) toast(msg);
        setTimeout(() => poll(false), 300);
    } catch (e) {
        failed(e);
    }
}

// ================= events =================

document.addEventListener("input", (e) => {
    const t = e.target, k = t.dataset && t.dataset.k;
    if (t.dataset && t.dataset.w) {
        W[t.dataset.w] = t.value;
        return;
    }
    if (!k) return;
    let v;
    if (t.type === "checkbox") v = t.checked ? 1 : 0;
    else if (t.type === "color") v = unhex(t.value);
    else if (t.type === "time") v = unhm(t.value);
    else if (t.type === "range" || t.tagName === "SELECT") v = +t.value;
    else v = t.value;
    setVal(k, v);
    if (t.type === "range") {
        const o = t.closest(".fld").querySelector("output");
        if (o) o.textContent = fmtVal(k, v);
        if (k === "kaia_wake_speed") $$("[data-sp]").forEach((b) => b.classList.toggle("on", +b.dataset.sp === v));
    }
    if (t.type === "checkbox" || t.tagName === "SELECT") renderGroup(groupOf(k));
    if ((k === "kaia_color" || k === "kaia_anim") && !P.M && S().kaia_anim) play("listening");
});

document.addEventListener("click", (e) => {
    const t = e.target.closest("button,a,.sb-t");
    if (!t) return;
    const d = t.dataset;
    if (d.rv) {
        delete DRAFT[d.rv];
        renderGroup(groupOf(d.rv));
        return;
    }
    if (d.step) {
        const k = d.k2, f = FLD[k], v = Math.max(f.min, Math.min(f.max, S()[k] + +d.step));
        setVal(k, v);
        renderGroup(groupOf(k));
        return;
    }
    if (d.tab) {
        showTab(d.tab);
        if (d.tab === "kaia" && !P.M && P.conn !== "offline" && S().kaia_anim) setTimeout(() => play("wake"), 250);
        return;
    }
    if (d.tw != null) {
        const id = +d.tw;
        setVal("kaia_wake", id);
        const tl = tiles.find((x) => x.id === id);
        if (tl && RM) {
            tl.play = true;
            tl.t0 = performance.now();
        }
        play("wake");
        return;
    }
    if (d.sp) {
        setVal("kaia_wake_speed", +d.sp);
        renderGroup(groupOf("kaia_wake_speed"));
        play("wake");
        return;
    }
    if (d.ks) return play(d.ks);
    if (d.s) return setSrc(d.s);
    if (d.l) return setLive(d.l);
    if (d.d != null) {
        P.forceNight = +d.d;
        $$("#day button").forEach((b) => b.classList.toggle("on", b === t));
        tilesTick(true);
        filmSoon();
        return;
    }
    if (d.m) return mockMode(d.m);
    const a = d.act;
    if (a === "onclock") onclock();
    else if (a === "upd") updateModal();
    else if (a === "retry") poll(true);
    else if (a === "admin") clickBtn(keyId("adc_min"), "Минимум сигнала запомнен: " + lightNow());
    else if (a === "admax") clickBtn(keyId("adc_max"), "Максимум сигнала запомнен: " + lightNow());
    else if (a === "wifi") connectWifi();
    else if (a === "check") checkUpdates();
    else if (t.id === "sbsave") save();
    else if (t.id === "sbreset") reset();
    else if (t.id === "logout") logout();
    else if (t.classList.contains("sb-t")) showChanges();
});

async function connectWifi() {
    if (!W.ssid) {
        toast("Укажите сеть (SSID)");
        return;
    }
    try {
        await api.set(keyId("wifi_ssid"), W.ssid);
        await api.set(keyId("wifi_pass"), W.pass);
        await api.click(ID_WIFI_SAVE);
        W.pass = "";
        renderGroup(groupOf("wifi_ssid"));
        toast("Часы подключаются к «" + esc(W.ssid) + "». Страница может на минуту потерять связь.");
        setTimeout(() => poll(true), 1500);
    } catch (e) {
        failed(e);
    }
}

async function checkUpdates() {
    P.upd = "Проверяю…";
    renderGroup(groupOf("_chk"));
    try {
        await api.click(ID_CHECK_UPDATES);
        await new Promise((r) => setTimeout(r, MOCK ? 700 : 4000));
        await poll(false);
        P.upd = LIVE && LIVE.update ? "" : "Обновлений нет: у вас последняя версия";
    } catch (e) {
        P.upd = "";
        failed(e);
    }
    renderGroup(groupOf("_chk"));
}

function logout() {
    api.pass = "";
    lsSet(PASS_KEY, "");
    toast("Пароль забыт в этом браузере");
    poll(false);
}

// ?mock: the bar switches what the clock inside the page does
function mockMode(m) {
    const M = mock.M;
    if (m === "upd") M.update = !M.update;
    else if (m === "text") M.text = !M.text;
    else {
        M.mode = m;
        if (m === "auth") {
            api.pass = "";
            lsSet(PASS_KEY, "");
        }
    }
    $$("#mk [data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === "upd" ? M.update : b.dataset.m === "text" ? M.text : b.dataset.m === M.mode));
    if (m !== "auth" && $("#modal").dataset.k === "login") closeModal();
    if (m === "ap") showTab("net");
    WIFI = null;
    poll(true);
}

// the wipe of «Сравнить»
let drag = false;
const moveCmp = (e) => {
    const r = $("#cv").getBoundingClientRect();
    P.cmp = Math.max(0.04, Math.min(0.96, (e.clientX - r.left) / r.width));
};
$("#cv").addEventListener("pointerdown", (e) => {
    if (P.src !== "cmp") return;
    drag = true;
    e.target.setPointerCapture(e.pointerId);
    moveCmp(e);
});
$("#cv").addEventListener("pointermove", (e) => drag && moveCmp(e));
$("#cv").addEventListener("pointerup", () => (drag = false));

// ================= start =================

if (MOCK) $("#mockbar").hidden = false;
buildGroups();
$("#ks").innerHTML = KS.map((k) => '<button class="chip" data-ks="' + k[0] + '">' + k[1] + "</button>").join("");
renderAll();
showTab("kaia");
setSrc("draft");
new ResizeObserver(() => requestAnimationFrame(fit)).observe($("#wall"));
if ("IntersectionObserver" in window) new IntersectionObserver((es) => document.body.classList.toggle("minion", !es[0].isIntersecting && innerWidth > 900)).observe($("#hero"));
fit();
banners();
poll(true);
requestAnimationFrame(loop);
setTimeout(() => S().kaia_anim && !P.M && play("wake"), 600);
window.ballclock = { P, api, S, play, setSrc, setLive, showTab, mock, sync, tilesAt: (ms) => tiles.forEach((t) => (t.t0 = performance.now() - ms)), get LIVE() { return LIVE; } };
