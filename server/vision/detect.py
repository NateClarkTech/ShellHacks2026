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
    kept = _fit_all(bgr, kept)
    kept = _drop_oversized(bgr, kept)
    kept = _expand_weak_frames(bgr, kept)
    _mark_tapped(kept)
    kept.extend(_recover_tapped(bgr, quads, kept))
    crops = []
    for quad in kept:
        crop = _describe(bgr, quad)
        if crop is None:
            continue
        crops.append(crop)
    crops.extend(_stacked_strips(bgr, kept))
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
    box = cv2.boxPoints(rect)
    pts = _long_side_vertical(box)
    return {
        "pts": pts.astype(np.float32),
        "long": float(long),
        "short": float(short),
        "angle": _long_edge_angle(box),
        "area": area,
        "tapped": False,
        "stacked": False,
    }


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


def _long_edge_angle(pts: np.ndarray) -> float:
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    best_len = -1.0
    angle = 0.0
    for index in range(4):
        start = pts[index]
        end = pts[(index + 1) % 4]
        length = _dist(start, end)
        if length > best_len:
            best_len = length
            angle = float(np.degrees(np.arctan2(end[1] - start[1], end[0] - start[0])) % 180)
    return angle


def _axis_delta(left: float, right: float) -> float:
    delta = abs(left - right) % 180
    return min(delta, 180 - delta)


def _dominant_angle(angles: list[float]) -> float:
    best = angles[0]
    best_cost = float("inf")
    for candidate in angles:
        cost = sum(_axis_delta(candidate, other) for other in angles)
        if cost < best_cost:
            best_cost = cost
            best = candidate
    return best


def _border_darkness(warp: np.ndarray) -> float:
    """Dark card border around a lighter face. A black rectangle scores low."""
    height, width = warp.shape[:2]
    margin = max(2, int(0.055 * min(height, width)))
    ring = np.concatenate([
        warp[:margin].reshape(-1, 3),
        warp[-margin:].reshape(-1, 3),
        warp[:, :margin].reshape(-1, 3),
        warp[:, -margin:].reshape(-1, 3),
    ])
    border = cv2.cvtColor(ring.reshape(-1, 1, 3), cv2.COLOR_BGR2HSV)
    border_dark = float((border[:, 0, 2] < 85).mean())
    inner = warp[height // 4 : 3 * height // 4, width // 4 : 3 * width // 4]
    if inner.size == 0:
        return border_dark
    interior = cv2.cvtColor(inner, cv2.COLOR_BGR2HSV)
    interior_dark = float((interior[:, :, 2] < 85).mean())
    return border_dark - 0.55 * interior_dark


def _inside(pts: np.ndarray, shape) -> bool:
    height, width = shape[:2]
    return bool(
        pts[:, 0].min() > 1
        and pts[:, 1].min() > 1
        and pts[:, 0].max() < width - 2
        and pts[:, 1].max() < height - 2
    )


def _scale_pts(pts: np.ndarray, scale: float) -> np.ndarray:
    center = pts.mean(axis=0)
    return (center + (pts - center) * scale).astype(np.float32)


def _fit_frame(bgr: np.ndarray, pts: np.ndarray) -> np.ndarray | None:
    """Shrink a loose box or grow an art window until it sits on the card border."""
    best_pts = None
    best_score = -1.0
    for scale in np.linspace(0.68, 1.85, 14):
        scaled = _scale_pts(pts, float(scale))
        if not _inside(scaled, bgr.shape):
            continue
        score = _border_darkness(_warp(bgr, _long_side_vertical(scaled)))
        if score > best_score:
            best_score = score
            best_pts = _long_side_vertical(scaled)
    if best_pts is None or best_score < 0.28:
        return None
    return best_pts


def _remeasure(quad: dict, pts: np.ndarray) -> dict:
    lengths = [_dist(pts[index], pts[(index + 1) % 4]) for index in range(4)]
    updated = dict(quad)
    updated["pts"] = pts.astype(np.float32)
    updated["long"] = float(max(lengths))
    updated["short"] = float(min(lengths))
    updated["angle"] = _long_edge_angle(pts)
    return updated


def _fit_all(bgr: np.ndarray, quads: list[dict]) -> list[dict]:
    fitted = []
    for quad in quads:
        pts = _fit_frame(bgr, quad["pts"])
        if pts is None:
            continue
        fitted.append(_remeasure(quad, pts))
    return _suppress(fitted)


def _photo_tapped(quad: dict) -> bool:
    """Tapped means the card lies sideways in the photo, long edge across the frame.

    The photo's own up is the reference. A graveyard full of sideways cards must
    not flip the few cards that are still standing up.
    """
    ratio = quad["short"] / max(quad["long"], 1.0)
    if ratio > 0.92:
        pts = quad["pts"]
        width = float(pts[:, 0].max() - pts[:, 0].min())
        height = float(pts[:, 1].max() - pts[:, 1].min())
        return width > height * 1.05
    # 90° is a vertical long edge (standing up). Past 45° it is closer to horizontal.
    return _axis_delta(quad["angle"], 90.0) > 45.0


def _mark_tapped(quads: list[dict]) -> None:
    for quad in quads:
        quad["tapped"] = _photo_tapped(quad)


def _drop_oversized(bgr: np.ndarray, quads: list[dict]) -> list[dict]:
    """A playmat logo can close a huge rectangle. A real card is about the median size."""
    if len(quads) < 3:
        return quads
    longs = sorted(quad["long"] for quad in quads)
    median = longs[len(longs) // 2]
    kept = []
    for quad in quads:
        if quad["long"] <= median * 1.48:
            kept.append(quad)
            continue
        score = _border_darkness(_warp(bgr, _long_side_vertical(quad["pts"])))
        if score >= 0.58:
            kept.append(quad)
    return kept


def _title_reads_across(warp: np.ndarray) -> bool:
    """A right-side-up warp has a light name band running across a short edge."""
    gray = cv2.cvtColor(warp, cv2.COLOR_BGR2GRAY)
    band = max(8, gray.shape[0] // 5)
    strips = np.concatenate([gray[:band], gray[-band:]], axis=0)
    row_std = float(strips.mean(axis=1).std())
    col_std = float(strips.mean(axis=0).std())
    return row_std > 12 and row_std > col_std * 1.35


def _expand_weak_frames(bgr: np.ndarray, quads: list[dict]) -> list[dict]:
    """An illustration window is card-shaped. Grow it until the name sits on a short edge."""
    trusted = []
    scores = []
    for quad in quads:
        warp = _warp(bgr, _long_side_vertical(quad["pts"]))
        score = _border_darkness(warp)
        scores.append(score)
        if score >= 0.62 and quad["short"] / max(quad["long"], 1) <= 0.85:
            trusted.append(quad)
    if len(trusted) < 2:
        return quads
    shorts = sorted(quad["short"] for quad in trusted)
    longs = sorted(quad["long"] for quad in trusted)
    card_w = shorts[len(shorts) // 2]
    card_h = longs[len(longs) // 2]
    updated = []
    for quad, score in zip(quads, scores):
        if score >= 0.62:
            updated.append(quad)
            continue
        grown = _grow_to_card(bgr, quad, card_w, card_h, score)
        updated.append(grown if grown is not None else quad)
    return _suppress(updated)


def _grow_to_card(bgr, quad, card_w, card_h, current: float) -> dict | None:
    center = quad["pts"].mean(axis=0)
    best = None
    best_score = current + 0.08
    for scale in (0.88, 0.96, 1.04, 1.12):
        for width, height in ((card_w * scale, card_h * scale), (card_h * scale, card_w * scale)):
            for along in (0.30, 0.38, 0.46, 0.54, 0.62):
                origin_x = float(center[0] - width * 0.5)
                origin_y = float(center[1] - height * along)
                pts = np.array([
                    [origin_x, origin_y],
                    [origin_x + width, origin_y],
                    [origin_x + width, origin_y + height],
                    [origin_x, origin_y + height],
                ], dtype=np.float32)
                if not _inside(pts, bgr.shape):
                    continue
                ordered = _long_side_vertical(pts)
                warp = _warp(bgr, ordered)
                candidate = _border_darkness(warp)
                if candidate <= best_score or not _title_reads_across(warp):
                    continue
                best_score = candidate
                grown = _remeasure(quad, ordered)
                grown["tapped"] = _photo_tapped(grown)
                grown["stacked"] = False
                best = grown
    if best is None or best_score < 0.48:
        return None
    return best


def _recover_tapped(bgr: np.ndarray, quads: list[dict], kept: list[dict]) -> list[dict]:
    """Full cards turned sideways can fall outside the upright size band."""
    upright = [quad for quad in kept if not quad["tapped"]] or kept
    if len(upright) < 2:
        return []
    longs = sorted(quad["long"] for quad in upright)
    shorts = sorted(quad["short"] for quad in upright)
    median_long = longs[len(longs) // 2]
    median_short = shorts[len(shorts) // 2]
    dominant = _dominant_angle([quad["angle"] for quad in upright])
    covered = [quad["pts"] for quad in kept]
    found = []
    for quad in quads:
        if any(quad is other or _same_quad(quad, other) for other in kept):
            continue
        if _axis_delta(quad["angle"], dominant) < 55:
            continue
        if not (median_long * 0.75 <= quad["long"] <= median_long * 1.25):
            continue
        if not (median_short * 0.7 <= quad["short"] <= median_short * 1.3):
            continue
        if quad["short"] / max(quad["long"], 1) > 0.88:
            continue
        center = tuple(quad["pts"].mean(axis=0))
        if any(cv2.pointPolygonTest(pts, center, False) >= 0 for pts in covered):
            continue
        fitted = _fit_frame(bgr, quad["pts"])
        if fitted is None:
            continue
        quad = _remeasure(quad, fitted)
        quad["tapped"] = _photo_tapped(quad)
        found.append(quad)
        covered.append(quad["pts"])
    return found


def _same_quad(left: dict, right: dict) -> bool:
    return _dist(left["pts"].mean(axis=0), right["pts"].mean(axis=0)) < 12


def _stacked_strips(bgr: np.ndarray, full_quads: list[dict]) -> list[dict]:
    """A stack shows a title line and a mana cost, not a whole card."""
    upright = [quad for quad in full_quads if not quad.get("tapped")] or full_quads
    if not upright:
        return []
    widths = sorted(quad["short"] for quad in upright)
    heights = sorted(quad["long"] for quad in upright)
    card_width = widths[len(widths) // 2]
    card_height = heights[len(heights) // 2]
    dominant = _dominant_angle([quad["angle"] for quad in upright])
    strips = _suppress(
        _strip_candidates(bgr, card_width, card_height, dominant, sideways=False)
        + _strip_candidates(bgr, card_width, card_height, dominant, sideways=True)
    )
    strips = [
        quad for quad in strips
        if not any(cv2.pointPolygonTest(other["pts"], tuple(quad["pts"].mean(axis=0)), False) >= 0 for other in full_quads)
        and _looks_like_title(_warp_strip(bgr, quad["pts"]))
    ]
    strips = _absorb_ability_rows(bgr, strips, card_width, card_height)
    promoted, strips = _promote_strips(bgr, strips, card_width, card_height)
    crops = []
    for quad in promoted:
        crop = _describe(bgr, quad)
        if crop is not None:
            crops.append(crop)
    for quad in strips:
        center = tuple(quad["pts"].mean(axis=0))
        if any(cv2.pointPolygonTest(other["pts"], center, False) >= 0 for other in full_quads):
            continue
        crop = _describe_strip(bgr, quad)
        if crop is not None:
            crops.append(crop)
    return crops


def _absorb_ability_rows(
    bgr: np.ndarray,
    strips: list[dict],
    card_width: float,
    card_height: float,
) -> list[dict]:
    """Loyalty boxes stacked inside one planeswalker are one card, not a pile of titles."""
    unused = strips[:]
    kept = []
    while unused:
        seed = unused.pop(0)
        group = [seed]
        changed = True
        while changed:
            changed = False
            rest = []
            for quad in unused:
                if any(_near_strip(quad, other, card_width, card_height) for other in group):
                    group.append(quad)
                    changed = True
                else:
                    rest.append(quad)
            unused = rest
        if len(group) >= 2:
            merged = _frame_around(bgr, group, card_width, card_height)
            if merged is not None:
                kept.append(merged)
                continue
        kept.extend(group)
    return kept


def _near_strip(left: dict, right: dict, card_width: float, card_height: float) -> bool:
    """Loyalty rows sit inside one card. Two stacked lands are farther apart."""
    delta = left["pts"].mean(axis=0) - right["pts"].mean(axis=0)
    return abs(float(delta[0])) < card_width * 0.40 and abs(float(delta[1])) < card_height * 0.28


def _frame_around(bgr: np.ndarray, group: list[dict], card_width: float, card_height: float) -> dict | None:
    points = np.concatenate([quad["pts"] for quad in group], axis=0)
    center = points.mean(axis=0)
    for scale in (0.9, 1.0, 1.15, 1.3):
        width = card_width * scale
        height = card_height * scale
        pts = np.array([
            [center[0] - width / 2, center[1] - height / 2],
            [center[0] + width / 2, center[1] - height / 2],
            [center[0] + width / 2, center[1] + height / 2],
            [center[0] - width / 2, center[1] + height / 2],
        ], dtype=np.float32)
        if not _inside(pts, bgr.shape):
            continue
        ordered = _long_side_vertical(pts)
        if _border_darkness(_warp(bgr, ordered)) >= 0.50 and _rim_step(bgr, ordered) >= 0.12:
            grown = _remeasure({"tapped": False, "stacked": False, "area": float(width * height)}, ordered)
            grown["tapped"] = _photo_tapped(grown)
            return grown
        # The card may be sideways, so try the swapped size.
        pts = np.array([
            [center[0] - height / 2, center[1] - width / 2],
            [center[0] + height / 2, center[1] - width / 2],
            [center[0] + height / 2, center[1] + width / 2],
            [center[0] - height / 2, center[1] + width / 2],
        ], dtype=np.float32)
        if not _inside(pts, bgr.shape):
            continue
        ordered = _long_side_vertical(pts)
        if _border_darkness(_warp(bgr, ordered)) >= 0.50 and _rim_step(bgr, ordered) >= 0.12:
            grown = _remeasure({"tapped": False, "stacked": False, "area": float(width * height)}, ordered)
            grown["tapped"] = _photo_tapped(grown)
            return grown
    return None


def _rim_step(bgr: np.ndarray, pts: np.ndarray) -> float:
    """Positive when the card rim is darker than the table just outside it."""
    height, width = bgr.shape[:2]
    mask = np.zeros((height, width), np.uint8)
    cv2.fillConvexPoly(mask, np.round(pts).astype(np.int32), 255)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    rim = cv2.subtract(mask, cv2.erode(mask, kernel))
    outside = cv2.subtract(cv2.dilate(mask, kernel), mask)
    if int(rim.sum()) == 0 or int(outside.sum()) == 0:
        return 0.0
    value = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 2]
    return (float(value[outside > 0].mean()) - float(value[rim > 0].mean())) / 255.0


def _promote_strips(bgr, strips, card_w, card_h):
    """A planeswalker loyalty row is the middle of one card, not a stack by itself."""
    promoted = []
    used: set[int] = set()
    for index, strip in enumerate(strips):
        if index in used:
            continue
        center = strip["pts"].mean(axis=0)
        found = _framed_card(bgr, center, card_w, card_h)
        if found is None:
            continue
        group = [index]
        for other, quad in enumerate(strips):
            if other == index or other in used:
                continue
            if cv2.pointPolygonTest(found["pts"], tuple(quad["pts"].mean(axis=0)), False) >= 0:
                group.append(other)
        promoted.append(found)
        used.update(group)
    kept = [strip for index, strip in enumerate(strips) if index not in used]
    return promoted, kept


def _framed_card(bgr, anchor, card_w, card_h) -> dict | None:
    best = None
    best_score = 0.50
    for angle in (0, -12, 12, -20, 20):
        theta = np.deg2rad(angle)
        ux, uy = float(np.cos(theta)), float(np.sin(theta))
        vx, vy = -uy, ux
        for width, height in ((card_w, card_h), (card_h, card_w)):
            for along in (0.35, 0.50, 0.65):
                shift = (along - 0.5) * height
                cx = float(anchor[0] - shift * vx)
                cy = float(anchor[1] - shift * vy)
                pts = _rotated_rect(cx, cy, width, height, ux, uy, vx, vy)
                if not _inside(pts, bgr.shape):
                    continue
                ordered = _long_side_vertical(pts)
                score = _border_darkness(_warp(bgr, ordered))
                if score <= best_score or _rim_step(bgr, ordered) < 0.12:
                    continue
                best_score = score
                grown = _remeasure(
                    {"tapped": False, "stacked": False, "area": float(width * height)},
                    ordered,
                )
                grown["tapped"] = _photo_tapped(grown)
                best = grown
    return best


def _rotated_rect(cx, cy, width, height, ux, uy, vx, vy) -> np.ndarray:
    hw, hh = width / 2, height / 2
    return np.array([
        [cx - hw * ux - hh * vx, cy - hw * uy - hh * vy],
        [cx + hw * ux - hh * vx, cy + hw * uy - hh * vy],
        [cx + hw * ux + hh * vx, cy + hw * uy + hh * vy],
        [cx - hw * ux + hh * vx, cy - hw * uy + hh * vy],
    ], dtype=np.float32)


def _strip_candidates(
    bgr: np.ndarray,
    card_width: float,
    card_height: float,
    dominant: float,
    sideways: bool,
) -> list[dict]:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 30, 100)
    edges = cv2.dilate(edges, _CLOSE)
    _thr, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    found = []
    height, width = gray.shape
    area_min = height * width * 0.0015
    for mask in (edges, otsu, 255 - otsu):
        contours, _hierarchy = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < area_min:
                continue
            quad = _strip_from_contour(contour, area, card_width, card_height, dominant, sideways)
            if quad is not None:
                found.append(quad)
    return found


def _strip_from_contour(
    contour: np.ndarray,
    area: float,
    card_width: float,
    card_height: float,
    dominant: float,
    sideways: bool,
) -> dict | None:
    rect = cv2.minAreaRect(contour)
    (rw, rh) = rect[1]
    short, long = min(rw, rh), max(rw, rh)
    if long < 28 or short < 16:
        return None
    aspect = short / long
    if not (0.10 <= aspect <= 0.55):
        return None
    box = cv2.boxPoints(rect)
    angle = _long_edge_angle(box)
    if sideways:
        # A tapped card's name runs along the side. The strip is as long as the
        # card is wide, and it points the same way as a standing card's long edge.
        if _axis_delta(angle, dominant) > 28:
            return None
        if not (card_width * 0.68 <= long <= card_width * 1.35):
            return None
        if not (card_height * 0.08 <= short <= card_height * 0.42):
            return None
    else:
        if _axis_delta(angle, dominant) < 55:
            return None
        if not (card_width * 0.72 <= long <= card_width * 1.28):
            return None
        if not (card_height * 0.10 <= short <= card_height * 0.50):
            return None
    box_area = float(rw * rh)
    if box_area <= 0 or area / box_area < 0.55:
        return None
    pts = _long_edge_on_top(box)
    return {
        "pts": pts.astype(np.float32),
        "long": float(long),
        "short": float(short),
        "angle": angle,
        "area": area,
        "tapped": False,
        "stacked": True,
    }


def _long_edge_on_top(pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    lengths = [_dist(pts[index], pts[(index + 1) % 4]) for index in range(4)]
    start = int(np.argmax(lengths))
    rolled = np.roll(pts, -start, axis=0)
    if _signed_area(rolled) < 0:
        rolled = rolled[[0, 3, 2, 1]]
    return rolled


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
        "tapped": bool(quad.get("tapped")),
        "stacked": False,
    }


def _describe_strip(bgr: np.ndarray, quad: dict) -> dict | None:
    warp = _warp_strip(bgr, quad["pts"])
    if not _looks_like_title(warp):
        return None
    flipped = cv2.rotate(warp, cv2.ROTATE_180)
    ends = []
    if not _title_is_glare(warp):
        ends.append(("top", warp))
    if not _title_is_glare(flipped):
        ends.append(("bottom", flipped))
    if not ends:
        return None
    return {
        "quad": quad["pts"].tolist(),
        "box": _normalized_box(quad["pts"], bgr.shape),
        "warp": warp,
        "ends": ends,
        "glare": False,
        "tapped": False,
        "stacked": True,
    }


def _warp_strip(bgr: np.ndarray, pts: np.ndarray) -> np.ndarray:
    width = _dist(pts[0], pts[1])
    height = _dist(pts[1], pts[2])
    dest_w = 360
    dest_h = max(40, int(dest_w * height / width)) if width else 64
    dest = np.array(
        [[0, 0], [dest_w - 1, 0], [dest_w - 1, dest_h - 1], [0, dest_h - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(pts, dest)
    return cv2.warpPerspective(bgr, matrix, (dest_w, dest_h), flags=cv2.INTER_CUBIC)


def _looks_like_title(image: np.ndarray) -> bool:
    """A name line, or a name line with mana pips on the right."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, _BLACKHAT)
    _thr, ink = cv2.threshold(hat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(ink)
    height, width = gray.shape
    glyphs = 0
    for index in range(1, count):
        _x, _y, component_w, component_h, area = stats[index]
        if area < 8:
            continue
        if 0.15 * height <= component_h <= 0.95 * height and component_w < 0.72 * width:
            glyphs += 1
    return glyphs >= 2 or _mana_pips(image) >= 1


def _mana_pips(image: np.ndarray) -> int:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    mask = ((saturation > 80) & (value > 60)).astype(np.uint8) * 255
    contours, _hierarchy = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    pips = 0
    for contour in contours:
        area = cv2.contourArea(contour)
        if not (12 <= area <= 2000):
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        circularity = 4 * np.pi * area / (perimeter * perimeter)
        if circularity >= 0.45:
            pips += 1
    return pips


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
