"""
Typographus — desktop shell (Nexflamma).

Native Python (PySide6) application that renders the Typographus UI with the
embedded web engine, served locally and fully offline. Python provides the
native parts: frameless window chrome, license backend (HWID, offline),
print-to-PDF and file downloads (ePub / HTML). The compiled UI lives in ./webui
(no loose JS/TS sources). © 2026 Nexflamma S.r.l.
"""
import functools
import http.server
import json
import os
import shutil
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.request

from PySide6.QtWidgets import QApplication, QMainWindow, QFileDialog, QStatusBar, QLabel, QMessageBox
from PySide6.QtCore import QUrl, Qt, QObject, Slot, Signal, QFile, QIODevice
from PySide6.QtGui import QIcon, QGuiApplication, QDesktopServices
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import (
    QWebEnginePage, QWebEngineProfile, QWebEngineSettings, QWebEngineDownloadRequest,
    QWebEngineScript,
)

from core import license_manager as lic
from core import wordpress_client as wp
from core import typst_tool

APP_DIR = os.path.dirname(os.path.abspath(__file__))
PREFERRED_PORT = 47821  # fixed so the web origin (and its localStorage) is stable
APP_VERSION = "0.1.0"  # keep in sync with package.json

# Nexflamma's shared update-check convention (same pattern already used by
# Datarium/Vocius): a small static JSON published on the marketing site,
# {"version": "...", "download_url": "...", "changelog": "...", "sha256": "..."}.
# Plain HTTPS GET, no auth, no telemetry — silent on any failure.
UPDATE_URL = "https://nexflamma.net/typographus_version.json"


def _version_tuple(v):
    parts = []
    for p in str(v).strip().split("."):
        digits = "".join(ch for ch in p if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts) if parts else (0,)


def _is_newer_version(remote_version, current_version):
    return _version_tuple(remote_version) > _version_tuple(current_version)


def _fetch_remote_version_info():
    req = urllib.request.Request(UPDATE_URL, headers={"User-Agent": "Typographus/1.0 (+desktop)"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode())


def _resource(*parts):
    base = getattr(sys, "_MEIPASS", APP_DIR)
    return os.path.join(base, *parts)


def _webui_dir():
    for cand in (os.path.join(APP_DIR, "webui"), _resource("webui")):
        if os.path.exists(os.path.join(cand, "index.html")):
            return cand
    return os.path.join(APP_DIR, "webui")


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        # never let the web engine cache the local UI (so rebuilds always show)
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def start_server(directory: str) -> int:
    handler = functools.partial(_QuietHandler, directory=directory)
    httpd = None
    port = PREFERRED_PORT
    for cand in [PREFERRED_PORT] + list(range(48000, 48030)):
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", cand), handler)
            port = cand
            break
        except OSError:
            continue
    if httpd is None:
        httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
        port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return port


def _qwebchannel_js() -> str:
    f = QFile(":/qtwebchannel/qwebchannel.js")
    if f.open(QIODevice.ReadOnly):
        src = bytes(f.readAll().data()).decode("utf-8")
        f.close()
        return src
    return ""


class Bridge(QObject):
    """Native license backend exposed to the UI as window.typographus.license."""

    def __init__(self, win: "MainWindow"):
        super().__init__(win)
        self._win = win

    @Slot()
    def checkForUpdates(self):
        self._win.check_for_updates(silent=False)

    @Slot(result=str)
    def licenseStatus(self):
        return json.dumps(lic.status())

    @Slot(str, result=str)
    def licenseActivate(self, token):
        return json.dumps(lic.activate(token))

    @Slot(result=str)
    def licenseDeactivate(self):
        lic.remove_token()
        return json.dumps(lic.status())

    @Slot(result=str)
    def hwid(self):
        return json.dumps(lic.get_hwid())

    # ---- WordPress publish connector ----
    @Slot(result=str)
    def wpHasCredentials(self):
        return json.dumps({"has": wp.has_credentials()})

    @Slot(str, str, str, result=str)
    def wpSaveCredentials(self, site_url, username, app_password):
        return json.dumps({"ok": wp.save_credentials(site_url, username, app_password)})

    @Slot(result=str)
    def wpRemoveCredentials(self):
        wp.remove_credentials()
        return json.dumps({"ok": True})

    @Slot(result=str)
    def wpCheckSite(self):
        return json.dumps(wp.check_site())

    @Slot(str, str, str, result=str)
    def wpPublish(self, title, html, status):
        return json.dumps(wp.publish(title, html, status))

    # ---- Typst compiler (downloaded on demand, see core/typst_tool.py) ----
    @Slot(result=str)
    def typstStatus(self):
        return json.dumps(typst_tool.status())

    @Slot(result=str)
    def typstDownload(self):
        return json.dumps(typst_tool.download())

    @Slot(str, result=str)
    def typstCompile(self, typ_source):
        return json.dumps(typst_tool.compile_source(typ_source))


# Injected before the UI loads: window.typographus (window controls via a
# custom "typoctl://" navigation, + license over QWebChannel).
BRIDGE_JS = r"""
(function () {
  function nav(cmd) { try { window.location.href = 'typoctl://' + cmd; } catch (e) {} }
  window.typographus = {
    platform: 'qt',
    minimize: function () { nav('minimize'); },
    toggleMaximize: function () { nav('maximize'); },
    close: function () { nav('close'); }
  };
  var INTERACTIVE = 'button, input, a, select, textarea, .segmented, .doc-title, .win-ctrls, .tb-menu';
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var tb = e.target.closest && e.target.closest('.titlebar');
    if (tb && !e.target.closest(INTERACTIVE)) nav('drag');
  });
  document.addEventListener('dblclick', function (e) {
    var tb = e.target.closest && e.target.closest('.titlebar');
    if (tb && !e.target.closest(INTERACTIVE)) nav('maximize');
  });
  function addResizers() {
    if (document.getElementById('__rz') || !document.body) return;
    var host = document.createElement('div'); host.id = '__rz';
    [['top:0;left:10px;right:10px;height:4px;cursor:ns-resize','top'],
     ['bottom:0;left:10px;right:10px;height:4px;cursor:ns-resize','bottom'],
     ['top:10px;bottom:10px;left:0;width:4px;cursor:ew-resize','left'],
     ['top:10px;bottom:10px;right:0;width:4px;cursor:ew-resize','right'],
     ['top:0;left:0;width:12px;height:12px;cursor:nwse-resize','topleft'],
     ['top:0;right:0;width:12px;height:12px;cursor:nesw-resize','topright'],
     ['bottom:0;left:0;width:12px;height:12px;cursor:nesw-resize','bottomleft'],
     ['bottom:0;right:0;width:12px;height:12px;cursor:nwse-resize','bottomright']
    ].forEach(function (d) {
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;z-index:2147483647;' + d[0];
      el.addEventListener('mousedown', function (ev) { ev.preventDefault(); nav('resize/' + d[1]); });
      host.appendChild(el);
    });
    document.body.appendChild(host);
  }
  if (document.readyState !== 'loading') addResizers();
  else document.addEventListener('DOMContentLoaded', addResizers);

  // license over QWebChannel (qwebchannel.js injected first)
  var _bridge = null, _q = [];
  function _ready(fn) { _bridge ? fn() : _q.push(fn); }
  try {
    if (typeof QWebChannel !== 'undefined' && typeof qt !== 'undefined') {
      new QWebChannel(qt.webChannelTransport, function (ch) {
        _bridge = ch.objects.bridge; _q.forEach(function (f) { f(); }); _q = [];
      });
    }
  } catch (e) {}
  function _call(name, arg) {
    return new Promise(function (resolve) {
      _ready(function () {
        var cb = function (r) { try { resolve(JSON.parse(r)); } catch (e) { resolve(r); } };
        (arg === undefined) ? _bridge[name](cb) : _bridge[name](arg, cb);
      });
    });
  }
  function _callN(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve) {
      _ready(function () {
        var cb = function (r) { try { resolve(JSON.parse(r)); } catch (e) { resolve(r); } };
        _bridge[name].apply(_bridge, args.concat([cb]));
      });
    });
  }
  window.typographus.typst = {
    status: function () { return _call('typstStatus'); },
    download: function () { return _call('typstDownload'); },
    compile: function (src) { return _call('typstCompile', src); }
  };
  window.typographus.wordpress = {
    hasCredentials: function () { return _call('wpHasCredentials'); },
    saveCredentials: function (site, user, pw) { return _callN('wpSaveCredentials', site, user, pw); },
    removeCredentials: function () { return _call('wpRemoveCredentials'); },
    checkSite: function () { return _call('wpCheckSite'); },
    publish: function (title, html, status) { return _callN('wpPublish', title, html, status); }
  };
  window.typographus.license = {
    status: function () { return _call('licenseStatus'); },
    hwid: function () { return _call('hwid'); },
    activate: function (t) { return _call('licenseActivate', t); },
    deactivate: function () { return _call('licenseDeactivate'); }
  };
  window.typographus.checkForUpdates = function () { _ready(function () { _bridge.checkForUpdates(); }); };
})();
"""


class NativePage(QWebEnginePage):
    def __init__(self, profile, win):
        super().__init__(profile, win)
        self._win = win

    def acceptNavigationRequest(self, url, nav_type, is_main_frame):
        if url.scheme() == "typoctl":
            self._win.handle_native(url.toString()[len("typoctl://"):].strip("/"))
            return False
        return super().acceptNavigationRequest(url, nav_type, is_main_frame)


class MainWindow(QMainWindow):
    _updateChecked = Signal(object, str, bool)  # (info-dict-or-None, error, silent)

    def __init__(self, url: str):
        super().__init__()
        self.setWindowTitle("Typographus — Editorial & Typesetting Engine")
        self.setWindowFlag(Qt.FramelessWindowHint, True)
        # Fit to the available screen so the window is never larger than the display.
        avail = QGuiApplication.primaryScreen().availableGeometry()
        self.setMinimumSize(min(960, avail.width() - 20), min(600, avail.height() - 20))
        w = min(1200, int(avail.width() * 0.85))
        h = min(780, int(avail.height() * 0.85))
        self.resize(w, h)
        self.move(avail.center().x() - w // 2, avail.center().y() - h // 2)
        ico = _resource("icon.ico")
        if os.path.exists(ico):
            self.setWindowIcon(QIcon(ico))

        cache_dir = os.path.join(lic.license_dir(), "web-cache")
        shutil.rmtree(cache_dir, ignore_errors=True)  # flush any stale UI cache
        self.profile = QWebEngineProfile("Typographus", self)
        self.profile.setPersistentStoragePath(os.path.join(lic.license_dir(), "web"))
        self.profile.setCachePath(cache_dir)
        self.profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.NoCache)
        self.profile.downloadRequested.connect(self.on_download)

        qwc = _qwebchannel_js()
        if qwc:
            s0 = QWebEngineScript()
            s0.setName("qwebchannel")
            s0.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
            s0.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
            s0.setSourceCode(qwc)
            self.profile.scripts().insert(s0)
        s1 = QWebEngineScript()
        s1.setName("typo-bridge")
        s1.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
        s1.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        s1.setRunsOnSubFrames(False)
        s1.setSourceCode(BRIDGE_JS)
        self.profile.scripts().insert(s1)

        self.view = QWebEngineView()
        self.web_page = NativePage(self.profile, self)
        self.view.setPage(self.web_page)
        self.setCentralWidget(self.view)
        self.view.settings().setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)

        self.bridge = Bridge(self)
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.web_page.setWebChannel(self.channel)

        self.web_page.printRequested.connect(self.export_pdf)
        self.setStatusBar(QStatusBar())
        self.statusBar().setVisible(False)
        self.view.load(QUrl(url))

        self._updateChecked.connect(self._on_update_checked)
        self.check_for_updates(silent=True)  # quiet check at startup, no popup if offline/up to date

    def check_for_updates(self, silent: bool):
        """Query Nexflamma's shared update endpoint (see UPDATE_URL) on a
        background thread; the result comes back on the Qt main thread via
        the _updateChecked signal so it's safe to show a dialog from it."""
        def worker():
            try:
                info = _fetch_remote_version_info()
                self._updateChecked.emit(info, "", silent)
            except Exception as e:
                self._updateChecked.emit(None, str(e), silent)
        threading.Thread(target=worker, daemon=True).start()

    def _on_update_checked(self, info, error, silent):
        if error:
            if not silent:
                QMessageBox.warning(self, "Aggiornamenti", f"Impossibile verificare gli aggiornamenti: {error}")
            return
        remote_version = (info or {}).get("version", APP_VERSION)
        if not _is_newer_version(remote_version, APP_VERSION):
            if not silent:
                QMessageBox.information(self, "Aggiornamenti",
                                         f"Il software è aggiornato alla versione più recente (v{APP_VERSION}).")
            return
        changelog = info.get("changelog", "Miglioramenti generali.")
        sha256 = info.get("sha256", "")
        msg = f"Una nuova versione di Typographus è disponibile: v{remote_version}!\n\nChangelog:\n{changelog}"
        if sha256:
            msg += f"\n\nSHA-256 dell'installer (verifica dopo il download):\n{sha256}"
        msg += "\n\nVuoi scaricarla ora?"
        box = QMessageBox(QMessageBox.Icon.Information, "Nuovo aggiornamento disponibile", msg,
                           QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No, self)
        if box.exec() == QMessageBox.StandardButton.Yes:
            download_url = info.get("download_url", "")
            if download_url:
                QDesktopServices.openUrl(QUrl(download_url))

    def handle_native(self, cmd: str):
        wh = self.windowHandle()
        if cmd == "minimize":
            self.showMinimized()
        elif cmd == "maximize":
            self.showNormal() if self.isMaximized() else self.showMaximized()
        elif cmd == "close":
            self.close()
        elif cmd == "drag":
            if wh and not self.isMaximized():
                wh.startSystemMove()
        elif cmd.startswith("resize/") and wh and not self.isMaximized():
            E = Qt.Edge
            emap = {
                "top": E.TopEdge, "bottom": E.BottomEdge, "left": E.LeftEdge, "right": E.RightEdge,
                "topleft": E.TopEdge | E.LeftEdge, "topright": E.TopEdge | E.RightEdge,
                "bottomleft": E.BottomEdge | E.LeftEdge, "bottomright": E.BottomEdge | E.RightEdge,
            }
            edge = cmd.split("/", 1)[1]
            if edge in emap:
                wh.startSystemResize(emap[edge])

    def on_download(self, item: QWebEngineDownloadRequest):
        suggested = item.downloadFileName() or "documento"
        path, _ = QFileDialog.getSaveFileName(self, "Salva file", os.path.join(os.path.expanduser("~"), suggested))
        if not path:
            item.cancel()
            return
        item.setDownloadDirectory(os.path.dirname(path))
        item.setDownloadFileName(os.path.basename(path))
        item.accept()

    def export_pdf(self):
        path, _ = QFileDialog.getSaveFileName(self, "Esporta PDF di stampa",
                                              os.path.join(os.path.expanduser("~"), "Typographus.pdf"), "PDF (*.pdf)")
        if path:
            self.web_page.printToPdf(path)


def main():
    if hasattr(Qt, "AA_EnableHighDpiScaling"):
        QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    app = QApplication(sys.argv)
    app.setApplicationName("Typographus")
    app.setOrganizationName("Nexflamma")

    webui = _webui_dir()
    if not os.path.exists(os.path.join(webui, "index.html")):
        lbl = QLabel("Build UI mancante (cartella webui/).")
        lbl.show()
        sys.exit(1)

    port = start_server(webui)
    win = MainWindow(f"http://127.0.0.1:{port}/index.html?v={int(time.time())}")
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
