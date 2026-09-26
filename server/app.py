import json
import os

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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


@app.get("/api/suggest")
async def suggest(q: str = Query("")):
    return {"suggestions": await suggest_names(q)}


SEATS = {"seat1", "seat2", "seat3", "seat4"}
SCAN_ZONES = {"battlefield", "graveyard", "exile", "command"}


@app.post("/api/scan")
async def scan(
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
    if controller is None:
        return await run_scan(data, image.content_type)
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
    return await run_scan(
        data,
        image.content_type,
        controller=controller,
        zone=zone,
        session=session,
        mode=mode,
    )
