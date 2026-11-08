import json, os, sys
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from tex import *
from kostueme import KOSTUEME
from modelle import KOPF3D, HAND3D, DEKO3D
from fluegel import FLUEGEL

PACK = sys.argv[1]  # .../quelle
NS = os.path.join(PACK, 'assets/turkac')
OUT_PREV = '/home/claude/rp/vorschau'
os.makedirs(OUT_PREV, exist_ok=True)


def crop_face(img, part, face):
    u, v, w, h = faces(part)[face]
    return img.crop((u * S, v * S, (u + w) * S, (v + h) * S))


def ansicht(hum, leg, seite='front'):
    """Flache Ansicht der Figur (Vorder- oder Rückseite)."""
    bild = Image.new('RGBA', (16 * S, 32 * S), (0, 0, 0, 0))
    pos = {'head': (4, 0), 'body': (4, 8), 'armR': (0, 8), 'armL': (12, 8), 'legR': (4, 20), 'legL': (8, 20)}
    for layer in (leg, hum):
        for key, (x, y) in pos.items():
            part = {'armR': 'arm', 'armL': 'arm', 'legR': 'leg', 'legL': 'leg'}.get(key, key)
            if layer is leg and part in ('head', 'arm'): continue
            f = crop_face(layer, part, seite)
            if key in ('armL', 'legL'): f = f.transpose(Image.FLIP_LEFT_RIGHT)
            bild.alpha_composite(f, (x * S, y * S))
    return bild


def umriss(icon):
    """Dunkler 1-px-Rand um ein 16x16-Icon."""
    out = Image.new('RGBA', icon.size, (0, 0, 0, 0)); p = icon.load(); o = out.load()
    for y in range(16):
        for x in range(16):
            if p[x, y][3] > 0: continue
            if any(0 <= x + dx < 16 and 0 <= y + dy < 16 and p[x + dx, y + dy][3] > 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                o[x, y] = (20, 20, 22, 255)
    out.alpha_composite(icon); return out


def klein(img, box, ziel):
    """Ausschnitt verkleinern (16x16), Alpha hart."""
    c = img.crop(box)
    w, h = c.size; f = min(ziel[0] / w, ziel[1] / h)
    c = c.resize((max(1, round(w * f)), max(1, round(h * f))), Image.BOX)
    px = c.load()
    for y in range(c.size[1]):
        for x in range(c.size[0]):
            r, g, b, a = px[x, y]; px[x, y] = (r, g, b, 255 if a > 110 else 0)
    icon = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    icon.alpha_composite(c, ((16 - c.size[0]) // 2, (16 - c.size[1]) // 2))
    return umriss(icon)


def icons(hum, leg):
    v = ansicht(hum, leg)
    ohne_kopf = ansicht(hum, Image.new('RGBA', hum.size))
    helm = klein(v, (4 * S, 0, 12 * S, 8 * S), (14, 14))
    jacke = klein(ohne_kopf, (0, 8 * S, 16 * S, 20 * S), (15, 13))
    nur_hose = ansicht(Image.new('RGBA', hum.size), leg)
    hose = klein(nur_hose, (4 * S, 15 * S, 12 * S, 32 * S), (10, 15))
    schuh = Image.new('RGBA', hum.size); schuh.alpha_composite(hum); sp = schuh.load()
    nur_schuh = Image.new('RGBA', hum.size)
    u, v0, w, h = 0, 16, 16, 16  # Bein-Bereich
    nur_schuh.paste(hum.crop((0, 16 * S, 16 * S, 32 * S)), (0, 16 * S))
    sv = ansicht(nur_schuh, Image.new('RGBA', hum.size))
    schuhe = klein(sv, (3 * S, 27 * S, 13 * S, 32 * S), (15, 9))
    return helm, jacke, hose, schuhe


def hut_icon(hum):
    oben = crop_face(hum, 'head', 'top').resize((14, 6), Image.BOX)
    vorne = crop_face(hum, 'head', 'front').resize((14, 9), Image.BOX)
    bild = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    bild.alpha_composite(vorne, (1, 6)); bild.alpha_composite(oben, (1, 1))
    px = bild.load()
    for y in range(16):
        for x in range(16):
            r, g, b, a = px[x, y]; px[x, y] = (r, g, b, 255 if a > 110 else 0)
    # leere Zeilen oben/unten wegschneiden und mittig setzen
    box = bild.getbbox()
    if box:
        c = bild.crop(box); bild = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); bild.alpha_composite(c, ((16 - c.size[0]) // 2, (16 - c.size[1]) // 2))
    return umriss(bild)


def json_schreiben(pfad, daten):
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    with open(pfad, 'w') as f: json.dump(daten, f, indent=2)


def item(name):
    json_schreiben(f'{NS}/items/{name}.json', {"model": {"type": "minecraft:model", "model": f"turkac:item/{name}"}})
    json_schreiben(f'{NS}/models/item/{name}.json', {"parent": "minecraft:item/generated", "textures": {"layer0": f"turkac:item/{name}"}})


def ausruestung(asset, hum, leg=None):
    os.makedirs(f'{NS}/textures/entity/equipment/humanoid', exist_ok=True)
    hum.save(f'{NS}/textures/entity/equipment/humanoid/{asset}.png')
    layers = {"humanoid": [{"texture": f"turkac:{asset}"}]}
    if leg is not None:
        os.makedirs(f'{NS}/textures/entity/equipment/humanoid_leggings', exist_ok=True)
        leg.save(f'{NS}/textures/entity/equipment/humanoid_leggings/{asset}.png')
        layers["humanoid_leggings"] = [{"texture": f"turkac:{asset}"}]
    json_schreiben(f'{NS}/equipment/{asset}.json', {"layers": layers})


def icon_speichern(name, img):
    os.makedirs(f'{NS}/textures/item', exist_ok=True)
    img.save(f'{NS}/textures/item/{name}.png'); item(name)


ergebnis = {}
vorschau = []

# Outfits
basis_h = Image.open(f'{NS}/textures/entity/equipment/humanoid/anzug.png').convert('RGBA')
basis_l = Image.open(f'{NS}/textures/entity/equipment/humanoid_leggings/anzug.png').convert('RGBA')
alle = dict(OUTFITS); alle.update(KOSTUEME); alle['anzug_klassisch'] = lambda: klassisch(basis_h, basis_l)
for name, fn in alle.items():
    hum, leg = fn()
    asset = f'kl_{name}'
    ausruestung(asset, hum, leg)
    teile = dict(zip(('kopf', 'oberteil', 'hose', 'schuhe'), icons(hum, leg)))
    for teil, ic in teile.items(): icon_speichern(f'{asset}_{teil}', ic)
    ergebnis[name] = asset
    vorschau.append((name, ansicht(hum, leg), ansicht(hum, leg, 'back'), list(teile.values())))

# Kopfbedeckungen
for name, fn in KOPF.items():
    if name in KOPF3D: continue
    hum = kopf(fn); asset = f'kl_{name}'
    ausruestung(asset, hum)
    ic = hut_icon(hum)
    icon_speichern(asset, ic)
    ergebnis[name] = asset
    vorschau.append((name, ansicht(hum, Image.new('RGBA', hum.size)), ansicht(hum, Image.new('RGBA', hum.size), 'back'), [ic]))

# 3D-Modelle
for gruppe in (KOPF3D, HAND3D, DEKO3D):
    for name, fn in gruppe.items():
        m = fn(); asset = f'kl_{name}'
        json_schreiben(f'{NS}/items/{asset}.json', {"model": {"type": "minecraft:model", "model": f"turkac:item/{asset}"}})
        json_schreiben(f'{NS}/models/item/{asset}.json', m.json(asset))
        os.makedirs(f'{NS}/textures/item', exist_ok=True); m.textur().save(f'{NS}/textures/item/{asset}.png')
        ergebnis[name] = asset

# Rücken-Teile (Elytra-Form)
for name, fn in FLUEGEL.items():
    img = fn(); asset = f'kl_{name}'
    os.makedirs(f'{NS}/textures/entity/equipment/wings', exist_ok=True); img.save(f'{NS}/textures/entity/equipment/wings/{asset}.png')
    json_schreiben(f'{NS}/equipment/{asset}.json', {"layers": {"wings": [{"texture": f"turkac:{asset}"}]}})
    vorne = img.crop((24 * 2, 2 * 2, 34 * 2, 22 * 2))
    ic = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); kl = vorne.resize((6, 12), Image.BOX)
    ic.alpha_composite(kl, (2, 2)); ic.alpha_composite(kl.transpose(Image.FLIP_LEFT_RIGHT), (8, 2))
    icon_speichern(asset, umriss(ic))
    ergebnis[name] = asset

# Vorschaubild
skin = Image.new('RGBA', (16 * S, 32 * S), (0, 0, 0, 0)); d = ImageDraw.Draw(skin)
d.rectangle((4 * S, 0, 12 * S - 1, 8 * S - 1), fill=(198, 150, 120)); d.rectangle((4 * S, 8 * S, 12 * S - 1, 20 * S - 1), fill=(60, 160, 170))
d.rectangle((0, 8 * S, 4 * S - 1, 20 * S - 1), fill=(198, 150, 120)); d.rectangle((12 * S, 8 * S, 16 * S - 1, 20 * S - 1), fill=(198, 150, 120))
d.rectangle((4 * S, 20 * S, 12 * S - 1, 32 * S - 1), fill=(60, 60, 140))
d.rectangle((6 * S, 3 * S, 7 * S - 1, 4 * S - 1), fill=(40, 40, 60)); d.rectangle((9 * S, 3 * S, 10 * S - 1, 4 * S - 1), fill=(40, 40, 60))
spalten = 6; zw = 16 * S * 2 + 40
reihen = (len(vorschau) + spalten - 1) // spalten
blatt = Image.new('RGBA', (spalten * zw, reihen * (32 * S + 60)), (52, 54, 60, 255))
dd = ImageDraw.Draw(blatt)
for i, (name, vorne, hinten, ics) in enumerate(vorschau):
    x, y = (i % spalten) * zw, (i // spalten) * (32 * S + 60)
    for j, a in enumerate((vorne, hinten)):
        s = skin.copy(); s.alpha_composite(a); blatt.alpha_composite(s, (x + 10 + j * (16 * S + 10), y + 8))
    for k, ic in enumerate(ics): blatt.alpha_composite(ic.resize((32, 32), Image.NEAREST), (x + 10 + k * 36, y + 32 * S + 14))
    dd.text((x + 10, y + 32 * S + 48), name, fill=(230, 230, 230))
blatt.save(f'{OUT_PREV}/alle.png')
json.dump(ergebnis, open('/home/claude/rp/assets.json', 'w'))
print(len(ergebnis), 'Designs')
