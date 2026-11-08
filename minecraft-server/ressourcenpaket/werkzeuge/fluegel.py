"""Texturen für Rücken-Teile (Elytra-Form, 'wings'-Ebene). 128x64 (2x)."""
from PIL import Image
import hashlib
from tex import hx, shade

S = 2
U, V, W, H, D = 22, 0, 10, 20, 2  # Elytra-Flügel-Box


def leer():
    return Image.new('RGBA', (64 * S, 32 * S), (0, 0, 0, 0))


def flaechen():
    return {'top': (U + D, V, W, D), 'right': (U, V + D, D, H), 'front': (U + D, V + D, W, H),
            'left': (U + D + W, V + D, D, H), 'back': (U + 2 * D + W, V + D, W, H), 'bottom': (U + D + W, V, W, D)}


def malen(fn):
    im = leer(); px = im.load()
    for name, (u, v, w, h) in flaechen().items():
        for y in range(h * S):
            for x in range(w * S):
                c = fn(name, x, y, w * S, h * S)
                if c is not None:
                    c = hx(c); n = hashlib.md5(f'{name}{x}{y}'.encode()).digest()[0] / 255.0
                    f = 1 + (n - 0.5) * 0.08
                    px[u * S + x, v * S + y] = (min(255, int(c[0] * f)), min(255, int(c[1] * f)), min(255, int(c[2] * f)), c[3])
    return im


def umhang(farbe, saum=None):
    def fn(f, x, y, w, h):
        c = farbe if (x // 3) % 2 else shade(farbe, 0.85)
        if saum and y >= h - 3: return saum
        return c
    return lambda: malen(fn)


def engel():
    def fn(f, x, y, w, h):
        reihe = y // 6
        c = '#F4F4F4' if reihe % 2 == 0 else '#E2E2E8'
        if (x + reihe * 2) % 5 == 0: c = '#CFCFD8'
        if y >= h - 6 and (x % 4) < 2: return None if f == 'front' and (x % 8) < 2 else '#F8F8FF'
        return c
    return malen(fn)


def daemon():
    def fn(f, x, y, w, h):
        if x % 6 == 0 or x == w - 1: return '#141014'  # Knochen
        if y >= h - 4 and (x % 6) > 2: return None
        return '#6A0F14' if (y // 8) % 2 else '#7A1218'
    return malen(fn)


def rucksack(farbe, akzent, licht=None):
    def fn(f, x, y, w, h):
        if y < 2 or x < 1 or x >= w - 1: return shade(farbe, 0.7)
        if f in ('front', 'back') and h // 3 < y < h // 3 + 2: return akzent
        if f in ('front', 'back') and 2 * h // 3 < y < 2 * h // 3 + 8 and 3 < x < w - 4: return shade(farbe, 0.85)
        if licht and f in ('front', 'back') and y % 8 == 4 and x % 6 == 3: return licht
        return farbe
    return malen(fn)


FLUEGEL = {
    'schwarzer_umhang': umhang('#18181C', '#2A2A30'), 'roter_heldenumhang': umhang('#A81E1E', '#E6B422'),
    'engelsfluegel': engel, 'daemonenfluegel': daemon,
    'techno_rucksack': lambda: rucksack('#4A4E56', '#2A2A2E', '#2AF0FF'), 'wanderrucksack': lambda: rucksack('#4E5A3A', '#5A3A1E'),
}
