"""Well-known sights within a day trip of Armavir.

Live place data (OpenStreetMap, Wikipedia, web search) is only looked up when the admin
names a place, and it can be unreachable from the server. Without any real place names the
language model has nothing to build a route from. This list guarantees it always has real,
visitable places with coordinates, so a route, its distance and its price can be worked out.

Coordinates are approximate (good to about a kilometre) and are used for distance only.
"""

from __future__ import annotations

from typing import Any

from agent.distance import armavir_distance_km

# name_en, name_hy, type, region_en, lat, lon, one line the copywriter can build on
_ROWS: tuple[tuple[str, str, str, str, float, float, str], ...] = (
    ("Sardarapat Memorial", "Սարդարապատի հուշահամալիր", "memorial", "Armavir", 40.093, 43.949, "Memorial to the 1918 battle with red tuff bulls, bell tower and the ethnography museum."),
    ("Metsamor Archaeological Site", "Մեծամորի հնավայր", "archaeological_site", "Armavir", 40.126, 44.187, "Bronze Age settlement with an ancient observatory and a small museum."),
    ("Etchmiadzin Cathedral", "Էջմիածնի Մայր տաճար", "cathedral", "Armavir", 40.1618, 44.2912, "Mother cathedral of the Armenian Church, founded in the 4th century."),
    ("Saint Hripsime Church", "Սուրբ Հռիփսիմե եկեղեցի", "church", "Armavir", 40.1670, 44.3096, "7th century church, a classic of early Armenian architecture."),
    ("Saint Gayane Church", "Սուրբ Գայանե եկեղեցի", "church", "Armavir", 40.1574, 44.2915, "7th century church in a quiet garden next to the cathedral."),
    ("Zvartnots Cathedral", "Զվարթնոցի տաճար", "ruins", "Armavir", 40.1597, 44.3366, "Ruins of a 7th century round cathedral with a view of Ararat."),
    ("Amberd Fortress", "Ամբերդ ամրոց", "fortress", "Aragatsotn", 40.3886, 44.2262, "Medieval fortress and church on the slope of Aragats, 2300 m up."),
    ("Saghmosavank", "Սաղմոսավանք", "monastery", "Aragatsotn", 40.3806, 44.3967, "13th century monastery on the edge of the Kasagh gorge."),
    ("Hovhannavank", "Հովհաննավանք", "monastery", "Aragatsotn", 40.3394, 44.3883, "Monastery above the Kasagh gorge, a short drive from Saghmosavank."),
    ("Armenian Alphabet Monument", "Հայոց այբուբենի հուշարձան", "monument", "Aragatsotn", 40.397, 44.385, "39 stone letters on a hillside, a favourite photo stop."),
    ("Saint Mesrop Mashtots Church, Oshakan", "Օշականի Սուրբ Մեսրոպ Մաշտոց եկեղեցի", "church", "Aragatsotn", 40.2636, 44.3156, "Burial place of the creator of the Armenian alphabet."),
    ("Byurakan Observatory", "Բյուրականի աստղադիտարան", "observatory", "Aragatsotn", 40.3306, 44.2731, "Astrophysical observatory founded by Viktor Ambartsumian; visits by arrangement."),
    ("Lake Kari", "Քարի լիճ", "lake", "Aragatsotn", 40.4733, 44.1819, "Alpine lake at 3200 m under the peaks of Aragats; road open in the warm months only."),
    ("Aruch Cathedral", "Արուճի տաճար", "church", "Aragatsotn", 40.2897, 44.0817, "Large 7th century domed hall next to caravanserai ruins."),
    ("Talin Cathedral", "Թալինի Կաթողիկե եկեղեցի", "church", "Aragatsotn", 40.384, 43.874, "7th century cathedral, partly ruined, in the town of Talin."),
    ("Dashtadem Fortress", "Դաշտադեմի ամրոց", "fortress", "Aragatsotn", 40.3367, 43.8572, "Fortress with a keep and later polygonal walls in a village setting."),
    ("Tegher Monastery", "Տեղերի վանք", "monastery", "Aragatsotn", 40.3447, 44.2392, "13th century basalt monastery in a mountain village."),
    ("Karmravor Church", "Կարմրավոր եկեղեցի", "church", "Aragatsotn", 40.2997, 44.3636, "Tiny 7th century church in Ashtarak with its original tiled roof."),
    ("Saint Gevorg Monastery of Mughni", "Մուղնու Սուրբ Գևորգ վանք", "monastery", "Aragatsotn", 40.3147, 44.3736, "17th century monastery with a striped drum, near Ashtarak."),
    ("Garni Temple", "Գառնու տաճար", "temple", "Kotayk", 40.1125, 44.7303, "1st century Hellenistic temple above the Azat gorge."),
    ("Symphony of Stones", "Քարերի սիմֆոնիա", "natural_monument", "Kotayk", 40.109, 44.736, "Basalt column cliffs in the Garni gorge, reached on foot or by local jeep."),
    ("Geghard Monastery", "Գեղարդի վանք", "monastery", "Kotayk", 40.1404, 44.8186, "Monastery partly carved into the rock, UNESCO World Heritage."),
    ("Kecharis Monastery", "Կեչառիսի վանք", "monastery", "Kotayk", 40.5336, 44.7175, "11th to 13th century monastery in the resort town of Tsaghkadzor."),
    ("Khor Virap", "Խոր Վիրապ", "monastery", "Ararat", 39.8783, 44.5761, "Monastery at the foot of Ararat with the pit of Gregory the Illuminator."),
    ("Noravank", "Նորավանք", "monastery", "Vayots Dzor", 39.6842, 45.2331, "Monastery among red cliffs at the end of a narrow gorge."),
    ("Areni-1 Cave", "Արենի-1 քարանձավ", "archaeological_site", "Vayots Dzor", 39.7314, 45.2036, "Cave where a 6000 year old winery and leather shoe were found."),
    ("Sevanavank", "Սևանավանք", "monastery", "Gegharkunik", 40.5639, 45.0108, "Two churches on the Sevan peninsula with a wide view of the lake."),
    ("Hayravank Monastery", "Հայրավանք", "monastery", "Gegharkunik", 40.4328, 45.1083, "Small monastery on a rocky cape over Lake Sevan."),
    ("Noratus Cemetery", "Նորատուսի խաչքարերի դաշտ", "cemetery", "Gegharkunik", 40.3736, 45.1819, "The largest surviving field of medieval khachkars."),
    ("Dilijan Old Town", "Դիլիջանի հին թաղամաս", "old_town", "Tavush", 40.7406, 44.8631, "Sharambeyan street with craft workshops, in a forested resort town."),
    ("Haghartsin Monastery", "Հաղարծնի վանք", "monastery", "Tavush", 40.8019, 44.8906, "Monastery deep in the forest near Dilijan."),
    ("Goshavank", "Գոշավանք", "monastery", "Tavush", 40.7297, 44.9978, "Monastery of Mkhitar Gosh with a famous lace khachkar."),
    ("Lake Parz", "Պարզ լիճ", "lake", "Tavush", 40.7522, 44.9597, "Small forest lake in Dilijan National Park with walking paths."),
    ("Haghpat Monastery", "Հաղպատի վանք", "monastery", "Lori", 41.0939, 44.7119, "10th century monastery over the Debed canyon, UNESCO World Heritage."),
    ("Sanahin Monastery", "Սանահնի վանք", "monastery", "Lori", 41.0872, 44.6664, "Monastery and medieval academy opposite Haghpat, UNESCO World Heritage."),
    ("Odzun Church", "Օձունի եկեղեցի", "church", "Lori", 41.0514, 44.6133, "6th century basilica on a plateau above the Debed canyon."),
    ("Akhtala Monastery", "Ախթալայի վանք", "monastery", "Lori", 41.1506, 44.7639, "Fortified monastery known for its well preserved frescoes."),
    ("Lori Fortress", "Լոռի բերդ", "fortress", "Lori", 41.0036, 44.4319, "Medieval fortress city between two gorges near Stepanavan."),
    ("Stepanavan Dendropark", "Ստեփանավանի դենդրոպարկ", "park", "Lori", 40.957, 44.471, "Arboretum with forest alleys, pleasant from late spring to autumn."),
    ("Vardanants Square, Gyumri", "Գյումրիի Վարդանանց հրապարակ", "square", "Shirak", 40.7856, 43.8419, "Central square of Gyumri, the start of a walk through the old Kumayri district."),
    ("Black Fortress, Gyumri", "Սև բերդ", "fortress", "Shirak", 40.7828, 43.8228, "Round 19th century fortress of black tuff above Gyumri."),
    ("Harichavank", "Հառիճավանք", "monastery", "Shirak", 40.605, 43.9992, "Monastery with a chapel standing on a split rock."),
    ("Marmashen Monastery", "Մարմաշենի վանք", "monastery", "Shirak", 40.8425, 43.7597, "10th century monastery on the bank of the Akhuryan river."),
    ("Yereruyk Basilica", "Երերույքի տաճար", "ruins", "Shirak", 40.4403, 43.6089, "Early Christian basilica ruins near the village of Anipemza."),
    ("Erebuni Fortress", "Էրեբունի ամրոց", "fortress", "Yerevan", 40.1406, 44.5378, "Urartian fortress of 782 BC with a museum, the birthplace of Yerevan."),
    ("Matenadaran", "Մատենադարան", "museum", "Yerevan", 40.1921, 44.5211, "Museum and institute of ancient manuscripts."),
)

SOURCE = "built-in list"
DAY_TRIP_LIMIT_KM = 160.0


def _row(name_en: str, name_hy: str, kind: str, region: str, lat: float, lon: float, about: str) -> dict[str, Any]:
    link = f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=15/{lat}/{lon}"
    return {
        "name_en": name_en,
        "name_hy": name_hy,
        "type": kind,
        "region_en": region,
        "lat": lat,
        "lon": lon,
        "source_url": link,
        "osm_url": link,
        "wiki_url": "",
        "description": about,
        "coord_source": SOURCE,
        "source": "gazetteer",
        "distance_from_armavir_km": armavir_distance_km(lat, lon),
    }


def all_places() -> list[dict[str, Any]]:
    """Every listed sight close enough for a same-day round trip, nearest first."""
    rows = [_row(*item) for item in _ROWS]
    rows = [row for row in rows if row["distance_from_armavir_km"] <= DAY_TRIP_LIMIT_KM]
    return sorted(rows, key=lambda row: row["distance_from_armavir_km"])


def places_for(place_en: str | None, region_en: str | None = None) -> list[dict[str, Any]]:
    """Listed sights for the place or region the admin asked for; all of them when none was named."""
    wanted = [text.strip().lower() for text in (place_en, region_en) if text and text.strip()]
    rows = all_places()
    if not wanted:
        return rows
    regions = set()
    for row in rows:
        region = row["region_en"].lower()
        name = row["name_en"].lower()
        if any(text in region or region in text or text in name for text in wanted):
            regions.add(row["region_en"])
    return [row for row in rows if row["region_en"] in regions]
