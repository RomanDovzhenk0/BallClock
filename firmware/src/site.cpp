#include "site.h"

#include "log.h"
#include "site_page.h"

static KaiaServer* srv = nullptr;

static void handleSite() {
    srv->sendHeader(F("ETag"), F(SITE_PAGE_ETAG));
    srv->sendHeader(F("Cache-Control"), F("no-cache"));

    // the browser has this very page: no body.
    // The core resets collected headers with String::clear(), which keeps the old bytes:
    // c_str() of an absent header can still hold the previous request's value, so check the length.
    const String& inm = srv->header(F("If-None-Match"));
    if (inm.length() && strstr_P(inm.c_str(), PSTR(SITE_PAGE_ETAG))) {
        logHttpCode(304);
        srv->send(304);
        return;
    }

    srv->sendHeader(F("Content-Encoding"), F("gzip"));
    logHttpCode(200);
    srv->send_P(200, PSTR("text/html; charset=utf-8"), (PGM_P)site_page_gz, site_page_gz_len);
}

void siteBegin(KaiaServer& server) {
    // If-None-Match: the server collects it by default (with Authorization) from its begin()
    srv = &server;
    server.on("/", HTTP_GET, handleSite);
    server.on("/index.html", HTTP_GET, handleSite);
}
