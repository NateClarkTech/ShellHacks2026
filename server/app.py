import json
import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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


@app.post("/api/scan")
async def scan(image: UploadFile = File(...)):
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="That image is empty.")
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="That image is larger than 20MB.")
    return await run_scan(data, image.content_type)
