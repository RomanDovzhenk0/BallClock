#pragma once
#include "kaia.h"

// The clock's site (BallClock/web, site_page.h) at GET / and /index.html: gzip, no-cache, ETag / 304.
// Every other path keeps the Settings library's classic page (its onNotFound), e.g. /old
void siteBegin(KaiaServer& server);
