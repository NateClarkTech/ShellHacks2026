from pathlib import Path

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import asyncio
import json
import os

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from server.cards import lookup_card
from server.clarify import fetch_clarifications
from server.vision.scan import CACHE, run_scan
from server.vision.suggest import suggest_names

app = FastAPI(title="Commander table")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    names = 0
    if CACHE.exists():
        try:
            cached = json.loads(CACHE.read_text())
            if isinstance(cached, list):
                names = len(cached)
        except (OSError, json.JSONDecodeError):
            names = 0
    return {
        "cardsight": bool(os.environ.get("CARDSIGHT_API_KEY")),
        "azure": bool(os.environ.get("AZURE_VISION_KEY") and os.environ.get("AZURE_VISION_ENDPOINT")),
        "names": names,
    }


@app.get("/api/card")
async def card(name: str = ""):
    cleaned = name.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Name the card.")
    found = await lookup_card(cleaned)
    if found is None:
        raise HTTPException(status_code=404, detail="Scryfall has no card by that name.")
    return found


@app.post("/api/clarify")
async def clarify(payload: dict = Body(...)):
    try:
        return await fetch_clarifications(payload)
    except PermissionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail="The model did not answer.") from error


@app.get("/api/suggest")
async def suggest(q: str = Query("")):
    return {"suggestions": await suggest_names(q)}


SEATS = {"seat1", "seat2", "seat3", "seat4"}
SCAN_ZONES = {"battlefield", "graveyard", "exile", "command"}


def _scan_args(
    controller: str | None,
    zone: str | None,
    session: str | None,
    mode: str | None,
) -> dict:
    if controller is None:
        return {}
    if controller not in SEATS:
        raise HTTPException(status_code=400, detail="Pick a seat before scanning.")
    if zone is None:
        zone = "battlefield"
    if zone not in SCAN_ZONES:
        raise HTTPException(status_code=400, detail="That zone cannot be scanned.")
    if mode is None:
        mode = "add"
    if mode not in {"add", "retake"}:
        raise HTTPException(status_code=400, detail="That scan mode is not supported.")
    if session is not None and len(session) > 80:
        session = session[:80]
    return {"controller": controller, "zone": zone, "session": session, "mode": mode}


async def _scan_events(data: bytes, content_type: str | None, **kwargs):
    queue: asyncio.Queue = asyncio.Queue()

    async def on_progress(event: dict) -> None:
        await queue.put(event)

    async def work() -> None:
        try:
            result = await run_scan(data, content_type, on_progress=on_progress, **kwargs)
            await queue.put({"event": "result", **result})
        except Exception:
            await queue.put({"event": "error", "detail": "The scan did not finish."})
        finally:
            await queue.put(None)

    task = asyncio.create_task(work())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield json.dumps(item) + "\n"
    finally:
        if not task.done():
            task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


@app.post("/api/scan")
async def scan(
    request: Request,
    image: UploadFile = File(...),
    controller: str | None = Form(None),
    zone: str | None = Form(None),
    session: str | None = Form(None),
    mode: str | None = Form(None),
):
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="That image is empty.")
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="That image is larger than 20MB.")
    kwargs = _scan_args(controller, zone, session, mode)
    if "application/x-ndjson" in request.headers.get("accept", ""):
        return StreamingResponse(
            _scan_events(data, image.content_type, **kwargs),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    return await run_scan(data, image.content_type, **kwargs)


DIST = Path(__file__).resolve().parent.parent / "dist"

if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(DIST / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def site(full_path: str):
        candidate = (DIST / full_path).resolve()
        root = DIST.resolve()
        if candidate.is_file() and (candidate == root or root in candidate.parents):
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
