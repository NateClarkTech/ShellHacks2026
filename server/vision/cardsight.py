import asyncio
import time

TIERS = {"high": 0.95, "medium": 0.82, "low": 0.62}

# CardSight allows 4 calls per second. One 1.25s window per four cards stays under that.
SIGHT_BATCH = 4
SIGHT_BATCH_SECONDS = 1.25


def sight_seconds(count: int) -> float:
    """How long `count` CardSight calls take at 1.25 seconds per four cards."""
    if count <= 0:
        return 0.0
    batches = (count + SIGHT_BATCH - 1) // SIGHT_BATCH
    return batches * SIGHT_BATCH_SECONDS


class SightLimiter:
    """At most four CardSight calls in each 1.25 second window, shared by every scan."""

    def __init__(self, batch: int = SIGHT_BATCH, window: float = SIGHT_BATCH_SECONDS) -> None:
        self.batch = batch
        self.window = window
        self._sent = 0
        self._window_started = 0.0
        self._lock: asyncio.Lock | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _guard(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._loop is not loop:
            self._lock = asyncio.Lock()
            self._loop = loop
            self._sent = 0
            self._window_started = 0.0
        return self._lock

    async def acquire(self) -> None:
        lock = self._guard()
        while True:
            async with lock:
                now = time.monotonic()
                if self._sent == 0 or now - self._window_started >= self.window:
                    self._window_started = now
                    self._sent = 0
                if self._sent < self.batch:
                    self._sent += 1
                    return
                wait = self.window - (now - self._window_started)
            await asyncio.sleep(max(wait, 0.0))


SIGHT_LIMITER = SightLimiter()


def parse_cardsight(payload: dict) -> list[dict]:
    """CardSight detections have a tier and a name. They do not have a box."""
    found = []
    for detection in payload.get("detections") or []:
        card = detection.get("card") or {}
        name = card.get("name")
        if not name:
            continue
        tier = str(detection.get("confidence") or "").lower()
        suggestions = []
        for suggestion in card.get("suggestions") or []:
            other = suggestion.get("name") if isinstance(suggestion, dict) else None
            if other and other != name:
                suggestions.append(other)
        found.append(
            {
                "name": name,
                "confidence": TIERS.get(tier, 0.5),
                "suggestions": suggestions,
            }
        )
    return found
