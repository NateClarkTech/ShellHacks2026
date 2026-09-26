import cv2
import numpy as np

from server.vision.detect import detect_cards


def _canvas(width, height, seed=1):
    rng = np.random.default_rng(seed)
    image = np.full((height, width, 3), 32, np.uint8)
    noise = rng.integers(0, 10, image.shape, dtype=np.uint8)
    return cv2.add(image, noise)


def _paint_card(image, x, y, short, long, fill=(50, 90, 140)):
    cv2.rectangle(image, (x, y), (x + short, y + long), (18, 18, 18), 4)
    cv2.rectangle(image, (x + 6, y + 6), (x + short - 6, y + long - 6), fill, -1)
    cv2.rectangle(image, (x + 12, y + 16), (x + short - 12, y + 40), (235, 235, 235), -1)
    type_y = y + int(long * 0.58)
    cv2.line(image, (x + 12, type_y), (x + short - 12, type_y), (240, 240, 240), 3)
    rules_y = y + int(long * 0.14)
    cv2.line(image, (x + 12, rules_y), (x + short - 12, rules_y), (220, 220, 220), 2)
    rng = np.random.default_rng(x + y + 3)
    roi = image[y + 8 : y + long - 8, x + 8 : x + short - 8]
    jitter = rng.integers(0, 18, roi.shape, dtype=np.uint8)
    image[y + 8 : y + long - 8, x + 8 : x + short - 8] = cv2.add(roi, jitter)


def test_four_cards_and_a_page_sized_rectangle():
    image = _canvas(1500, 1700)
    cv2.rectangle(image, (30, 30), (1470, 1670), (70, 70, 80), 8)
    spots = [(70, 70), (420, 70), (70, 1100), (420, 1100)]
    for x, y in spots:
        _paint_card(image, x, y, 200, 280)
    # Card-shaped, but far larger than the four real cards, so the size band drops it.
    _paint_card(image, 900, 400, 420, 600, fill=(80, 60, 40))
    found = detect_cards(image)
    assert found["scene"] == "close"
    assert len(found["crops"]) == 4
    assert found["median_long"] >= 200


def test_a_quad_inside_another_card_is_dropped():
    image = _canvas(800, 900, seed=2)
    _paint_card(image, 120, 60, 400, 560)
    _paint_card(image, 200, 140, 250, 360, fill=(30, 30, 30))
    found = detect_cards(image)
    assert found["scene"] == "close"
    assert len(found["crops"]) == 1


def test_a_blank_white_rectangle_is_dropped():
    image = _canvas(900, 1000, seed=3)
    _paint_card(image, 80, 80, 220, 310)
    cv2.rectangle(image, (520, 200), (760, 540), (245, 245, 245), -1)
    found = detect_cards(image)
    assert len(found["crops"]) == 1


def test_a_rotated_card_keeps_its_title_on_a_short_edge():
    image = _canvas(1000, 1000, seed=5)
    _paint_card(image, 350, 300, 220, 310)
    center = (500, 500)
    for angle in (37, 90, 140):
        matrix = cv2.getRotationMatrix2D(center, angle, 1)
        spun = cv2.warpAffine(image, matrix, (1000, 1000), borderValue=(32, 32, 32))
        found = detect_cards(spun)
        assert found["scene"] == "close", angle
        assert len(found["crops"]) == 1, angle
        gray = cv2.cvtColor(found["crops"][0]["warp"], cv2.COLOR_BGR2GRAY)
        height = gray.shape[0]
        top = float(gray[: int(height * 0.18)].mean())
        bottom = float(gray[-int(height * 0.18) :].mean())
        middle = float(gray[int(height * 0.4) : int(height * 0.6)].mean())
        assert max(top, bottom) > middle + 8, angle


def test_small_cards_are_a_wide_scene_with_no_crops():
    image = _canvas(900, 900, seed=4)
    for x, y in ((40, 40), (250, 40), (40, 400), (250, 400)):
        _paint_card(image, x, y, 70, 100)
    found = detect_cards(image)
    assert found["scene"] == "wide"
    assert found["crops"] == []
    assert found["median_long"] < 200
