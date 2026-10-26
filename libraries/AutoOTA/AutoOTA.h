#pragma once
#include <Arduino.h>

#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <Updater.h>
#include <WiFiClientSecure.h>
#include <WiFiClientSecureBearSSL.h>
#include <flash_hal.h>
#elif defined(ESP32)
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#endif

#if CONFIG_IDF_TARGET_ESP32
#define GOTA_PLATFORM "ESP32"
#elif CONFIG_IDF_TARGET_ESP32S2
#define GOTA_PLATFORM "ESP32-S2"
#elif CONFIG_IDF_TARGET_ESP32S3
#define GOTA_PLATFORM "ESP32-S3"
#elif CONFIG_IDF_TARGET_ESP32C3
#define GOTA_PLATFORM "ESP32-C3"
#elif CONFIG_IDF_TARGET_ESP32C6
#define GOTA_PLATFORM "ESP32-C6"
#elif CONFIG_IDF_TARGET_ESP32H2
#define GOTA_PLATFORM "ESP32-H2"
#elif defined(ESP8266)
#define GOTA_PLATFORM "ESP8266"
#else
#error "OTA platform is not supported"
#endif

#define GOTA_TIMEOUT 2500
#define GOTA_STAGE_BYTES (128 * 1024)  // BallClock: a "write" stage every so many bytes

class AutoOTA {
   public:
    AutoOTA(const char* cur_ver, const char* path, const char* host = "raw.githubusercontent.com", uint16_t port = 443) : _cur_ver(cur_ver), _path(path), _host(host), _port(port) {}

    enum class Error : uint8_t {
        None,
        Connect,
        Timeout,
        HTTP,
        NoVersion,
        NoPlatform,
        NoPath,
        NoUpdates,
        NoFile,
        OtaStart,
        OtaEnd,
        Size,  // BallClock: the bin came without a Content-Length, or shorter than it
    };

    // BallClock: the stages of updateNow() ("json", "connect", "headers", "begin", "write", "end", "restart"),
    // with the bytes written and the bytes of the bin (0 until its headers are read)
    typedef void (*StageCallback)(const char* stage, size_t done, size_t total);

    void onStage(StageCallback cb) {
        _stage_cb = cb;
    }

#if defined(ESP8266)
    // BallClock: BearSSL's last error of a failed connect (0 none, -1000 out of memory) and its text
    int sslError() {
        return _ssl_err;
    }

    const char* sslErrorText() {
        return _ssl_txt.c_str();
    }
#endif

    // текущая версия
    const char* version() {
        return _cur_ver;
    }

    // проверить обновления. Можно передать строки для записи информации
    bool checkUpdate(String* version = nullptr, String* notes = nullptr) {
        if (_has_update) return true;
#if defined(ESP8266)
        BearSSL::WiFiClientSecure client;
        client.setBufferSizes(1024, 512);
#elif defined(ESP32)
        WiFiClientSecure client;
#endif
        client.setInsecure();

        if (!_request(client, _jsonReq())) return false;

        String ver = _readKey(client, "version");
        if (!ver.length()) return _err = Error::NoVersion, false;
        if (version) *version = ver;
        if (ver == _cur_ver) return _err = Error::NoUpdates, false;
        if (notes) *notes = _readKey(client, "notes");
        _has_update = true;
        _err = Error::None;
        return true;
    }

    // есть обновление. Вызывать после проверки. Само сбросится в false
    bool hasUpdate() {
        return _has_update ? _has_update = false, true : false;
    }

    // BallClock: есть обновление, без сброса (for a state that is polled)
    bool updateAvailable() {
        return _has_update;
    }

    // обновить прошивку из loop
    void update() {
        _ota_f = true;
    }

    // обновить прошивку сейчас и перезагрузить чип
    bool updateNow() {
#if defined(ESP8266)
        BearSSL::WiFiClientSecure client;
        // BallClock: project.json fits the small buffers of checkUpdate (the handshake's records are streamed)
        client.setBufferSizes(1024, 512);
        _ssl_err = 0;
        _ssl_txt = String();
#elif defined(ESP32)
        WiFiClientSecure client;
#endif
        client.setInsecure();

        _stage("json", 0, 0);
        if (!_request(client, _jsonReq())) return _sslFailed(client), false;
        String bin;

        while (true) {
            delay(0);
            String chip = _readKey(client, "chipFamily");
            if (!chip.length()) return _err = Error::NoPlatform, false;

            if (chip != GOTA_PLATFORM) continue;

            bin = _readKey(client, "path");
            if (!bin.length()) return _err = Error::NoPath, false;

            break;
        }

        // flush
        while (client.available()) {
            delay(0);
            client.read();
        }
        client.stop();

#if defined(ESP8266)
        // BallClock: the bin comes in records of up to 16 KB: the full receive buffer
        client.setBufferSizes(16384, 512);
#endif

        // req file
        bin = ("GET ") + bin + F(" HTTP/1.1\r\n\r\n");
        _stage("connect", 0, 0);
        if (!_request(client, bin)) return _sslFailed(client), false;

        // BallClock: flash exactly the Content-Length and nothing less: a stalled or short download must not be
        // flashed (it was Update.begin(free sketch space) and Update.end(evenIfRemaining = true))
        size_t length = _length;
        if (!length) return _err = Error::Size, false;
        _stage("headers", 0, length);

        if (!_waitClient(client)) return _err = Error::NoFile, false;

        if (!Update.begin(length, U_FLASH)) {
            return _err = Error::OtaStart, false;
        }
        _stage("begin", 0, length);

        size_t done = 0, next = GOTA_STAGE_BYTES;
        while (done < length && !Update.hasError() && _waitClient(client)) {
            done += Update.write(client);
            if (done >= next) {
                _stage("write", done, length);
                next += GOTA_STAGE_BYTES;
            }
        }
        _stage("end", done, length);

        if (done != length) {
            bool flash = Update.hasError();  // before end(): it marks an empty download as an error of its own
            Update.end();                    // premature: the old firmware stays
            return _err = flash ? Error::OtaEnd : Error::Size, false;
        }
        if (!Update.end()) {
            return _err = Error::OtaEnd, false;
        }

        _stage("restart", done, length);
        ESP.restart();
        _err = Error::None;
        return true;
    }

    // тикер, вызывать в loop. Вернёт true при попытке обновления
    bool tick() {
        if (_ota_f) {
            _ota_f = false;
            updateNow();
            return true;
        }
        return false;
    }

    // есть ошибка
    bool hasError() {
        return _err != Error::None;
    }

    // прочитать ошибку
    Error getError() {
        return _err;
    }

   private:
    const char* _cur_ver;
    const char* _path;
    const char* _host;
    uint16_t _port;
    Error _err = Error::None;
    bool _has_update = false;
    bool _ota_f = false;
    size_t _length = 0;  // Content-Length of the last answer, 0 = none
    StageCallback _stage_cb = nullptr;
#if defined(ESP8266)
    int _ssl_err = 0;
    String _ssl_txt;  // on the heap, only after a failure
#endif

    void _stage(const char* stage, size_t done, size_t total) {
        if (_stage_cb) _stage_cb(stage, done, total);
    }

    // the TLS error behind a failed connect
    template <typename T>
    void _sslFailed(T& client) {
#if defined(ESP8266)
        if (_err == Error::Connect) {
            char txt[96];
            _ssl_err = client.getLastSSLError(txt, sizeof(txt));
            _ssl_txt = txt;
        }
#endif
    }

    String _jsonReq() {
        String req(F("GET /"));
        req += _path;
        req += F(" HTTP/1.1\r\nHost: ");
        req += _host;
        req += F("\r\n\r\n");
        return req;
    }

    String _readKey(Stream& stream, const String& key) {
        while (stream.available()) {
            stream.readStringUntil('"');
            String thisKey = stream.readStringUntil('"');
            if (thisKey == key) {
                stream.readStringUntil('"');
                return stream.readStringUntil('"');
            }
        }
        return String();
    }

    bool _waitClient(Client& client) {
        if (!client.connected()) return false;
        if (!client.available()) {
            uint32_t ms = millis();
            while (!client.available()) {
                delay(0);
                if (millis() - ms >= GOTA_TIMEOUT) {
                    _err = Error::Timeout;
                    return false;
                }
                if (!client.connected()) return false;
            }
        }
        return true;
    }

    bool _request(Client& client, const String& req) {
        _length = 0;
        if (!client.connected()) client.connect(_host, _port);

        if (client.connected()) {
            client.print(req);

            if (!_waitClient(client)) return false;

            client.readStringUntil(' ');  // HTTP/1.1 CODE

            if (client.parseInt() == 200) {
                // BallClock: waits for the headers that come in a later record (was: available() only)
                while (_waitClient(client)) {
                    delay(0);
                    String line = client.readStringUntil('\n');
                    if (line.length() == 1) {  // \r\n
                        return true;
                    }
                    // BallClock: the size of the body
                    if (line.length() > 15 && line.substring(0, 15).equalsIgnoreCase(F("Content-Length:"))) {
                        long n = line.substring(15).toInt();
                        _length = n > 0 ? n : 0;
                    }
                }
            }

            _err = Error::HTTP;
        } else {
            _err = Error::Connect;
        }
        return false;
    }
};