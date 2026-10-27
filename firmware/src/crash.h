#pragma once
#include <Arduino.h>

// The last crash, kept in RTC user memory (it survives the restart, not a power cut)

#define CRASH_BT_MAX 16

struct CrashInfo {
    bool valid = false;   // the run before ended in an exception, a watchdog or a panic, and left a record
    uint32_t reason = 0;  // the core's reset reason of the crash: 1 hw watchdog, 2 exception, 3 soft watchdog, 253, 254
    uint32_t cause = 0;   // exccause
    uint32_t epc1 = 0;
    uint32_t excvaddr = 0;
    uint32_t up = 0;  // uptime of the run that crashed, ms
    uint8_t nbt = 0;
    uint32_t bt[CRASH_BT_MAX];  // code addresses found on the stack
};

// read the reset reason and the record of the last crash (once, early in setup); the record is cleared
void crashBegin();

// ESP.getResetReason() of this boot
const char* crashResetReason();

const CrashInfo& crashInfo();

// the kind of the last crash: exception, hw_wdt, soft_wdt, stack (the cont stack overflowed), panic (panic, abort,
// a failed assert or new), in flash. A stack or panic crash boots as "Software/System restart"
const char* crashKind();

// the free heap of the last heap line, saved with the record
void crashNoteHeap(uint32_t freeHeap);

// null, or {"reason", "cause", "epc1", "excvaddr", "up", "bt": [...]}
void crashJson(String& s);
