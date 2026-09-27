import json
import os

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from server.cards import lookup_card
from server.clarify import fetch_clarifications
from server.vision.scan import CACHE, run_scan

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
