"""The type recorded for an upload doesn't depend on the operating system's mime.types file."""
import mimetypes

from tracker.safety import recorded_mime


def test_recorded_types_ignore_the_systems_mime_table(monkeypatch):
    # Ubuntu's /etc/mime.types says audio/mpegurl for .m3u and macOS's says audio/x-mpegurl; plant one that
    # disagrees with everything and check nothing follows it.
    monkeypatch.setattr(mimetypes, "guess_type", lambda *a, **k: ("application/x-planted", None))
    assert recorded_mime("list.m3u", "application/octet-stream") == "audio/x-mpegurl"
    assert recorded_mime("notes.md", "application/octet-stream") == "text/markdown"
    assert recorded_mime("run.log", None) == "text/plain"
    assert recorded_mime("memo.m4a", "audio/mp4") == "audio/mp4"
    assert recorded_mime("page.html", "audio/mpeg") == "text/plain"
    assert recorded_mime("blob.unknownext", None) == "application/octet-stream"
