#include "crash.h"

extern "C" {
#include <user_interface.h>
}

// RTC user memory is 512 bytes in 4-byte words; the first 128 bytes (32 words) belong to the OTA bootloader (eboot)
#define RTC_OFFSET_WORDS 32
#define CRASH_MAGIC 0x4b414941  // "KAIA"

struct CrashRecord {
    uint32_t magic;
    uint32_t cause, epc1, epc2, epc3, excvaddr, depc;
    uint32_t up;    // ms
    uint32_t heap;  // free heap of the last heap line
    uint32_t nbt;
    uint32_t bt[CRASH_BT_MAX];
    uint32_t sum;
};

static CrashInfo info;
static char reason[32] = "";
static volatile uint32_t last_heap = 0;

static uint32_t checksum(const CrashRecord& r) {
    const uint32_t* w = (const uint32_t*)&r;
    uint32_t s = 0x9e3779b9;
    for (size_t i = 0; i < (sizeof(r) - sizeof(r.sum)) / 4; i++) s = (s << 5 | s >> 27) ^ w[i];
    return s;
}

// IRAM code and the flash window of the sketch
static inline bool isCode(uint32_t v) {
    return (v >= 0x40100000 && v < 0x40110000) || (v >= 0x40200000 && v < 0x40300000);
}

// the ESP8266 core calls this (a weak C symbol) on an exception and on the software watchdog, right before it
// restarts the chip: nothing here may allocate or take a lock
extern "C" void custom_crash_callback(struct rst_info* rst_info, uint32_t stack, uint32_t stack_end) {
    CrashRecord r;
    memset(&r, 0, sizeof(r));
    r.magic = CRASH_MAGIC;
    r.cause = rst_info->exccause;
    r.epc1 = rst_info->epc1;
    r.epc2 = rst_info->epc2;
    r.epc3 = rst_info->epc3;
    r.excvaddr = rst_info->excvaddr;
    r.depc = rst_info->depc;
    r.up = millis();
    r.heap = last_heap;

    // the nearest 2 KB of the stack, as the exception decoder would read it
    if (stack >= 0x3ffe8000 && stack < stack_end && stack_end <= 0x40000000) {
        uint32_t end = stack_end - stack > 2048 ? stack + 2048 : stack_end;
        for (uint32_t p = stack & ~3u; p + 4 <= end && r.nbt < CRASH_BT_MAX; p += 4) {
            uint32_t v = *(volatile uint32_t*)p;
            if (!isCode(v)) continue;
            bool seen = false;
            for (uint32_t i = 0; i < r.nbt; i++) seen |= r.bt[i] == v;
            if (!seen) r.bt[r.nbt++] = v;
        }
    }

    r.sum = checksum(r);
    ESP.rtcUserMemoryWrite(RTC_OFFSET_WORDS, (uint32_t*)&r, sizeof(r));
}

void crashBegin() {
    strlcpy(reason, ESP.getResetReason().c_str(), sizeof(reason));

    CrashRecord r;
    if (ESP.rtcUserMemoryRead(RTC_OFFSET_WORDS, (uint32_t*)&r, sizeof(r)) && r.magic == CRASH_MAGIC && r.sum == checksum(r) && r.nbt <= CRASH_BT_MAX) {
        uint32_t why = ESP.getResetInfoPtr()->reason;
        if (why == REASON_WDT_RST || why == REASON_EXCEPTION_RST || why == REASON_SOFT_WDT_RST) {
            info.valid = true;
            info.cause = r.cause;
            info.epc1 = r.epc1;
            info.excvaddr = r.excvaddr;
            info.up = r.up;
            info.nbt = r.nbt;
            memcpy(info.bt, r.bt, sizeof(info.bt));
        }
    }

    // one record, one report
    uint32_t zero = 0;
    ESP.rtcUserMemoryWrite(RTC_OFFSET_WORDS, &zero, sizeof(zero));
}

const char* crashResetReason() {
    return reason;
}

const CrashInfo& crashInfo() {
    return info;
}

void crashNoteHeap(uint32_t freeHeap) {
    last_heap = freeHeap;
}

void crashJson(String& s) {
    if (!info.valid) {
        s += F("null");
        return;
    }
    char hex[16];
    s += F("{\"cause\":");
    s += info.cause;
    snprintf_P(hex, sizeof(hex), PSTR("0x%08x"), (unsigned)info.epc1);
    s += F(",\"epc1\":\"");
    s += hex;
    snprintf_P(hex, sizeof(hex), PSTR("0x%08x"), (unsigned)info.excvaddr);
    s += F("\",\"excvaddr\":\"");
    s += hex;
    s += F("\",\"up\":");
    s += info.up;
    s += F(",\"bt\":[");
    for (uint8_t i = 0; i < info.nbt; i++) {
        snprintf_P(hex, sizeof(hex), PSTR("\"0x%08x\""), (unsigned)info.bt[i]);
        if (i) s += ',';
        s += hex;
    }
    s += F("]}");
}
