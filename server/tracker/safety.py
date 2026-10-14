"""Uploaded files are never active content on the tracker's own address.

Attachments people and agents upload are served from the same origin as the app. An HTML or SVG
file opened there would run its script as the signed-in owner, with every API at its disposal.
So every response passes through `ContentSafetyMiddleware`:

- `X-Content-Type-Options: nosniff` everywhere (no guessing a text file is HTML);
- `Content-Security-Policy: sandbox` (no scripts, a unique origin) on every response that
  isn't the app itself, plus `default-src 'none'` on anything that isn't media;
- HTML, XML and script types are served as plain text downloads; images, video, audio,
  PDF and plain text show inline; other files download;
- audio and video keep no sandbox: under the sandbox's opaque origin a player's range requests
  go cross-site without the SameSite=Strict session cookie (401), and some browsers' media
  controls are scripted, so a file opened in a tab of its own never plays. Served as
  audio/video with nosniff, the bytes can only ever play as media (playlists keep the sandbox);
- PDF keeps no sandbox: browsers' PDF viewers refuse to run under it, and a PDF's own scripts
  never get the app's origin.

The app's own page marks its responses with APP_FILE_HEADER (removed here before sending); it,
the built files under /assets/ and FastAPI's /docs pages pass untouched apart from nosniff.
"""
import mimetypes
from typing import Iterable, List, Optional, Tuple

APP_FILE_HEADER = "x-tracker-app-file"
_APP_FILE = APP_FILE_HEADER.encode()

# Shown inline as they are
INLINE_PREFIXES = ("image/", "video/", "audio/")
INLINE_TYPES = {"application/pdf", "text/plain"}
# API data, read by the app with fetch (never navigated to as files)
DATA_TYPES = {"application/json", "text/event-stream", "application/x-ndjson", "application/problem+json"}
# Would run script if a browser rendered them as documents: served as text downloads
ACTIVE_TYPES = {
    "text/html", "application/xhtml+xml", "text/xml", "application/xml", "application/rss+xml",
    "application/atom+xml", "text/javascript", "application/javascript", "application/x-javascript",
    "text/ecmascript", "application/ecmascript", "application/mathml+xml", "text/xsl", "application/xslt+xml",
    "multipart/x-mixed-replace",
}
DOCS_PATHS = {"/docs", "/redoc", "/docs/oauth2-redirect", "/openapi.json"}
# The app's built files (web/dist: its scripts and styles): never user content
APP_FILE_PREFIXES = ("/assets/",)

SANDBOX = "sandbox"
SANDBOX_STRICT = "sandbox; default-src 'none'; style-src 'unsafe-inline'"


def base_type(content_type: Optional[str]) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def is_active(content_type: Optional[str]) -> bool:
    t = base_type(content_type)
    return t in ACTIVE_TYPES or t.endswith("+xml") and not t == "image/svg+xml"


# Types guessed from a file name come from Python's built-in table plus the few below, never from the
# system's mime.types file, so the type recorded for an upload is the same on every operating system
# (macOS and Ubuntu, for example, disagree on .m3u).
_NAMES = mimetypes.MimeTypes(filenames=())
for _type, _ext in (("text/markdown", ".md"), ("text/markdown", ".markdown"), ("text/plain", ".log"),
                    ("audio/mp4", ".m4a"), ("audio/aac", ".aac"), ("audio/ogg", ".ogg"), ("audio/ogg", ".oga"),
                    ("audio/opus", ".opus"), ("audio/flac", ".flac"), ("audio/webm", ".weba"), ("video/webm", ".webm"),
                    ("video/x-matroska", ".mkv"), ("audio/x-mpegurl", ".m3u"), ("application/vnd.apple.mpegurl", ".m3u8")):
    _NAMES.add_type(_type, _ext)


def guess_type(filename: str) -> Optional[str]:
    return _NAMES.guess_type(filename)[0]


# Playlists name other addresses for the player to fetch: they keep the sandbox like any other file
PLAYLIST_TYPES = {"audio/mpegurl", "audio/x-mpegurl", "application/vnd.apple.mpegurl", "application/x-mpegurl",
                  "audio/x-scpls", "video/vnd.mpegurl"}
_MEDIA_EXTENSIONS = {"m4a", "mp3", "wav", "aac", "ogg", "oga", "opus", "flac", "caf", "aif", "aiff", "weba",
                     "mp4", "m4v", "mov", "webm", "mkv", "3gp"}


def playable(content_type: Optional[str]) -> bool:
    """Served without the sandbox: audio or video, but not a playlist."""
    t = base_type(content_type)
    return t.startswith(("audio/", "video/")) and t not in PLAYLIST_TYPES


def recorded_mime(filename: Optional[str], claimed: Optional[str]) -> str:
    """The type to record for an upload whose sender names its type (attachments). An audio or video type
    goes unsandboxed when served, so it's believed only when the file name is audio or video too (evil.html sent
    as audio/mpeg is recorded as text/plain); then the name's type; made safe either way."""
    name = filename or ""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    t = base_type(claimed)
    if t == "application/octet-stream" or (t.startswith(("audio/", "video/")) and ext not in _MEDIA_EXTENSIONS):
        t = ""  # curl's octet-stream says nothing; a media type the name doesn't back isn't believed
    return safe_mime(t or guess_type(name) or "application/octet-stream")


def safe_mime(content_type: Optional[str]) -> str:
    """The type to record for an uploaded file: active types become plain text."""
    t = base_type(content_type)
    if not t:
        return "application/octet-stream"
    return "text/plain" if is_active(t) else t


def _strip_api(path: str) -> str:
    return path[4:] if path.startswith("/api/") else path


def headers_for(content_type: Optional[str], headers: List[Tuple[bytes, bytes]]) -> List[Tuple[bytes, bytes]]:
    """A response's headers made safe (pure; see the module docstring for the rules)."""
    t = base_type(content_type)
    out = [(k, v) for k, v in headers if k.lower() not in (b"x-content-type-options", b"content-security-policy")]
    out.append((b"x-content-type-options", b"nosniff"))
    if t in DATA_TYPES or not t:
        out.append((b"content-security-policy", SANDBOX_STRICT.encode()))
        return out
    media = t.startswith(INLINE_PREFIXES)
    if t == "application/pdf" or playable(t):
        return out  # see the module docstring
    if is_active(t):
        out = [(k, v) for k, v in out if k.lower() not in (b"content-type", b"content-disposition")]
        out.append((b"content-type", b"text/plain; charset=utf-8"))
        out.append((b"content-disposition", b"attachment"))
    elif not (media or t in INLINE_TYPES):
        # Everything else downloads (keeping the file name a route already gave)
        disp = next((v for k, v in out if k.lower() == b"content-disposition"), None)
        if disp is None:
            out.append((b"content-disposition", b"attachment"))
        elif disp.lower().startswith(b"inline"):
            out = [(k, (b"attachment" + v[6:]) if k.lower() == b"content-disposition" else v) for k, v in out]
    out.append((b"content-security-policy", (SANDBOX if media else SANDBOX_STRICT).encode()))
    return out


class ContentSafetyMiddleware:
    """Applies `headers_for` to every HTTP response except the app's own files and the docs."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = _strip_api(scope.get("path") or "") if scope["type"] == "http" else ""
        if scope["type"] != "http" or path in DOCS_PATHS:
            await self.app(scope, receive, send)
            return
        app_file = path.startswith(APP_FILE_PREFIXES)

        async def wrapped(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                if message.get("status") == 304:
                    # A revalidation answer has no body, and the browser merges its headers into the copy it
                    # cached, which already carries the right ones. Starlette's 304 also drops our app-file
                    # marker, so treating it like a user file would put `sandbox` on the app's own page:
                    # every reload of a cached page would run sandboxed with no scripts, a blank screen.
                    headers = [(k, v) for k, v in headers if k.lower() != _APP_FILE]
                elif app_file or any(k.lower() == _APP_FILE for k, _ in headers):
                    headers = [(k, v) for k, v in headers if k.lower() != _APP_FILE]
                    headers = [(k, v) for k, v in headers if k.lower() != b"x-content-type-options"]
                    headers.append((b"x-content-type-options", b"nosniff"))
                else:
                    ctype = next((v.decode("latin-1") for k, v in headers if k.lower() == b"content-type"), None)
                    headers = headers_for(ctype, headers)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, wrapped)


def app_file_headers(extra: Optional[Iterable[Tuple[str, str]]] = None) -> dict:
    """Headers for a response that is part of the app itself (its page and built assets)."""
    h = {APP_FILE_HEADER: "1"}
    for k, v in extra or []:
        h[k] = v
    return h
