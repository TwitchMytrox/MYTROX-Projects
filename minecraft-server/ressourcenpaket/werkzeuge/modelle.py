"""3D-Modelle (Block-Elemente) für Kopfbedeckungen und Requisiten.
Jede Farbe ist ein Pixel in einer 16x16-Palette; Flächen nehmen genau diesen Pixel.
Kopf-Modelle: Kopf liegt bei [1.6 .. 14.4], vorne = Norden (z klein)."""
from PIL import Image
from tex import hx, shade

K0, K1 = 1.6, 14.4


class Modell:
    def __init__(self, art='kopf'):
        self.art = art; self.farben = []; self.el = []

    def farbe(self, c):
        c = hx(c)
        if c not in self.farben: self.farben.append(c)
        return self.farben.index(c)

    def uv(self, i):
        x, y = i % 16, i // 16; return [x + 0.25, y + 0.25, x + 0.75, y + 0.75]

    def box(self, a, b, c, nur=None, rot=None, schatten=True):
        """c = Farbe oder dict je Seite. nur = Liste der Seiten, die gezeichnet werden."""
        fl = {}
        for s in ('north', 'south', 'east', 'west', 'up', 'down'):
            if nur and s not in nur: continue
            cc = c[s] if isinstance(c, dict) and s in c else (c['*'] if isinstance(c, dict) else c)
            if schatten and not isinstance(c, dict):
                cc = shade(cc, {'up': 1.08, 'down': 0.7, 'east': 0.9, 'west': 0.9, 'north': 1.0, 'south': 0.95}[s])
            fl[s] = {"uv": self.uv(self.farbe(cc)), "texture": "#t"}
        e = {"from": [round(v, 3) for v in a], "to": [round(v, 3) for v in b], "faces": fl}
        if rot: e["rotation"] = rot
        self.el.append(e); return e

    def spiegeln(self, a, b, c, **kw):
        """Box und ihr Spiegelbild (links/rechts)."""
        self.box(a, b, c, **kw)
        self.box([16 - b[0], a[1], a[2]], [16 - a[0], b[1], b[2]], c, **{k: (dict(v, angle=-v['angle'], origin=[16 - v['origin'][0], v['origin'][1], v['origin'][2]]) if k == 'rot' and v else v) for k, v in kw.items()})

    def json(self, name):
        d = {"textures": {"t": f"turkac:item/{name}", "particle": f"turkac:item/{name}"}, "elements": self.el}
        if self.art == 'kopf':
            d["display"] = {
                "head": {"rotation": [0, 0, 0], "translation": [0, 0, 0], "scale": [1, 1, 1]},
                "gui": {"rotation": [25, 225, 0], "translation": [0, -1.5, 0], "scale": [0.62, 0.62, 0.62]},
                "ground": {"translation": [0, 3, 0], "scale": [0.3, 0.3, 0.3]},
                "fixed": {"rotation": [0, 180, 0], "scale": [0.6, 0.6, 0.6]},
                "thirdperson_righthand": {"rotation": [75, 45, 0], "translation": [0, 2.5, 0], "scale": [0.375, 0.375, 0.375]},
                "thirdperson_lefthand": {"rotation": [75, 45, 0], "translation": [0, 2.5, 0], "scale": [0.375, 0.375, 0.375]},
                "firstperson_righthand": {"rotation": [0, 45, 0], "scale": [0.4, 0.4, 0.4]},
                "firstperson_lefthand": {"rotation": [0, 225, 0], "scale": [0.4, 0.4, 0.4]}}
        elif self.art == 'hand':
            d["parent"] = "minecraft:item/handheld"
            d["gui_light"] = "front"
            for e in self.el: e["rotation"] = {"angle": -45, "axis": "z", "origin": [8, 8, 8]}
        else:  # deko
            d["parent"] = "minecraft:block/block"
        return d

    def textur(self):
        im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        for i, c in enumerate(self.farben): im.putpixel((i % 16, i // 16), c)
        return im


def ring(m, y0, y1, c, innen=1.2, aussen=None, nur_seiten=True):
    """Band rund um den Kopf (nur Seitenflächen)."""
    a = innen; b = 16 - innen
    m.box([a, y0, a], [b, y1, b], c, nur=['north', 'south', 'east', 'west', 'up'] if not nur_seiten else ['north', 'south', 'east', 'west'])


# ------------------------------------------------------------------ Kopf

def cowboyhut():
    m = Modell(); b, d = '#7A5A3A', '#3A2414'
    m.box([-1.5, 14.2, -1.5], [17.5, 15, 17.5], b)
    m.box([-1.5, 15, -1.5], [0, 16.4, 17.5], b); m.box([16, 15, -1.5], [17.5, 16.4, 17.5], b)
    m.box([3, 15, 3], [13, 19.5, 13], b); m.box([2.9, 15, 2.9], [13.1, 16.2, 13.1], d)
    m.box([6, 19.5, 4], [10, 19.8, 12], shade(b, 0.8))
    return m


def cap_rueckwaerts():
    m = Modell(); r = '#B3261E'
    m.box([1.3, 12.8, 1.3], [14.7, 16.2, 14.7], r); m.box([3, 16.2, 3], [13, 17, 13], r)
    m.box([3, 12.8, 14.7], [13, 13.6, 20], shade(r, 0.75)); m.box([7.3, 17, 7.3], [8.7, 17.4, 8.7], '#F2F2F2')
    m.box([5, 13.4, 14.6], [11, 15, 14.8], '#141414')
    return m


def krone():
    m = Modell(); g = '#E6B422'
    ring(m, 14, 16.4, g, 1.0)
    for x in (1.0, 7.0, 13.0):
        for z in (1.0, 13.0): m.box([x, 16.4, z], [x + 2, 18.6, z + 2], g)
    for z in (7.0,):
        for x in (1.0, 13.0): m.box([x, 16.4, z], [x + 2, 18.6, z + 2], g)
    for x, c in ((3.5, '#C8102E'), (7.2, '#1F5AC8'), (10.8, '#2E9A3A')): m.box([x, 14.6, 0.6], [x + 1.6, 15.8, 1.0], c)
    m.box([7.2, 18.6, 0.8], [8.8, 19.6, 2.4], '#C8102E')
    return m


def wikingerhelm():
    m = Modell(); e, h = '#8A8E94', '#E8E0C8'
    m.box([1.0, 11.5, 1.0], [15, 16.4, 15], e); m.box([3, 16.4, 3], [13, 17.6, 13], e); m.box([5.5, 17.6, 5.5], [10.5, 18.2, 10.5], e)
    m.box([7.2, 6.5, 0.4], [8.8, 11.5, 1.0], e); ring(m, 11.5, 12.4, '#5A4A3A', 0.9)
    m.spiegeln([-2.5, 13, 7], [1.0, 15, 9], h); m.spiegeln([-3.5, 15, 7.2], [-1.5, 18, 8.8], h); m.spiegeln([-3.2, 18, 7.4], [-2.0, 20, 8.6], h)
    return m


def samurai_helm():
    m = Modell(); l, g = '#5A1414', '#D4AF37'
    m.box([1.0, 11.5, 1.0], [15, 16.4, 15], l); m.box([3, 16.4, 3], [13, 17.4, 13], l)
    m.box([0, 7.5, 9], [16, 11.5, 16.2], shade(l, 0.85))
    m.spiegeln([-0.8, 7.5, 1.5], [1.0, 11.5, 12], shade(l, 0.85))
    for y in (8.5, 10): m.box([-0.1, y, 16.2], [16.1, y + 0.4, 16.4], '#2A0A0A')
    m.spiegeln([3, 15.5, 0.2], [4.6, 22, 0.8], g, rot={"angle": 22.5, "axis": "z", "origin": [3.8, 15.5, 0.5]})
    m.box([6.6, 13, 0.2], [9.4, 15.8, 0.8], g)
    return m


def gasmaske():
    m = Modell(); g = '#2E3230'
    m.box([3, 3, 0.8], [13, 12, 1.6], g)
    for x in (3.6, 9.2): m.box([x, 7.5, 0.3], [x + 3.2, 10.7, 0.8], '#5A7A70'); m.box([x - 0.3, 7.2, 0.6], [x + 3.5, 11, 0.9], '#1A1A1A', nur=['up', 'down', 'east', 'west'])
    m.box([6, 1.5, -3], [10, 5.5, 0.8], '#4A4E4C'); m.box([6.5, 2, -3.3], [9.5, 5, -3], '#2A2A2A')
    ring(m, 8.6, 9.6, '#1E1E1E', 1.4)
    return m


def venezianische_maske():
    m = Modell(); g, p = '#D4AF37', '#C8507A'
    m.box([2.2, 10.4, 0.8], [13.8, 11.4, 1.6], g); m.box([2.2, 6.6, 0.8], [13.8, 7.6, 1.6], g)
    m.box([2.2, 7.6, 0.8], [3.4, 10.4, 1.6], g); m.box([12.6, 7.6, 0.8], [13.8, 10.4, 1.6], g); m.box([7.2, 7.6, 0.8], [8.8, 10.4, 1.6], g)
    for x in (3, 6, 9, 12): m.box([x, 11.4, 1.0], [x + 0.8, 11.8, 1.4], '#8E1F4A')
    m.box([13.4, 10, 0.4], [14.4, 19, 1.6], p, rot={"angle": -22.5, "axis": "z", "origin": [13.9, 10, 1]})
    m.box([13.2, 12, 0.6], [14.6, 17, 1.4], shade(p, 1.2), rot={"angle": -22.5, "axis": "z", "origin": [13.9, 10, 1]})
    return m


def weihnachtsmuetze():
    m = Modell(); r, w = '#C8102E', '#F4F4F4'
    m.box([1.0, 13, 1.0], [15, 15.2, 15], w)
    m.box([2, 15.2, 2], [14, 17.2, 14], r); m.box([3.5, 17.2, 4], [12.5, 19.2, 13.5], r); m.box([5, 19.2, 7], [11, 20.8, 14.5], r)
    m.box([6.5, 20, 12], [9.5, 21.5, 17], r); m.box([6, 18.5, 16], [10, 22.5, 20], w)
    return m


def hasenohren():
    m = Modell(); w, p = '#F2F2F2', '#F4B8C8'
    m.box([1.2, 14.2, 6.6], [14.8, 15, 8.2], w, nur=['north', 'south', 'east', 'west', 'up'])
    for sgn in (-1, 1):
        o = [8 + sgn * 3.6, 15, 7.4]
        r = {"angle": 22.5 * sgn, "axis": "z", "origin": o}
        x0 = 8 + sgn * 3.6 - 1.6
        m.box([x0, 15, 6.8], [x0 + 3.2, 25, 8.0], w, rot=r)
        m.box([x0 + 0.7, 16, 6.6], [x0 + 2.5, 24, 6.8], p, rot=r)
    return m


def heiligenschein():
    m = Modell(); g = '#FFE680'
    for (a, b) in (([3, 17.5, 3], [13, 18.1, 4]), ([3, 17.5, 12], [13, 18.1, 13]), ([3, 17.5, 4], [4, 18.1, 12]), ([12, 17.5, 4], [13, 18.1, 12])):
        m.box(a, b, g)
    return m


def teufelshoerner():
    m = Modell(); r = '#9A0F0F'
    m.box([1.3, 14.0, 4.2], [14.7, 14.6, 5.4], '#2A0A0A', nur=['north', 'south', 'east', 'west', 'up'])
    m.spiegeln([2.2, 14.4, 3.8], [4.8, 16.6, 5.8], r)
    m.spiegeln([2.0, 16.6, 4.1], [4.0, 18.6, 5.5], r, rot={"angle": 22.5, "axis": "z", "origin": [3, 16.6, 4.8]})
    m.spiegeln([1.0, 18.4, 4.4], [2.6, 20.2, 5.2], shade(r, 1.2), rot={"angle": 45, "axis": "z", "origin": [1.8, 18.4, 4.8]})
    return m


def astronautenhelm():
    m = Modell(); w, g = '#EDEDED', '#B8862A'
    m.box([0.6, 0.6, 0.6], [15.4, 15.6, 15.4], {'*': w, 'north': g})
    m.box([0.2, 0, 0.2], [15.8, 1.6, 15.8], '#B8B8C0')
    m.box([2, 9, 0.4], [5, 11, 0.6], '#F0D58A')
    m.box([12, 15.6, 11], [12.8, 20, 11.8], '#9A9AA0'); m.box([11.8, 19.6, 10.8], [13, 20.8, 12], '#E8442A')
    return m


# Helme der Kostüme
def kuerbiskopf():
    m = Modell(); o, d = '#E07A1A', '#2A1406'
    m.box([0.6, 0.6, 0.6], [15.4, 15.4, 15.4], o)
    for x in (3.5, 7.3, 11.1): m.box([x, 0.6, 0.4], [x + 1.4, 15.4, 0.6], shade(o, 0.82))
    m.box([3, 9, 0.2], [6.5, 12, 0.6], '#F2C24A'); m.box([9.5, 9, 0.2], [13, 12, 0.6], '#F2C24A')
    m.box([7, 7, 0.2], [9, 8.6, 0.6], '#F2C24A')
    for x in range(3, 13, 2): m.box([x, 3.5 + (x % 4 == 1) * 0.8, 0.2], [x + 1.6, 5.6, 0.6], '#F2C24A')
    m.box([7, 15.4, 7], [9, 17.8, 9], '#4A7A2E'); m.box([9, 16.6, 7.5], [12, 17.4, 8.5], '#4A7A2E')
    for x in (1.0, 13.4):
        for z in (1.0, 13.4): m.box([x, 15.4, z], [x + 1.6, 17, z + 1.6], '#E6B422')
    m.box([1.0, 15.4, 1.0], [15, 15.9, 15], '#E6B422', nur=['north', 'south', 'east', 'west'])
    return m


def narrenkappe():
    m = Modell(); l, s, g = '#5A1E7A', '#1A1020', '#E6B422'
    m.box([1.0, 12.8, 1.0], [15, 14.8, 15], g)
    m.box([5.5, 14.8, 5.5], [10.5, 19, 10.5], l); m.box([6.5, 19, 7], [9.5, 22, 11], l); m.box([7, 21.5, 10], [9, 23.5, 13], l)
    m.box([6.8, 22.6, 12.6], [9.2, 24.8, 15], g)
    for sgn, c in ((-1, l), (1, s)):
        x = 8 + sgn * 5
        m.box([x - 2.5, 14.8, 5.5], [x + 2.5, 17.5, 10.5], c)
        m.box([x + sgn * 1.5 - 1.8, 16.5, 6.5], [x + sgn * 1.5 + 1.8, 19, 9.5], c)
        m.box([x + sgn * 3.6 - 1.4, 17.5, 7], [x + sgn * 3.6 + 1.4, 19.5, 9], c)
        m.box([x + sgn * 4.6 - 1.2, 15.6, 6.8], [x + sgn * 4.6 + 1.2, 17.8, 9.2], g)
    return m


def seuchenmaske():
    m = Modell(); s, l = '#121214', '#7A5A3A'
    m.box([-0.8, 14.2, -0.8], [16.8, 14.9, 16.8], s); m.box([2.2, 14.9, 2.2], [13.8, 18.6, 13.8], s)
    m.box([2.1, 14.9, 2.1], [13.9, 15.8, 13.9], '#3A3A3E')
    m.box([1.8, 4, 0.8], [14.2, 13.6, 1.6], l)
    for x in (3.4, 9.6): m.box([x, 9, 0.3], [x + 3, 12, 0.8], '#8A2A1A'); m.box([x - 0.4, 8.6, 0.6], [x + 3.4, 12.4, 0.9], '#3A2A1A', nur=['up', 'down', 'east', 'west'])
    m.box([6, 4, -4], [10, 8.4, 0.8], l); m.box([6.6, 4, -7.5], [9.4, 7.2, -4], l); m.box([7.2, 4, -10], [8.8, 6, -7.5], shade(l, 0.9))
    return m


def zauberhut():
    m = Modell(); l, g = '#3A2466', '#D8DCE8'
    m.box([-1.4, 14.2, -1.4], [17.4, 14.9, 17.4], l)
    m.box([2, 14.9, 2], [14, 17.4, 14], l); m.box([3.5, 17.4, 3.5], [12.5, 19.6, 12.5], l); m.box([5, 19.6, 5.4], [11, 21.6, 11.4], l)
    m.box([6.4, 21.6, 7], [9.6, 23.4, 10.6], l); m.box([7.2, 23, 8.6], [8.8, 25, 11.4], l, rot={"angle": -22.5, "axis": "x", "origin": [8, 23, 9]})
    m.box([1.9, 14.9, 1.9], [14.1, 15.8, 14.1], g, nur=['north', 'south', 'east', 'west'])
    m.box([7, 16.6, 1.7], [9, 18.6, 1.9], '#F4E04A')
    return m


def geweihkranz():
    m = Modell(); b, g = '#7A5A3A', '#5A8A2E'
    m.box([1.1, 13.2, 1.1], [14.9, 14.4, 14.9], b, nur=['north', 'south', 'east', 'west', 'up'])
    for x in (4, 7, 10): m.box([x, 13.6, 0.6], [x + 1.8, 14.8, 1.2], g)
    m.spiegeln([1.4, 14.2, 7], [2.8, 18.4, 8.6], b); m.spiegeln([-1.2, 16.6, 7.1], [1.4, 17.8, 8.5], b)
    m.spiegeln([-1.4, 17.8, 7.1], [-0.2, 20, 8.5], b); m.spiegeln([1.4, 18.4, 7.1], [2.6, 21.4, 8.5], b)
    m.spiegeln([2.6, 19.4, 7.1], [4.4, 20.4, 8.5], b)
    return m


def tropenhelm():
    m = Modell(); k, b = '#D8C490', '#5A3A1E'
    m.box([-0.8, 13.4, -0.8], [16.8, 14.2, 16.8], k)
    m.box([1.1, 14.2, 1.1], [14.9, 17, 14.9], k); m.box([3, 17, 3], [13, 18.4, 13], k); m.box([5, 18.4, 5], [11, 19.2, 11], k)
    m.box([1.0, 14.2, 1.0], [15, 15.2, 15], b, nur=['north', 'south', 'east', 'west'])
    m.box([7.4, 19.2, 7.4], [8.6, 19.6, 8.6], shade(k, 0.8))
    return m


KOPF3D = {
    'cowboyhut': cowboyhut, 'cap_rueckwaerts': cap_rueckwaerts, 'krone': krone, 'wikingerhelm': wikingerhelm,
    'samurai_helm': samurai_helm, 'gasmaske': gasmaske, 'venezianische_maske': venezianische_maske,
    'weihnachtsmuetze': weihnachtsmuetze, 'hasenohren': hasenohren, 'heiligenschein': heiligenschein,
    'teufelshoerner': teufelshoerner, 'astronautenhelm': astronautenhelm,
    'kuerbiskoenig_kopf': kuerbiskopf, 'gaukler_kopf': narrenkappe, 'seuchendoktor_kopf': seuchenmaske,
    'akademie_magier_kopf': zauberhut, 'druide_kopf': geweihkranz, 'wuestenforscher_kopf': tropenhelm,
}


# ------------------------------------------------------------------ Hand (senkrecht gebaut, wird schräg gedreht)

def stab(m, y0, y1, c, d=0.8):
    m.box([8 - d, y0, 8 - d], [8 + d, y1, 8 + d], c)


def plasmaklinge(farbe):
    def f():
        m = Modell('hand')
        stab(m, -2, 4, '#5A5E66', 0.9); m.box([6.8, 1, 6.8], [9.2, 1.8, 9.2], '#2A2A2E'); m.box([6.9, 3.4, 6.9], [9.1, 4.4, 9.1], '#9A9EA6')
        m.box([7.1, 2, 6.9], [8.9, 2.8, 7.1], '#C82020')
        stab(m, 4.4, 18.5, shade(farbe, 1.0), 0.75); stab(m, 4.4, 18.2, shade(farbe, 1.5), 0.35)
        return m
    return f


def zauberstab():
    m = Modell('hand'); stab(m, -1, 5, '#3A2414', 0.7); stab(m, 5, 15, '#6A4A2E', 0.5)
    m.box([7.2, 15, 7.2], [8.8, 16.6, 8.8], '#9AE8FF'); m.box([7.6, 4.4, 7.6], [8.4, 5.4, 8.4], '#C8B070')
    return m


def druidenstab():
    m = Modell('hand'); stab(m, -3, 15, '#6A4A2E', 0.7)
    m.box([8.7, 14, 7.4], [10.2, 18, 8.6], '#6A4A2E'); m.box([5.8, 14, 7.4], [7.3, 18, 8.6], '#6A4A2E')
    m.box([6.9, 15.5, 6.9], [9.1, 17.7, 9.1], '#3CFF8A'); m.box([7.6, 13.5, 6.5], [8.4, 14.5, 7.2], '#5A8A2E')
    return m


def peitsche():
    m = Modell('hand'); stab(m, -2, 4, '#3A2414', 0.8); m.box([7.4, 4, 7.4], [8.6, 10, 8.6], '#5A3A1E')
    m.box([7.6, 10, 7.6], [8.4, 14, 8.4], '#6A4A2E'); m.box([8.2, 13.5, 7.7], [9.4, 17, 8.3], '#6A4A2E')
    return m


def sichel():
    m = Modell('hand'); stab(m, -3, 14, '#3A2E26', 0.6)
    m.box([8.4, 13, 7.6], [14, 14.4, 8.4], '#C8CCD4'); m.box([12.6, 9.5, 7.6], [14, 13, 8.4], '#C8CCD4')
    m.box([13, 7.5, 7.7], [13.9, 9.5, 8.3], '#E8ECF4'); m.box([7.4, 12.6, 7.4], [8.6, 14.6, 8.6], '#2A2A2E')
    return m


def kettensaege():
    m = Modell('hand'); o = '#E07A1A'
    m.box([6, 0, 6.2], [10, 5, 9.8], o); m.box([6.6, -2, 7.2], [9.4, 0, 8.8], '#2A2A2A')
    m.box([7, 5, 7.6], [9, 17, 8.4], '#C8CCD4')
    for y in range(5, 17, 2): m.box([6.8, y, 7.5], [9.2, y + 1, 8.5], '#3A3A3A')
    return m


def spazierstock():
    m = Modell('hand'); stab(m, -3, 14, '#2A1A10', 0.55)
    m.box([7.4, 14, 7.4], [11.5, 15.2, 8.6], '#C8B070'); m.box([10.4, 12.4, 7.4], [11.5, 14, 8.6], '#C8B070')
    return m


def regenschirm():
    m = Modell('hand'); stab(m, -3, 12, '#3A3A3E', 0.4)
    m.box([8.4, -3.4, 7.6], [10, -2.6, 8.4], '#2A1A10')
    m.box([5.6, 9, 5.6], [10.4, 17, 10.4], '#1F3A8A'); m.box([6.2, 17, 6.2], [9.8, 17.6, 9.8], '#1F3A8A')
    m.box([7.6, 17.6, 7.6], [8.4, 18.6, 8.4], '#C8C8C8')
    return m


HAND3D = {
    'plasmaklinge_blau': plasmaklinge('#2A8AFF'), 'plasmaklinge_rot': plasmaklinge('#FF2A2A'), 'zauberstab': zauberstab,
    'druidenstab': druidenstab, 'peitsche': peitsche, 'schnitter_sichel': sichel, 'kettensaege': kettensaege,
    'spazierstock': spazierstock, 'regenschirm': regenschirm,
}


# ------------------------------------------------------------------ Deko (blockartig)

def laterne():
    m = Modell('deko'); s = '#2A2A2E'
    m.box([4, 0, 4], [12, 1.5, 12], s); m.box([4.5, 1.5, 4.5], [11.5, 10, 11.5], '#F2B840'); m.box([4, 10, 4], [12, 11.5, 12], s)
    for x in (4, 10.5):
        for z in (4, 10.5): m.box([x, 1.5, z], [x + 1.5, 10, z + 1.5], s)
    m.box([6, 11.5, 6], [10, 13, 10], s); m.box([7.3, 13, 7.3], [8.7, 15.5, 8.7], s)
    return m


def phoenix_schild():
    m = Modell('deko'); r, g = '#B83A1A', '#E6B422'
    m.box([2, 1, 7], [14, 15, 9], r); m.box([1.5, 0.5, 6.8], [14.5, 1, 9.2], g); m.box([1.5, 15, 6.8], [14.5, 15.5, 9.2], g)
    m.box([1.5, 1, 6.8], [2, 15, 9.2], g); m.box([14, 1, 6.8], [14.5, 15, 9.2], g)
    for i in range(4): m.box([4 + i, 9 - i * 1.5, 6.7], [5 + i, 10 - i * 1.5, 7], g); m.box([11 - i, 9 - i * 1.5, 6.7], [12 - i, 10 - i * 1.5, 7], g)
    m.box([7.2, 3, 6.7], [8.8, 11, 7], '#F08A2A')
    return m


def kerze():
    m = Modell('deko'); k = '#E8E0C8'
    m.box([4, 0, 4], [12, 6, 12], k)
    m.box([5, 3.5, 3.9], [7, 5, 4], '#141414'); m.box([9, 3.5, 3.9], [11, 5, 4], '#141414'); m.box([7.5, 2, 3.9], [8.5, 3, 4], '#141414')
    m.box([6.5, 6, 6.5], [9.5, 11, 9.5], '#F2F0E8'); m.box([7.6, 11, 7.6], [8.4, 12, 8.4], '#2A2A2A'); m.box([7.3, 12, 7.3], [8.7, 14, 8.7], '#FFB830')
    return m


def puppe():
    m = Modell('deko')
    m.box([5.5, 0, 6.5], [10.5, 7, 9.5], '#6A8ACC'); m.box([5, 6, 6], [11, 7, 10], '#F2F2F2')
    m.box([6, 7, 6], [10, 11, 10], '#F0E4DC'); m.box([5.8, 10, 5.8], [10.2, 12, 10.2], '#C88A3A')
    m.box([6.8, 8.6, 5.9], [7.6, 9.4, 6], '#2A2A44'); m.box([8.4, 8.6, 5.9], [9.2, 9.4, 6], '#2A2A44')
    m.box([4.4, 3, 7.4], [5.5, 6.5, 8.6], '#F0E4DC'); m.box([10.5, 3, 7.4], [11.6, 6.5, 8.6], '#F0E4DC')
    return m


def zeitkern():
    m = Modell('deko')
    m.box([3, 0, 3], [13, 2, 13], '#4A4E56'); m.box([3, 14, 3], [13, 16, 13], '#4A4E56')
    for x in (3, 11):
        for z in (3, 11): m.box([x, 2, z], [x + 2, 14, z + 2], '#6A6E76')
    m.box([6, 3, 6], [10, 13, 10], '#2AF0FF'); m.box([7, 2, 7], [9, 14, 9], '#C8FFFF')
    return m


def thron():
    m = Modell('deko'); g, r = '#C89A2A', '#8E0F1A'
    m.box([2, 0, 2], [14, 6, 14], g); m.box([3, 6, 3], [13, 7, 13], r)
    m.box([2, 6, 12], [14, 16, 14], g); m.box([3.5, 7, 11.6], [12.5, 14.5, 12], r)
    for x in (2, 12.5): m.box([x, 6, 2], [x + 1.5, 9.5, 12], g)
    for x in (2, 6.8, 11.8): m.box([x, 16, 12.5], [x + 2.2, 18, 13.5], g)
    return m


def popcorn():
    m = Modell('deko'); r = '#C8102E'
    m.box([2, 0, 2], [14, 4, 14], r); m.box([2.5, 4, 2.5], [13.5, 12, 13.5], '#BFE6F2')
    m.box([3, 4, 3], [13, 8, 13], '#F4E6B0'); m.box([2, 12, 2], [14, 14, 14], r); m.box([5, 14, 5], [11, 15.5, 11], '#E6B422')
    for x in (2, 12.5):
        for z in (2, 12.5): m.box([x, 4, z], [x + 1.5, 12, z + 1.5], r)
    return m


def filmklappe():
    m = Modell('deko')
    m.box([2, 0, 7], [14, 9, 9], '#1A1A1A'); m.box([3, 1.5, 6.9], [13, 2, 7], '#F2F2F2'); m.box([3, 4, 6.9], [13, 4.5, 7], '#F2F2F2')
    m.box([2, 9, 7], [14, 11, 9], {'*': '#F2F2F2', 'north': '#F2F2F2'})
    for x in (2, 6, 10): m.box([x, 9, 6.9], [x + 2, 11, 7], '#141414')
    m.box([2, 11.2, 7], [14, 13.2, 9], '#F2F2F2', rot={"angle": 22.5, "axis": "z", "origin": [2, 11.2, 8]})
    return m


def goldkette():
    m = Modell('deko'); g = '#E6B422'
    for (a, b) in (([3, 6, 7.4], [13, 7, 8.6]), ([3, 13, 7.4], [13, 14, 8.6]), ([3, 7, 7.4], [4, 13, 8.6]), ([12, 7, 7.4], [13, 13, 8.6])):
        m.box(a, b, g)
    m.box([6.5, 3, 7.2], [9.5, 6, 8.8], g); m.box([7.2, 3.6, 7.1], [8.8, 5.4, 7.2], '#C8102E')
    return m


def luxusuhr():
    m = Modell('deko')
    m.box([6, 0, 7], [10, 16, 9], '#C8B070'); m.box([4.5, 5, 6.5], [11.5, 11, 9.5], '#E6C860')
    m.box([5.2, 5.7, 6.3], [10.8, 10.3, 6.5], '#1A1E2A'); m.box([7.8, 8, 6.2], [8.2, 10, 6.3], '#F2F2F2'); m.box([8, 7.8, 6.2], [9.6, 8.2, 6.3], '#F2F2F2')
    return m


DEKO3D = {
    'spuk_laterne': laterne, 'phoenix_schild': phoenix_schild, 'totenkopf_kerze': kerze, 'porzellanpuppe': puppe,
    'zeitkern': zeitkern, 'koenigsthron': thron, 'popcornmaschine': popcorn, 'filmklappe': filmklappe,
    'goldkette': goldkette, 'luxusuhr': luxusuhr,
}
