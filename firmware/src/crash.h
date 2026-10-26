#pragma once
#include <Arduino.h>

// The last crash, kept in RTC user memory (it survives the restart, not a power cut)

#define CRASH_BT_MAX 16

struct CrashInfo {
    bool valid = false;  // the run before ended in an exception or a watchdog, and left a record
    uint32_t cause = 0;  // exccause
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

// the free heap of the last heap line, saved with the record
void crashNoteHeap(uint32_t freeHeap);

// null, or {"cause", "epc1", "excvaddr", "up", "bt": [...]}
void crashJson(String& s);
