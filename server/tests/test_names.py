from server.vision.names import NameIndex, norm_name

NAMES = [
    "Swords to Plowshares",
    "Sword of Fire and Ice",
    "Fire // Ice",
    "Island",
    "Wrath of God",
    "Damnation",
]


def test_exact_fuzzy_and_a_face():
    index = NameIndex(NAMES)
    assert norm_name("Swords to Plowshares") == "swords to plowshares"
    assert index.lookup("Swords to Plowshares")[0]["name"] == "Swords to Plowshares"
    assert index.lookup("Swords to Plowshares")[0]["confidence"] == 1
    fuzzy = index.lookup("Swrds to Plowshares")
    assert fuzzy[0]["name"] == "Swords to Plowshares"
    assert fuzzy[0]["confidence"] < 1
    assert index.lookup("Fire")[0]["name"] == "Fire // Ice"
    assert index.lookup("Fire Ice")[0]["name"] == "Fire // Ice"
    assert index.lookup("No") == []


def test_short_names_are_exact_and_a_spaced_miss_still_matches():
    index = NameIndex(["Forest", "Rat", "Rat Colony", "Sol Ring", "Flood"])
    assert index.lookup("Forest")[0]["name"] == "Forest"
    assert index.lookup("forests") == []
    assert index.lookup("Rat")[0]["name"] == "Rat"
    assert index.lookup("Ratt") == []
    assert index.lookup("sol rirg")[0]["name"] == "Sol Ring"
