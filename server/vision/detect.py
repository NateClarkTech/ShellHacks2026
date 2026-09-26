import cv2
import numpy as np

# A sleeved Magic card is 63mm by 88mm, so the short side is 0.716 of the long side.
# Perspective and sleeves on the table photos spread that out to about 0.58–0.88.
ASPECT_MIN = 0.58
ASPECT_MAX = 0.88
# On the prepared image (longest edge 1800), a title band under this is too small to read.
MIN_LONG = 200
WARP_W = 252
WARP_H = 352
# Top 15% of an upright card is the name line.
TITLE_FRAC = 0.15

_CLOSE = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
_BLACKHAT = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))


def detect_cards(bgr: np.ndarray) -> dict:
    """Find upright card crops. A wide scene returns no crops and spends no API call."""
    if bgr is None or bgr.size == 0:
        return {"scene": "empty", "median_long": 0.0, "crops": []}
    # Drop playmat-sized boxes before containment. A huge quad would otherwise
    # swallow the real cards inside it and then be discarded by the size band.
    quads = [quad for quad in _candidates(bgr) if not _touches_border(quad["pts"], bgr.shape)]
    if not quads:
        return {"scene": "empty", "median_long": 0.0, "crops": []}
    lengths = sorted(quad["long"] for quad in quads)
    median = float(lengths[len(lengths) // 2])
    if median < MIN_LONG:
        return {"scene": "wide", "median_long": median, "crops": []}
    band_lo, band_hi = median * 0.65, median * 1.35
    kept = _suppress([quad for quad in quads if band_lo <= quad["long"] <= band_hi])
    crops = []
    for quad in kept:
        crop = _describe(bgr, quad)
        if crop is None:
            continue
        crops.append(crop)
    scene = "close" if crops else "empty"
    return {"scene": scene, "median_long": median, "crops": crops}


def _candidates(bgr: np.ndarray) -> list[dict]:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    masks = []
    for low, high in ((40, 120), (20, 80)):
        edges = cv2.Canny(blur, low, high)
        edges = cv2.dilate(edges, _CLOSE)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, _CLOSE)
        masks.append(edges)
    _thr, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    masks.append(otsu)
    masks.append(255 - otsu)
    height, width = gray.shape
    area_min = height * width * 0.004
    area_max = height * width * 0.20
    found = []
    for mask in masks:
        contours, _hierarchy = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < area_min or area > area_max:
                continue
            quad = _quad_from_contour(contour, area)
            if quad is not None:
                found.append(quad)
    return found


def _quad_from_contour(contour: np.ndarray, area: float) -> dict | None:
    rect = cv2.minAreaRect(contour)
    (rw, rh) = rect[1]
    short, long = min(rw, rh), max(rw, rh)
    if long < 40 or short < 28:
        return None
    aspect = short / long
    if not (ASPECT_MIN <= aspect <= ASPECT_MAX):
        return None
    box_area = float(rw * rh)
    if box_area <= 0 or area / box_area < 0.62:
        return None
    # minAreaRect stays a rectangle when the card is rotated. Corner-sum ordering
    # does not: past about 45° it bows the quad and drops the card.
    pts = _long_side_vertical(cv2.boxPoints(rect))
    return {"pts": pts.astype(np.float32), "long": float(long), "area": area}


def _long_side_vertical(pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    pts = pts[np.argsort(angles)]
    for index in range(4):
        rolled = np.roll(pts, -index, axis=0)
        if _dist(rolled[1], rolled[2]) + 1 < _dist(rolled[0], rolled[1]):
            continue
        if _signed_area(rolled) < 0:
            rolled = np.array([rolled[0], rolled[3], rolled[2], rolled[1]], dtype=np.float32)
        return rolled
    return pts


def _signed_area(pts: np.ndarray) -> float:
    x = pts[:, 0]
    y = pts[:, 1]
    return float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _suppress(quads: list[dict]) -> list[dict]:
    quads = sorted(quads, key=lambda quad: -quad["area"])
    kept: list[dict] = []
    for quad in quads:
        center = tuple(quad["pts"].mean(axis=0))
        if any(cv2.pointPolygonTest(other["pts"], center, False) >= 0 for other in kept):
            continue
        kept.append(quad)
    return kept


def _touches_border(pts: np.ndarray, shape) -> bool:
    height, width = shape[:2]
    xs = pts[:, 0]
    ys = pts[:, 1]
    return bool(xs.min() <= 1 or ys.min() <= 1 or xs.max() >= width - 2 or ys.max() >= height - 2)


def _describe(bgr: np.ndarray, quad: dict) -> dict | None:
    warp = _warp(bgr, quad["pts"])
    if _is_blank(warp) or _is_facedown(warp):
        return None
    # The long side is vertical, so the name is on one of the two short edges.
    # Which edge is decided after the title strips are read. A brightness or
    # edge-energy score prefers the rules text: on Three Tree City that score
    # kept the card upside down.
    ends = _title_ends(warp)
    # An empty playmat cell can pass the rectangle tests. It has no name line
    # and far less edge energy than a card whose title is merely foiled.
    if not ends:
        gray = cv2.cvtColor(warp, cv2.COLOR_BGR2GRAY)
        if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < 120:
            return None
    box = _normalized_box(quad["pts"], bgr.shape)
    return {
        "quad": quad["pts"].tolist(),
        "box": box,
        "warp": warp,
        "ends": ends,
        "glare": len(ends) == 0,
    }


def title_ends(warp: np.ndarray) -> list[tuple[str, np.ndarray]]:
    return _title_ends(warp)


def _title_ends(warp: np.ndarray) -> list[tuple[str, np.ndarray]]:
    height = max(1, int(WARP_H * TITLE_FRAC))
    top = warp[:height]
    bottom = cv2.rotate(warp, cv2.ROTATE_180)[:height]
    ends = []
    if not _title_is_glare(top):
        ends.append(("top", top))
    if not _title_is_glare(bottom):
        ends.append(("bottom", bottom))
    return ends


def _warp(bgr: np.ndarray, pts: np.ndarray) -> np.ndarray:
    dest = np.array(
        [[0, 0], [WARP_W - 1, 0], [WARP_W - 1, WARP_H - 1], [0, WARP_H - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(pts, dest)
    return cv2.warpPerspective(bgr, matrix, (WARP_W, WARP_H), flags=cv2.INTER_CUBIC)


def orient_warp(warp: np.ndarray, end: str) -> np.ndarray:
    if end == "bottom":
        return cv2.rotate(warp, cv2.ROTATE_180)
    return warp


def _title_is_glare(title: np.ndarray) -> bool:
    gray = cv2.cvtColor(title, cv2.COLOR_BGR2GRAY)
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    hat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, _BLACKHAT)
    _thr, ink = cv2.threshold(hat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(ink)
    height, width = gray.shape
    glyphs = 0
    for index in range(1, count):
        _x, _y, component_w, component_h, area = stats[index]
        if area < 8:
            continue
        if 0.35 * height <= component_h <= 0.85 * height and component_w < 0.45 * width:
            glyphs += 1
    return glyphs < 2 and variance < 350


def _is_blank(warp: np.ndarray) -> bool:
    gray = cv2.cvtColor(warp, cv2.COLOR_BGR2GRAY)
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if variance < 40:
        return True
    hsv = cv2.cvtColor(warp, cv2.COLOR_BGR2HSV)
    saturation = float(hsv[:, :, 1].mean())
    value = float(hsv[:, :, 2].mean())
    return saturation < 18 and value > 170 and variance < 80


def _is_facedown(warp: np.ndarray) -> bool:
    spun = cv2.rotate(warp, cv2.ROTATE_180)
    delta = np.abs(warp.astype(np.int16) - spun.astype(np.int16))
    return float(delta.mean()) < 18


def _normalized_box(pts: np.ndarray, shape) -> dict:
    height, width = shape[:2]
    xs = pts[:, 0]
    ys = pts[:, 1]
    left, right = float(xs.min()), float(xs.max())
    top, bottom = float(ys.min()), float(ys.max())
    return {
        "cx": ((left + right) / 2) / width,
        "cy": ((top + bottom) / 2) / height,
        "w": (right - left) / width,
        "h": (bottom - top) / height,
    }


def _dist(a, b) -> float:
    return float(np.linalg.norm(np.asarray(a) - np.asarray(b)))
