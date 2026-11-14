"""Smash Guys menu (from 'Samsh Guys Menu/') and the mood -> food recommender."""
import itertools
import random

# course: main | side | drink | dessert
# flags: chef (chef recommended / must try), new, spicy (0-2 chillies)
# allergens follow the menu's allergen page: egg, nuts, mushroom, alcohol (all burger buns contain milk)
MENU = [
    # ---- Sides & salad ----
    dict(name="Fries (Classic / Cajun)", section="Sides", course="side", price=298, veg=True,
         desc="Homemade ketchup and roasted garlic mayo", tags=["crunchy", "classic", "comfort"], allergens=["mushroom"]),
    dict(name="Onion Rings", section="Sides", course="side", price=308, veg=True,
         desc="Served with roasted garlic mayo", tags=["crunchy", "classic"], allergens=["mushroom"]),
    dict(name="Truffle Fries", section="Sides", course="side", price=378, veg=True,
         desc="Truffle mayo, parmesan, parsley", tags=["crunchy", "indulgent", "comfort"], allergens=["mushroom"]),
    dict(name="Corn Ribs", section="Sides", course="side", price=358, veg=True, chef=True,
         desc="Roasted garlic mayo, lemon wedge", tags=["crunchy", "fresh", "tangy", "light"], allergens=["mushroom"]),
    dict(name="Oyster Mushroom Karaage", section="Sides", course="side", price=388, veg=True,
         desc="Crispy fried oyster mushroom, togarashi spice, truffle mayo",
         tags=["crunchy", "adventurous", "spicy"], allergens=["mushroom"]),
    dict(name="Caesar Salad", section="Salad", course="side", price=338, veg=True,
         desc="Romaine, homemade dressing, croutons, marinated olives, sun-dried tomatoes",
         tags=["fresh", "light", "tangy"], allergens=["egg"]),
    dict(name="Gravy Fries", section="Sides", course="side", price=378, veg=False,
         desc="French gravy sauce poured over crispy fries", tags=["comfort", "warm", "hearty", "indulgent"]),
    dict(name="Buffalo Chicken Flings", section="Sides", course="side", price=398, veg=False, spicy=1,
         desc="Buffalo-sauce-dunked fried chicken, crispy onions, garlic aioli",
         tags=["spicy", "crunchy", "tangy", "hearty"], allergens=["egg"]),
    dict(name="Dino Bone Marrow", section="Sides", course="side", price=448, veg=False, new=True,
         desc="Roasted bone marrow, toasted bread, chimichurri, picked onions",
         tags=["adventurous", "indulgent", "new"], allergens=["mushroom"]),
    dict(name="Chicken Wings", section="Sides", course="side", price=418, veg=False,
         desc="Blackened BBQ / Aglio Olio Peperoncino / Chilli Honey", tags=["hearty", "crunchy", "smoky", "classic"]),
    dict(name="Caesar Salad (Chicken / Bacon)", section="Salad", course="side", price=408, veg=False,
         desc="Romaine, homemade dressing, croutons, olives, sun-dried tomatoes",
         tags=["fresh", "light", "tangy"], allergens=["egg"]),
    # ---- Mac & cheese ----
    dict(name="The Classic Mac", section="Mac & Cheese", course="main", price=410, veg=True,
         desc="Tender macaroni in saucy cheddar cheese", tags=["comfort", "cheesy", "warm", "classic"]),
    dict(name="Sun-Dried Tomato Mac", section="Mac & Cheese", course="main", price=430, veg=True,
         desc="Creamy mac & cheese with sun-dried tomato", tags=["comfort", "cheesy", "warm", "tangy"]),
    dict(name="Grilled Chicken Mac", section="Mac & Cheese", course="main", price=480, veg=False,
         desc="Creamy mac & cheese with grilled chicken", tags=["comfort", "cheesy", "warm", "hearty"]),
    dict(name="Bacon Crisp Mac", section="Mac & Cheese", course="main", price=540, veg=False,
         desc="Creamy mac & cheese with crispy bacon", tags=["comfort", "cheesy", "indulgent", "smoky"]),
    dict(name="Brisket Mac", section="Mac & Cheese", course="main", price=615, veg=False, chef=True,
         desc="Mac & cheese topped with braised brisket", tags=["comfort", "cheesy", "indulgent", "hearty", "smoky"]),
    # ---- Veggie burgers ----
    dict(name="Korean Fried Paneer", section="Veggie Burger", course="main", price=390, veg=True, chef=True, spicy=1,
         desc="Gochujang glazed fried paneer, chimichurri, slaw, lettuce, garlic mayo",
         tags=["adventurous", "crunchy", "spicy", "tangy"], allergens=["mushroom"]),
    dict(name="Louisiana", section="Veggie Burger", course="main", price=390, veg=True, spicy=1,
         desc="Crisp-fried roasted veg patty, american cheese, slaw, jalapeños, smoky chipotle mayo",
         tags=["crunchy", "spicy", "smoky", "hearty"], allergens=["nuts"]),
    dict(name="Magic Mushroom", section="Veggie Burger", course="main", price=390, veg=True,
         desc="Multigrain-crusted wild mushroom patty, smash sauce, lettuce, pickled onions",
         tags=["hearty", "classic", "comfort"], allergens=["mushroom"]),
    dict(name="Bellissimo", section="Veggie Burger", course="main", price=390, veg=True, new=True, spicy=1,
         desc="Hot-sauce-dunked fried paneer, garlic mayo, grilled onions, smoky chipotle mayo",
         tags=["spicy", "new", "adventurous", "crunchy"], allergens=["mushroom"]),
    dict(name="Cheesy Chilli Mac Burger", section="Veggie Burger", course="main", price=390, veg=True, spicy=1,
         desc="Fried mac & cheese patty, chilli sofrito, double cheese, jalapeños, chipotle mayo",
         tags=["cheesy", "comfort", "spicy", "indulgent"], allergens=[]),
    dict(name="Broccoli and Cheddar", section="Veggie Burger", course="main", price=390, veg=True,
         desc="Broccoli, cheddar & walnut patty, american cheese, jalapeños, smash sauce",
         tags=["fresh", "cheesy", "light"], allergens=["nuts", "mushroom"]),
    # ---- Fried chicken burgers ----
    dict(name="Buffalo Chicken", section="Fried Chicken Burger", course="main", price=410, veg=False, spicy=1,
         desc="Buffalo-sauce-dunked fried chicken, garlic mayo, grilled onions, smoky chipotle mayo",
         tags=["spicy", "crunchy", "tangy", "hearty"], allergens=["mushroom"]),
    dict(name="Nashville Chicken", section="Fried Chicken Burger", course="main", price=410, veg=False, spicy=2,
         desc="Nashville spiced fried chicken dipped in hot oil, chilli sofrito, pickles, garlic aioli",
         tags=["spicy", "adventurous", "crunchy", "hearty"], allergens=["egg"]),
    dict(name="Crispy French Dip", section="Fried Chicken Burger", course="main", price=430, veg=False, chef=True,
         desc="French-dip-dunked fried chicken, onions, pickles, garlic aioli, French gravy dip",
         tags=["comfort", "warm", "crunchy", "hearty"], allergens=["egg"]),
    dict(name="Chicken Caesar Burger", section="Fried Chicken Burger", course="main", price=410, veg=False,
         desc="Fried chicken, jalapeños, romaine lettuce, parmesan, caesar dressing",
         tags=["fresh", "tangy", "crunchy", "light"], allergens=["egg"]),
    # ---- Smash chicken ----
    dict(name="The SG Chicken Cheeseburger", section="Smash Chicken", course="main", price=320, veg=False, new=True,
         desc="Smash patty, double american cheese, pickles, smash sauce (single / double / triple)",
         tags=["classic", "cheesy", "new"], allergens=["mushroom"]),
    dict(name="Foster Chicken Smash", section="Smash Chicken", course="main", price=430, veg=False,
         desc="Double smash patties, american cheese, chimichurri, pickles, lettuce, smash sauce",
         tags=["classic", "tangy", "fresh"], allergens=["mushroom"]),
    dict(name="Chicken Chilli Cheese Smash", section="Smash Chicken", course="main", price=450, veg=False, spicy=1,
         desc="Double smash patties, chilli cheese sauce, american cheese, chilli sofrito",
         tags=["spicy", "cheesy", "indulgent"], allergens=["mushroom"]),
    dict(name="Truffle Chicken Smash", section="Smash Chicken", course="main", price=610, veg=False, new=True, chef=True,
         desc="Double smash patties, swiss gruyère, truffle onion jam, thyme mushrooms, garlic aioli",
         tags=["indulgent", "adventurous", "new"], allergens=["egg", "mushroom"]),
    # ---- Classic smash (buff / lamb) ----
    dict(name="The SG Cheeseburger", section="Classic Smash", course="main", price=410, veg=False, new=True,
         desc="Smash patty, double american cheese, pickles, smash sauce (buff / lamb)",
         tags=["classic", "cheesy", "hearty"], allergens=["mushroom"]),
    dict(name="OG Smash", section="Classic Smash", course="main", price=490, veg=False,
         desc="Double smash patties, double american cheese, pickles, white onions, mustard",
         tags=["classic", "hearty", "cheesy"], allergens=["mushroom"]),
    dict(name="Oklahoma Smash", section="Classic Smash", course="main", price=550, veg=False,
         desc="Double white onion smash patties, american cheese, chimichurri, pickles, lettuce",
         tags=["classic", "hearty", "fresh"], allergens=["mushroom"]),
    dict(name="Chilli Cheese Smash", section="Classic Smash", course="main", price=590, veg=False, chef=True, spicy=1,
         desc="Double smash patties, chilli cheese sauce, american cheese, chilli sofrito",
         tags=["spicy", "cheesy", "indulgent", "hearty"], allergens=["mushroom"]),
    dict(name="Bacon Chilli Cheese Smash", section="Classic Smash", course="main", price=680, veg=False, spicy=1,
         desc="Double smash patties, chilli cheese sauce, american cheese, bacon, chilli sofrito",
         tags=["spicy", "cheesy", "indulgent", "smoky"], allergens=["mushroom"]),
    # ---- Exhibition smash ----
    dict(name="8 Hr. Braised Brisket", section="Exhibition Smash", course="main", price=690, veg=False, chef=True,
         desc="Pickled-onion smash patty, BBQ braised brisket, american cheese, smash sauce",
         tags=["indulgent", "hearty", "smoky", "comfort"], allergens=["mushroom"]),
    dict(name="PB & Bacon Smash", section="Exhibition Smash", course="main", price=590, veg=False,
         desc="Smash patty, crunchy peanut butter, american cheese, streaky bacon, red paprika",
         tags=["adventurous", "indulgent", "smoky"], allergens=["nuts", "mushroom"]),
    dict(name="The Dalston Dip", section="Exhibition Smash", course="main", price=770, veg=False,
         desc="Double smash patties, double american cheese, grilled onions, served with homemade jus",
         tags=["comfort", "warm", "indulgent", "hearty"], allergens=["mushroom"]),
    dict(name="The Flintstone", section="Exhibition Smash", course="main", price=770, veg=False,
         desc="Smash patty, american cheese, streaky bacon, served with a dino bone marrow",
         tags=["adventurous", "indulgent", "hearty"], allergens=["mushroom"]),
    dict(name="Alpine Truffle Smash", section="Exhibition Smash", course="main", price=810, veg=False, new=True, chef=True,
         desc="Double smash patties, swiss gruyère, truffle onion jam, thyme mushrooms, served with jus",
         tags=["indulgent", "adventurous", "new", "warm"], allergens=["egg", "mushroom"]),
    # ---- Desserts ----
    dict(name="Deep-Fried Oreos", section="Dessert", course="dessert", price=370, veg=True,
         desc="Eggless. Whipped custard, dulce de leche", tags=["sweet", "chocolate", "indulgent", "crunchy"]),
    dict(name="Old Monk Chocolate Mousse", section="Dessert", course="dessert", price=390, veg=True, chef=True,
         desc="Eggless, contains alcohol. Whipped custard, cocoa dust",
         tags=["sweet", "chocolate", "indulgent", "comfort"], allergens=["alcohol"]),
    dict(name="Apple Crumble Cake", section="Dessert", course="dessert", price=370, veg=True,
         desc="Whipped cream, vanilla ice cream", tags=["sweet", "comfort", "warm"], allergens=["egg", "nuts"]),
    dict(name="Ice-Cream Double Scoop", section="Dessert", course="dessert", price=138, veg=True,
         desc="Vanilla / Coffee", tags=["sweet", "cold", "light", "calming", "classic"]),
    # ---- Beverages ----
    dict(name="Fresh Watermelon & Mint Juice", section="Fresh Juice", course="drink", price=230, veg=True,
         desc="Freshly pressed", tags=["refreshing", "fresh", "cold", "calming", "light"]),
    dict(name="Fresh Iced Tea (Peach / Lemon)", section="Iced Tea", course="drink", price=250, veg=True,
         desc="Brewed in-house", tags=["refreshing", "cold", "calming", "light"]),
    dict(name="Homemade Ginger Ale", section="Mocktail", course="drink", price=250, veg=True,
         desc="House-made ginger fizz", tags=["refreshing", "tangy", "fresh", "energizing"]),
    dict(name="Fresh Lime (Soda / Water)", section="Mocktail", course="drink", price=200, veg=True,
         desc="Sweet, salted or mixed", tags=["fresh", "tangy", "light", "refreshing"]),
    dict(name="Sober Picante", section="Mocktail", course="drink", price=260, veg=True, new=True, spicy=1,
         desc="A spicy, zesty mocktail", tags=["adventurous", "spicy", "tangy", "new"]),
    dict(name="Virgin Mojito", section="Mocktail", course="drink", price=240, veg=True,
         desc="Lime, mint, soda", tags=["refreshing", "cold", "fresh", "calming"]),
    dict(name="Fresh Watermelon Mojito", section="Mocktail", course="drink", price=250, veg=True,
         desc="Watermelon, lime, mint", tags=["refreshing", "cold", "fresh", "celebratory"]),
    dict(name="Virgin Piña Colada", section="Mocktail", course="drink", price=260, veg=True,
         desc="Pineapple & coconut", tags=["sweet", "cold", "celebratory", "indulgent"]),
    dict(name="French Vanilla Biscuit Shake", section="Shakes", course="drink", price=320, veg=True,
         desc="Thick vanilla biscuit shake", tags=["sweet", "comfort", "indulgent", "classic"]),
    dict(name="Strawberry Cheesecake Shake", section="Shakes", course="drink", price=320, veg=True,
         desc="Strawberry & cheesecake", tags=["sweet", "indulgent", "celebratory"]),
    dict(name="Oreo & Chocolate Shake", section="Shakes", course="drink", price=320, veg=True,
         desc="Oreo cookies & chocolate", tags=["sweet", "chocolate", "comfort", "indulgent"]),
    dict(name="Salted Pistachio Shake", section="Shakes", course="drink", price=320, veg=True, new=True,
         desc="Salted pistachio", tags=["sweet", "adventurous", "new"], allergens=["nuts"]),
    dict(name="Strawberry Kombucha", section="Kombucha", course="drink", price=260, veg=True,
         desc="By Mossant", tags=["fresh", "tangy", "light", "adventurous"]),
    dict(name="Blueberry Lemonade Kombucha", section="Kombucha", course="drink", price=260, veg=True,
         desc="By Mossant", tags=["fresh", "tangy", "light", "refreshing"]),
    dict(name="European Hot Chocolate", section="Chocolate", course="drink", price=340, veg=True,
         desc="Dark & delicious", tags=["warm", "chocolate", "comfort", "calming", "sweet"]),
    dict(name="Cold Chocolate", section="Chocolate", course="drink", price=320, veg=True,
         desc="Dark & delicious", tags=["cold", "chocolate", "sweet", "comfort"]),
    dict(name="Coke / Sprite", section="Bottled", course="drink", price=130, veg=True,
         desc="Chilled can", tags=["classic", "cold"]),
    dict(name="Americano (Hot / Iced)", section="Coffee", course="drink", price=230, veg=True,
         desc="Speciality coffee by Mannheim", tags=["caffeine", "energizing", "light"]),
    dict(name="Cappuccino (Hot / Iced)", section="Coffee", course="drink", price=255, veg=True,
         desc="Speciality coffee by Mannheim", tags=["caffeine", "energizing", "warm", "classic"]),
    dict(name="Café Latte (Hot / Iced)", section="Coffee", course="drink", price=255, veg=True,
         desc="Speciality coffee by Mannheim", tags=["caffeine", "warm", "comfort", "classic"]),
    dict(name="Mocha", section="Coffee", course="drink", price=280, veg=True,
         desc="Espresso, chocolate, milk", tags=["caffeine", "chocolate", "warm", "comfort"]),
    dict(name="Spanish Latte (Hot / Iced)", section="Coffee", course="drink", price=280, veg=True,
         desc="Espresso, milk, condensed milk", tags=["caffeine", "sweet", "energizing"]),
    dict(name="Classic Cold Coffee", section="Cold Coffee", course="drink", price=265, veg=True,
         desc="Blended cold coffee", tags=["caffeine", "cold", "energizing", "classic"]),
    dict(name="Caramel Cold Coffee", section="Cold Coffee", course="drink", price=295, veg=True,
         desc="Blended cold coffee with caramel", tags=["caffeine", "cold", "sweet", "indulgent"]),
    dict(name="Roasted Hazelnut Cold Coffee", section="Cold Coffee", course="drink", price=295, veg=True,
         desc="Blended cold coffee with hazelnut", tags=["caffeine", "cold", "sweet"]),
    dict(name="Classic Matcha", section="Matcha", course="drink", price=350, veg=True,
         desc="Ceremonial-style matcha", tags=["calming", "fresh", "warm", "light"]),
    dict(name="Iced Mango Matcha", section="Matcha", course="drink", price=350, veg=True,
         desc="Matcha over mango", tags=["calming", "refreshing", "cold", "adventurous"]),
    dict(name="Iced Summer Berry Matcha", section="Matcha", course="drink", price=350, veg=True,
         desc="Matcha with summer berries", tags=["calming", "refreshing", "cold", "fresh"]),
]

for _i, _item in enumerate(MENU):
    _item.setdefault("chef", False)
    _item.setdefault("new", False)
    _item.setdefault("spicy", 0)
    _item.setdefault("allergens", [])
    _item["id"] = _i

ADD_ONS = {
    "burrata": dict(name="Smashed Truffle Burrata", price=135, desc="Velvety truffle burrata dolloped on your burger"),
    "brisket": dict(name="BBQ Braised Brisket", price=298, desc="Slow-braised 8 hours, layered into your burger"),
    "jalapenos": dict(name="Jalapeños / Chilli sofrito", price=40, desc="Turn up the heat"),
    "egg": dict(name="Fried egg", price=65, desc="Extra comfort on top"),
}

# Each mood gets a vibe name, a line of copy, tag weights and an optional add-on
MOODS = {
    "happy": dict(
        vibe="Celebration Mode", emoji="🎉",
        line="You're glowing — let's match that energy with something worth celebrating.",
        weights=dict(indulgent=2, celebratory=2.5, chef=1.5, adventurous=1.2, new=1, sweet=1, hearty=0.8),
        addon="burrata"),
    "sad": dict(
        vibe="Comfort Mode", emoji="🫂",
        line="Rough moment? Warm, cheesy, chocolatey comfort is on the way.",
        weights=dict(comfort=3, cheesy=2, warm=1.5, chocolate=2, sweet=1.2, indulgent=1, spicy=-1.5, light=-0.5),
        addon="egg"),
    "angry": dict(
        vibe="Cool-Down Mode", emoji="🧊",
        line="Let's cool things off — icy, fresh and calming, with a satisfying crunch.",
        weights=dict(refreshing=3, cold=2, calming=2.5, crunchy=1.2, fresh=1, spicy=-2, caffeine=-2, warm=-1),
        addon=None),
    "fear": dict(
        vibe="Safe & Steady", emoji="🛟",
        line="Feeling uneasy? Familiar classics and soothing sips — no surprises.",
        weights=dict(classic=2.5, comfort=2, calming=2.5, warm=1, adventurous=-2, spicy=-2, caffeine=-1.5, new=-1),
        addon=None),
    "disgust": dict(
        vibe="Palate Reset", emoji="🌿",
        line="Something put you off? Reset with fresh, zesty and light.",
        weights=dict(fresh=3, light=2, tangy=2, refreshing=1.5, indulgent=-1.5, cheesy=-1, smoky=-0.5),
        addon=None),
    "surprise": dict(
        vibe="Adventure Mode", emoji="⚡",
        line="Up for something unexpected? Try the bold, the new and the wild.",
        weights=dict(adventurous=3, new=2.5, spicy=1, chef=1, indulgent=0.5, classic=-1.5),
        addon="brisket"),
    "neutral": dict(
        vibe="Chef's Picks", emoji="👨‍🍳",
        line="Steady and balanced — let the chef's favourites do the talking.",
        weights=dict(chef=2.5, classic=1.5, hearty=1, energizing=1, caffeine=0.8),
        addon=None),
}

COURSES = ["main", "side", "drink", "dessert"]
# How much leaving a course out of a budget combo hurts (a main is almost never dropped)
AWAY_PENALTY = 2.5  # pushes just-shown dishes down on Shuffle without hiding them
SKIP_PENALTY = {"main": 50, "side": 2.0, "drink": 2.5, "dessert": 1.5}

TAG_REASONS = {
    "comfort": "pure comfort food", "cheesy": "melty, cheesy goodness", "warm": "warm and soothing",
    "chocolate": "chocolate fixes everything", "sweet": "a sweet lift", "indulgent": "an indulgent treat",
    "refreshing": "instantly refreshing", "cold": "ice-cold to cool you down", "calming": "calming and gentle",
    "crunchy": "satisfying crunch to release tension", "fresh": "fresh and clean", "light": "light on the stomach",
    "tangy": "zesty and palate-cleansing", "classic": "a familiar classic", "adventurous": "bold and different",
    "new": "brand new on the menu", "spicy": "brings the heat", "chef": "chef recommended",
    "celebratory": "made for celebrating", "hearty": "hearty and filling", "energizing": "a little energy boost",
    "caffeine": "a caffeine pick-me-up", "smoky": "smoky and rich",
}


# Time of day nudges the picks (applied on top of the mood weights)
DAYPARTS = [
    (range(5, 12), "morning", "☀️ Morning picks", dict(caffeine=1.5, energizing=1, light=0.5, indulgent=-0.5)),
    (range(12, 17), "afternoon", "🌤️ Afternoon picks", dict(refreshing=0.8, cold=0.5, light=0.3)),
    (range(17, 22), "evening", "🌆 Dinner picks", dict(hearty=0.8, indulgent=0.4, caffeine=-1)),
]
LATE = ("late", "🌙 Late-night picks", dict(indulgent=1, sweet=0.8, comfort=0.6, caffeine=-2))


def daypart(hour):
    if hour is None:
        return None, None, {}
    for hours, key, label, weights in DAYPARTS:
        if hour in hours:
            return key, label, weights
    return LATE


def _score(item, weights, rng, lift):
    tags = set(item["tags"])
    if item["chef"]:
        tags.add("chef")
    if item["new"]:
        tags.add("new")
    score = sum(weights.get(t, 0) for t in tags) / (1 + 0.15 * len(tags))
    stats = lift.get(item["id"])
    if stats and stats["n"]:
        score += clamp(stats["avg"] / 50, -1, 1.5)  # dishes that really lifted moods rise up the list
    return score + rng.uniform(0, 0.6), tags


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _name_words(name):
    generic = {"fresh", "classic", "chicken", "smash", "shake", "burger", "cheese", "cheesy", "chilli", "fries"}
    return {w for w in name.lower().replace("(", " ").replace(")", " ").split() if len(w) > 4 and w not in generic}


def _reason(tags, weights):
    good = sorted((t for t in tags if weights.get(t, 0) > 0), key=lambda t: -weights[t])
    parts = [TAG_REASONS[t] for t in good[:2] if t in TAG_REASONS]
    return " · ".join(parts).capitalize() if parts else "A crowd favourite"


def recommend(mood, diet="any", budget=None, avoid=(), max_spice=2, seed=None, hour=None, lift=None,
              exclude=(), courses=COURSES, away=()):
    """Return a mood combo (one item per course) plus extra picks, honouring the filters.

    lift: {item_id: {"avg": mood-lift points, "n": ratings}} learned from after-meal rescans.
    away: dish ids just shown; Shuffle passes them so a different combo comes up whenever the filters allow one.
    """
    mood = mood if mood in MOODS else "neutral"
    profile = MOODS[mood]
    _, part_label, part_weights = daypart(hour)
    weights = dict(profile["weights"])
    for tag, w in part_weights.items():
        weights[tag] = weights.get(tag, 0) + 0.6 * w
    rng = random.Random(seed)
    avoid, exclude, lift, away = set(avoid), set(exclude), lift or {}, set(away)

    def allowed(item):
        if item["id"] in exclude:
            return False
        if diet == "veg" and not item["veg"]:
            return False
        if diet == "nonveg" and item["veg"] and item["course"] in ("main", "side"):
            return False
        if avoid & set(item["allergens"]):
            return False
        return item["spicy"] <= max_spice

    ranked = {c: [] for c in COURSES}
    for item in MENU:
        if allowed(item):
            score, tags = _score(item, weights, rng, lift)
            if item["id"] in away:
                score -= AWAY_PENALTY
            ranked[item["course"]].append((score, item, tags))
    for c in COURSES:
        ranked[c].sort(key=lambda t: -t[0])

    # Best-scoring combo within budget: search the top picks per course, where skipping a course costs a penalty
    best, best_score = {}, float("-inf")
    candidates = [[None] + (list(range(min(8, len(ranked[c])))) if c in courses else []) for c in COURSES]
    for choice in itertools.product(*candidates):
        price = sum(ranked[c][i][1]["price"] for c, i in zip(COURSES, choice) if i is not None)
        if budget and price > budget:
            continue
        score = sum(ranked[c][i][0] if i is not None else -SKIP_PENALTY[c] for c, i in zip(COURSES, choice))
        names = [_name_words(ranked[c][i][1]["name"]) for c, i in zip(COURSES, choice) if i is not None]
        score -= 1.5 * sum(bool(a & b) for a, b in itertools.combinations(names, 2))  # avoid Caesar + Caesar
        if score > best_score:
            best, best_score = {c: i for c, i in zip(COURSES, choice) if i is not None}, score
    combo = best
    top_score = max((e[0] for c in COURSES for e in ranked[c][:1]), default=1) or 1

    def view(entry):
        score, item, tags = entry
        stats = lift.get(item["id"])
        return {**{k: item[k] for k in ("id", "name", "section", "course", "price", "veg", "desc", "chef", "new",
                                       "spicy", "allergens")},
                "reason": _reason(tags, weights), "match": round(clamp(60 + 39 * score / top_score, 40, 99)),
                "lift": stats if stats and stats["n"] else None}

    combo_items = [view(ranked[c][i]) for c, i in combo.items()]
    picked = {it["id"] for it in combo_items}
    extras = sorted((e for c in courses for e in ranked[c][:4] if e[1]["id"] not in picked), key=lambda e: -e[0])
    addon = ADD_ONS.get(profile["addon"]) if profile["addon"] else None
    return {
        "mood": mood,
        "vibe": profile["vibe"],
        "emoji": profile["emoji"],
        "line": profile["line"],
        "daypart": part_label,
        "combo": combo_items,
        "total": sum(it["price"] for it in combo_items),
        "more": [view(e) for e in extras[:6]],
        "addon": addon,
    }


def recommend_table(moods, diet="any", avoid=(), max_spice=2, seed=None, hour=None, lift=None):
    """One main + drink per person (by their own mood, no repeated mains) plus sides and desserts to share."""
    seed = seed or 0
    people, taken = [], set()
    for i, mood in enumerate(moods):
        rec = recommend(mood, diet=diet, avoid=avoid, max_spice=max_spice, seed=seed + i, hour=hour, lift=lift,
                        exclude=taken, courses=("main", "drink"))
        taken |= {it["id"] for it in rec["combo"] if it["course"] == "main"}
        people.append({"mood": rec["mood"], "vibe": rec["vibe"], "emoji": rec["emoji"], "items": rec["combo"]})
    # The table's shared plates follow the most common mood; ties go to whoever was scanned first (as in the UI)
    group = max(dict.fromkeys(moods), key=moods.count) if moods else "neutral"
    shared_rec = recommend(group, diet=diet, avoid=avoid, max_spice=max_spice, seed=seed + 99, hour=hour, lift=lift,
                           courses=("side", "dessert"))
    plates = max(1, (len(moods) + 1) // 2)
    shared = [{**it, "qty": plates} for it in shared_rec["combo"]]
    shared_total = sum(it["price"] * it["qty"] for it in shared)
    for p in people:
        p["subtotal"] = sum(it["price"] for it in p["items"])
        p["share"] = round(p["subtotal"] + shared_total / max(1, len(people)))
    return {"group_mood": group, "group_vibe": MOODS.get(group, MOODS["neutral"])["vibe"], "people": people,
            "shared": shared, "total": sum(p["subtotal"] for p in people) + shared_total,
            "daypart": shared_rec["daypart"]}
