import hashlib
from threading import Lock


class ScanMemory:
    """Replay an identical upload without a second Azure call. Dies with the process."""

    def __init__(self):
        self._lock = Lock()
        self._sessions: dict[str, dict[str, dict]] = {}

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()

    def recall(self, session: str | None, digest: str) -> dict | None:
        if not session:
            return None
        with self._lock:
            found = self._sessions.get(session, {}).get(digest)
        return None if found is None else dict(found)

    def remember(self, session: str | None, digest: str, result: dict) -> None:
        if not session or not _cacheable(result):
            return
        with self._lock:
            self._sessions.setdefault(session, {})[digest] = dict(result)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _cacheable(result: dict) -> bool:
    text = " ".join(result.get("warnings") or []).lower()
    return not any(part in text for part in ("could not", "rate limit", "timed out", "failed"))


MEMORY = ScanMemory()
