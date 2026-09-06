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

from PySide6.QtWidgets import QApplication, QMainWindow, QFileDialog, QStatusBar, QLabel
from PySide6.QtCore import QUrl, Qt, QObject, Slot, QFile, QIODevice
from PySide6.QtGui import QIcon, QGuiApplication
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import (
    QWebEnginePage, QWebEngineProfile, QWebEngineSettings, QWebEngineDownloadRequest,
    QWebEngineScript,
)

from core import license_manager as lic

APP_DIR = os.path.dirname(os.path.abspath(__file__))
PREFERRED_PORT = 47821  # fixed so the web origin (and its localStorage) is stable


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
  window.typographus.license = {
    status: function () { return _call('licenseStatus'); },
    hwid: function () { return _call('hwid'); },
    activate: function (t) { return _call('licenseActivate', t); },
    deactivate: function () { return _call('licenseDeactivate'); }
  };
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

        self.bridge = Bridge()
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.web_page.setWebChannel(self.channel)

        self.web_page.printRequested.connect(self.export_pdf)
        self.setStatusBar(QStatusBar())
        self.statusBar().setVisible(False)
        self.view.load(QUrl(url))

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
