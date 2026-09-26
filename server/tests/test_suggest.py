from server.vision.suggest import Suggester, entries_from, token_detail


TOKENS = [
    {"name": "Rat", "detail": "Token · 1/1 · B"},
    {"name": "Rat", "detail": "Token · 1/1 · B · Deathtouch"},
    {"name": "Rat", "detail": "Token · 1/1 · B · Lifelink"},
]


def test_token_detail_keeps_the_rules_that_tell_rats_apart():
    vanilla = token_detail({
        "name": "Rat",
        "type_line": "Token Creature — Rat",
        "power": "1",
        "toughness": "1",
        "colors": ["B"],
        "oracle_text": "",
    })
    deathtouch = token_detail({
        "name": "Rat",
        "type_line": "Token Creature — Rat",
        "power": "1",
        "toughness": "1",
        "colors": ["B"],
        "oracle_text": "Deathtouch (This creature can block and be blocked as normal.)",
    })
    assert vanilla == "Token · 1/1 · B"
    assert "Deathtouch" in deathtouch
    assert "(This creature" not in deathtouch


def test_suggest_lists_each_rat_token_and_a_misspelled_card():
    entries = entries_from(
        ["Rat", "Rat Colony", "Pack Rat", "Sol Ring", "Squirrel", "Accelerate"],
        TOKENS,
    )
    found = Suggester(entries).suggest("rat")
    details = [item["detail"] for item in found if item["name"] == "Rat"]
    assert "Token · 1/1 · B" in details
    assert "Token · 1/1 · B · Deathtouch" in details
    assert any(item["name"] == "Rat Colony" for item in found)
    assert all(item["name"] != "Accelerate" for item in found)
    assert Suggester(entries).suggest("sol rirg")[0]["name"] == "Sol Ring"
    assert Suggester(entries).suggest("r") == []


def test_deathtouch_finds_that_rat_token():
    found = Suggester(entries_from(["Rat Colony"], TOKENS)).suggest("deathtouch")
    assert found[0]["name"] == "Rat"
    assert "Deathtouch" in found[0]["detail"]
