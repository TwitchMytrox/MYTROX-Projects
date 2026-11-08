"""Turkac Kleidung: Rüstungs- und Item-Texturen (eigene Designs), Maßstab 4x (256x128)."""
from PIL import Image
import hashlib

S = 4  # Pixel pro Vanilla-Pixel
W, H = 64 * S, 32 * S
# (u, v, Breite, Höhe, Tiefe) in Vanilla-Pixeln
BOX = {'head': (0, 0, 8, 8, 8), 'body': (16, 16, 8, 12, 4), 'arm': (40, 16, 4, 12, 4), 'leg': (0, 16, 4, 12, 4)}
SIDES = ['right', 'front', 'left', 'back']


def hx(c, a=255):
    if isinstance(c, tuple): return c if len(c) == 4 else c + (a,)
    c = c.lstrip('#'); return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), a)


def shade(c, f):
    r, g, b, a = hx(c)
    return (max(0, min(255, int(r * f))), max(0, min(255, int(g * f))), max(0, min(255, int(b * f))), a)


def faces(part):
    u, v, w, h, d = BOX[part]
    return {'top': (u + d, v, w, d), 'bottom': (u + d + w, v, w, d), 'right': (u, v + d, d, h),
            'front': (u + d, v + d, w, h), 'left': (u + d + w, v + d, d, h), 'back': (u + 2 * d + w, v + d, w, h)}


class Tex:
    def __init__(self):
        self.im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        self.px = self.im.load()

    def face_size(self, part, face):
        _, _, w, h = faces(part)[face]; return w * S, h * S

    def set(self, part, face, x, y, c):
        u, v, w, h = faces(part)[face]
        if 0 <= x < w * S and 0 <= y < h * S:
            self.px[u * S + x, v * S + y] = hx(c)

    def get(self, part, face, x, y):
        u, v, w, h = faces(part)[face]
        return self.px[u * S + x, v * S + y]

    def rect(self, part, face, x0, y0, x1, y1, c):
        for y in range(y0, y1):
            for x in range(x0, x1): self.set(part, face, x, y, c)

    def clear(self, part, face, x0, y0, x1, y1):
        for y in range(y0, y1):
            for x in range(x0, x1): self.set(part, face, x, y, (0, 0, 0, 0))

    def band(self, part, y0, y1, c, sides=SIDES):
        """Waagrechter Streifen rundherum (y in Teil-Pixeln, 4x)."""
        for f in sides:
            fw, _ = self.face_size(part, f); self.rect(part, f, 0, y0, fw, y1, c)

    def fill(self, part, c, y0=0, y1=None, top=True, bottom=True):
        for f in SIDES:
            fw, fh = self.face_size(part, f); self.rect(part, f, 0, y0, fw, fh if y1 is None else y1, c)
        if top: fw, fh = self.face_size(part, 'top'); self.rect(part, 'top', 0, 0, fw, fh, c)
        if bottom: fw, fh = self.face_size(part, 'bottom'); self.rect(part, 'bottom', 0, 0, fw, fh, c)

    def vline(self, part, face, x, y0, y1, c, w=1):
        self.rect(part, face, x, y0, x + w, y1, c)

    def text(self, part, face, s, y, c, cx=None):
        fw, _ = self.face_size(part, face)
        tw = len(s) * 4 - 1
        x = (fw - tw) // 2 if cx is None else cx
        for ch in s:
            for ry, row in enumerate(FONT[ch]):
                for rx, b in enumerate(row):
                    if b == '#': self.set(part, face, x + rx, y + ry, c)
            x += 4

    def pinstripes(self, part, c, step=6, y0=0, y1=None):
        for f in SIDES:
            fw, fh = self.face_size(part, f)
            for x in range(1, fw, step):
                for y in range(y0, fh if y1 is None else y1):
                    if self.get(part, f, x, y)[3]: self.set(part, f, x, y, c)

    def finish(self, amount=0.05):
        """Leichte Stoff-Struktur und dunklere Kanten."""
        for y in range(H):
            for x in range(W):
                r, g, b, a = self.px[x, y]
                if a == 0: continue
                hsh = hashlib.md5(f'{x},{y}'.encode()).digest()[0] / 255.0
                f = 1 + (hsh - 0.5) * 2 * amount
                self.px[x, y] = (max(0, min(255, int(r * f))), max(0, min(255, int(g * f))), max(0, min(255, int(b * f))), a)
        return self.im


FONT = {
    'A': ['###', '#.#', '###', '#.#', '#.#'], 'B': ['##.', '#.#', '##.', '#.#', '##.'], 'C': ['###', '#..', '#..', '#..', '###'],
    'E': ['###', '#..', '##.', '#..', '###'], 'G': ['###', '#..', '#.#', '#.#', '###'], 'I': ['###', '.#.', '.#.', '.#.', '###'],
    'L': ['#..', '#..', '#..', '#..', '###'], 'N': ['#.#', '###', '###', '#.#', '#.#'], 'O': ['###', '#.#', '#.#', '#.#', '###'],
    'P': ['###', '#.#', '###', '#..', '#..'], 'R': ['##.', '#.#', '##.', '#.#', '#.#'], 'S': ['###', '#..', '###', '..#', '###'],
    'T': ['###', '.#.', '.#.', '.#.', '.#.'], 'U': ['#.#', '#.#', '#.#', '#.#', '###'], 'V': ['#.#', '#.#', '#.#', '#.#', '.#.'],
    'W': ['#.#', '#.#', '###', '###', '#.#'], 'Z': ['###', '..#', '.#.', '#..', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
    '2': ['##.', '..#', '.#.', '#..', '###'], ' ': ['...'] * 5,
}


# ------------------------------------------------------------------ Bausteine

def jacke(t, farbe, aermel=None, laenge=48):
    t.fill('body', farbe, 0, laenge)
    t.fill('arm', aermel or farbe)
    t.band('arm', 44, 48, shade(aermel or farbe, 0.8))  # Bündchen


def hemd_v(t, hemd, revers, tiefe=20):
    """V-Ausschnitt mit Hemd und Revers vorne."""
    for y in range(0, tiefe):
        half = max(1, (tiefe - y) * 6 // tiefe)
        t.rect('body', 'front', 16 - half, y, 16 + half, y + 1, hemd)
        if revers: t.rect('body', 'front', 16 - half - 2, y, 16 - half, y + 1, revers); t.rect('body', 'front', 16 + half, y, 16 + half + 2, y + 1, revers)


def krawatte(t, c, bis=30):
    t.rect('body', 'front', 15, 2, 17, 4, shade(c, 0.85))
    for y in range(4, bis): t.rect('body', 'front', 15 if y < bis - 2 else 15, y, 17, y + 1, c)


def fliege(t, c):
    t.rect('body', 'front', 13, 2, 19, 5, c); t.rect('body', 'front', 15, 2, 17, 5, shade(c, 1.3))


def knoepfe(t, c, xs=(15,), ys=(26, 34, 42)):
    for x in xs:
        for y in ys: t.rect('body', 'front', x, y, x + 2, y + 2, c)


def tasche(t, c, x=4, y=8, w=6, h=1):
    t.rect('body', 'front', x, y, x + w, y + h, c)


def hose(t, farbe, guertel=None, schnalle=None, bund=28):
    t.fill('body', farbe, bund, 48, top=False)
    t.fill('leg', farbe)
    if guertel: t.band('body', bund, bund + 4, guertel)
    if schnalle: t.rect('body', 'front', 13, bund, 19, bund + 4, schnalle); t.rect('body', 'front', 15, bund + 1, 17, bund + 3, guertel)
    for f in ('front', 'back'): t.rect('body', f, 15, bund + 4, 17, 48, shade(farbe, 0.85))  # Mittelnaht


def schuhe(t, farbe, sohle=None, ab=36, glanz=None):
    t.fill('leg', farbe, ab, 48, top=False)
    t.band('leg', 46, 48, sohle or shade(farbe, 0.6))
    if glanz: t.rect('leg', 'front', 2, ab + 3, 6, ab + 5, glanz)


def mittelreissverschluss(t, c, y0=4, y1=48):
    t.vline('body', 'front', 15, y0, y1, c, 2)


def reflex(t, part, y, gelb='#E8D44A', silber='#D8D8D8'):
    t.band(part, y, y + 2, gelb); t.band(part, y + 2, y + 4, silber); t.band(part, y + 4, y + 6, gelb)


def hutform(t, farbe, hoehe=10, band=None, krempe=None):
    t.fill('head', farbe, 0, hoehe, bottom=False)
    if band: t.band('head', hoehe - 4, hoehe - 2, band)
    if krempe: t.band('head', hoehe, hoehe + 2, krempe)


def sonnenbrille(t, rahmen, glas='#111216'):
    t.rect('head', 'front', 2, 12, 30, 14, rahmen)
    t.rect('head', 'front', 4, 14, 14, 19, glas); t.rect('head', 'front', 18, 14, 28, 19, glas)
    t.rect('head', 'front', 5, 14, 8, 15, (255, 255, 255, 120)); t.rect('head', 'front', 19, 14, 22, 15, (255, 255, 255, 120))
    for f in ('right', 'left'): t.rect('head', f, 0, 12, 32, 14, rahmen)


# ------------------------------------------------------------------ Outfits
# jede Funktion liefert (humanoid, humanoid_leggings)

def smoking():
    a, b = Tex(), Tex()
    schwarz, satin = '#141418', '#26262E'
    jacke(a, schwarz); hemd_v(a, '#F2F2F2', satin, 24); fliege(a, '#0A0A0C'); knoepfe(a, satin, ys=(30, 38))
    a.rect('body', 'front', 22, 9, 26, 11, '#F2F2F2')  # Einstecktuch
    a.band('arm', 42, 44, '#F2F2F2')  # Manschetten
    hutform(a, '#0E0E10', 12, band='#3A3A44')  # Zylinder
    hose(b, schwarz, '#0A0A0C'); [b.vline('leg', f, 7, 0, 48, satin, 2) for f in ('right', 'left')]
    schuhe(a, '#08080A', '#1A1A1A', 36, glanz='#4A4A55')
    return a.finish(0.03), b.finish(0.03)


def nadelstreifen():
    a, b = Tex(), Tex()
    stoff, streifen = '#2C3240', '#5A6274'
    jacke(a, stoff); a.pinstripes('body', streifen); a.pinstripes('arm', streifen)
    hemd_v(a, '#EDEDED', '#232835', 20); krawatte(a, '#8E1F1F'); knoepfe(a, '#1A1E28', ys=(28, 38))
    hutform(a, '#4A4A50', 10, band='#151515', krempe='#3A3A40')  # Fedora
    hose(b, stoff, '#151515', '#B8A060'); b.pinstripes('leg', streifen); b.pinstripes('body', streifen, y0=32)
    schuhe(a, '#5A3A1E', '#2A1A0E', 36)
    for x in (1, 3, 5): a.set('leg', 'front', x * 1 + 1, 40, '#7A5432')  # Budapester-Lochmuster
    return a.finish(), b.finish()


def gold_vip():
    a, b = Tex(), Tex()
    samt, gold = '#141416', '#E6B422'
    jacke(a, samt); hemd_v(a, '#0A0A0A', gold, 22); fliege(a, gold); knoepfe(a, gold, ys=(28, 36, 44))
    a.band('arm', 40, 42, gold); a.band('body', 46, 48, gold)
    a.text('body', 'back', 'VIP', 10, gold)
    a.rect('body', 'back', 6, 18, 26, 19, gold)
    sonnenbrille(a, gold)
    hose(b, samt, gold); [b.vline('leg', f, 6, 0, 48, gold, 2) for f in ('right', 'left')]
    schuhe(a, gold, '#8A6A10', 38, glanz='#FFF2B0')
    return a.finish(0.03), b.finish(0.03)


def klassisch(basis_h, basis_l):
    a = Tex(); a.im = basis_h.resize((W, H), Image.NEAREST).convert('RGBA'); a.px = a.im.load()
    b = Tex(); b.im = basis_l.resize((W, H), Image.NEAREST).convert('RGBA'); b.px = b.im.load()
    hutform(a, '#1C1C20', 10, band='#3A3A40', krempe='#141416')
    return a.im, b.im


def trainingsanzug():
    a, b = Tex(), Tex()
    blau, weiss = '#1F3A8A', '#F0F0F0'
    jacke(a, blau); mittelreissverschluss(a, '#D8D8D8'); a.band('body', 0, 4, shade(blau, 0.8))
    for f in ('right', 'left'): a.vline('arm', f, 4, 0, 44, weiss, 2); a.vline('arm', f, 10, 0, 44, weiss, 2)
    for f in ('right', 'left'): a.vline('body', f, 6, 4, 48, weiss, 2)
    hutform(a, '#1E1E22', 8); a.rect('head', 'front', 0, 8, 32, 12, '#141416')  # Cap mit Schirm
    a.rect('head', 'front', 13, 2, 19, 6, weiss)
    hose(b, blau, shade(blau, 0.8)); [b.vline('leg', f, 4, 0, 46, weiss, 2) for f in ('right', 'left')]; [b.vline('leg', f, 10, 0, 46, weiss, 2) for f in ('right', 'left')]
    b.band('leg', 44, 48, shade(blau, 0.8))
    schuhe(a, weiss, '#9A9AA0', 38); a.rect('leg', 'front', 0, 42, 16, 44, '#C8C8D0')
    return a.finish(), b.finish()


def hoodie():
    a, b = Tex(), Tex()
    grau, oliv = '#6E6E73', '#4E5A3A'
    jacke(a, grau); a.band('body', 44, 48, shade(grau, 0.8))
    a.rect('body', 'front', 6, 30, 26, 42, shade(grau, 0.88)); a.rect('body', 'front', 6, 30, 26, 31, shade(grau, 0.7))  # Bauchtasche
    a.vline('body', 'front', 12, 0, 12, '#EDEDED'); a.vline('body', 'front', 19, 0, 12, '#EDEDED')  # Kordeln
    a.rect('body', 'back', 4, 0, 28, 10, shade(grau, 0.8))  # Kapuze
    hutform(a, '#2E2E33', 10); [a.vline('head', f, x, 0, 10, '#3A3A40') for f in SIDES for x in range(0, 32, 3)]
    a.band('head', 8, 12, '#3A3A40')  # Umschlag Beanie
    hose(b, oliv, '#2A2A2A', '#9A9AA0')
    for f in ('right', 'left'): b.rect('leg', f, 2, 16, 14, 28, shade(oliv, 0.85)); b.rect('leg', f, 2, 16, 14, 17, shade(oliv, 0.7))  # Seitentaschen
    schuhe(a, '#F2F2F2', '#BDBDBD', 30); a.band('leg', 30, 32, '#2A2A2A')
    for y in (33, 36, 39): a.rect('leg', 'front', 5, y, 11, y + 1, '#2A2A2A')  # Schnürung
    return a.finish(), b.finish()


def biker():
    a, b = Tex(), Tex()
    leder, schwarz, chrom = '#3E2614', '#141414', '#C8C8D0'
    jacke(a, leder); a.band('body', 0, 4, shade(leder, 0.75))
    for y in range(4, 46): a.set('body', 'front', 18 - (y - 4) // 8, y, chrom); a.set('body', 'front', 19 - (y - 4) // 8, y, chrom)
    a.band('body', 40, 44, schwarz); a.rect('body', 'front', 4, 40, 8, 44, chrom)
    a.band('arm', 20, 22, shade(leder, 0.75))
    a.fill('head', schwarz)  # Integralhelm
    a.rect('head', 'front', 2, 10, 30, 22, '#2A3440'); a.rect('head', 'front', 4, 11, 12, 13, '#6A7A8C')
    a.band('head', 0, 2, '#9A1F1F'); a.rect('head', 'top', 14, 0, 18, 32, '#9A1F1F')
    hose(b, schwarz, '#0A0A0A', chrom)
    for f in ('front',): b.rect('leg', f, 2, 20, 14, 28, '#262626')  # Knieschutz
    schuhe(a, '#121212', '#050505', 28); a.band('leg', 32, 34, chrom)
    return a.finish(), b.finish()


def polizei():
    a, b = Tex(), Tex()
    blau, dunkel, gold = '#2B4C8C', '#1A2D55', '#D8B64A'
    jacke(a, blau); a.band('body', 0, 3, dunkel); hemd_v(a, dunkel, None, 8)
    a.rect('body', 'front', 4, 12, 8, 16, gold); a.set('body', 'front', 5, 13, '#FFF2B0')  # Stern/Abzeichen
    tasche(a, dunkel, 4, 18, 8, 1); tasche(a, dunkel, 20, 18, 8, 1)
    knoepfe(a, '#E0E0E0', xs=(15,), ys=(14, 22, 30, 38))
    for f in ('right', 'left'): a.rect('arm', f, 4, 6, 12, 14, '#EDEDED'); a.rect('arm', f, 5, 7, 11, 13, dunkel)
    a.text('body', 'back', 'POLIZEI', 10, '#EDEDED')
    hutform(a, dunkel, 10, band='#141414'); a.rect('head', 'front', 0, 10, 32, 12, '#0A0A0A'); a.rect('head', 'front', 14, 3, 18, 7, gold)
    hose(b, dunkel, '#111111', '#C8C8D0'); [b.vline('leg', f, 7, 0, 46, '#4A6AA8', 2) for f in ('right', 'left')]
    schuhe(a, '#0E0E0E', '#050505', 32, glanz='#3A3A40')
    return a.finish(), b.finish()


def swat():
    a, b = Tex(), Tex()
    schwarz, weste, tasche_c = '#18181A', '#262628', '#323236'
    jacke(a, schwarz)
    a.rect('body', 'front', 2, 6, 30, 44, weste); a.rect('body', 'back', 2, 4, 30, 44, weste)
    for x in (4, 12, 20): a.rect('body', 'front', x, 28, x + 7, 38, tasche_c); a.rect('body', 'front', x, 28, x + 7, 29, '#3E3E44')
    a.text('body', 'back', 'SWAT', 12, '#EDEDED')
    a.rect('body', 'front', 4, 10, 12, 14, '#EDEDED'); a.text('body', 'front', 'SW', 10, schwarz, cx=4) if False else None
    hutform(a, '#202022', 12); a.band('head', 10, 12, '#2C2C30')
    hose(b, schwarz, '#0E0E0E', '#3A3A3A'); [b.rect('leg', 'front', 2, 18, 14, 26, '#2E2E32') for _ in (0,)]
    for f in ('right', 'left'): b.rect('leg', f, 2, 8, 14, 16, tasche_c)
    schuhe(a, '#0C0C0C', '#050505', 28)
    return a.finish(), b.finish()


def feuerwehr():
    a, b = Tex(), Tex()
    rot = '#8E2A1E'
    jacke(a, rot); mittelreissverschluss(a, '#2A2A2A'); a.band('body', 0, 4, '#2A2A2A')
    reflex(a, 'body', 30); reflex(a, 'body', 12); reflex(a, 'arm', 30)
    a.text('body', 'back', '112', 22, '#E8D44A')
    hutform(a, '#E0C21E', 12); a.band('head', 12, 14, '#B89A10'); a.rect('head', 'front', 13, 2, 19, 9, '#9A1F1F'); a.rect('head', 'front', 15, 3, 17, 8, '#E0C21E')
    hose(b, rot, '#2A2A2A'); reflex(b, 'leg', 30)
    schuhe(a, '#121212', '#3A2A10', 28); a.band('leg', 32, 34, '#E8D44A')
    return a.finish(), b.finish()


def sanitaeter():
    a, b = Tex(), Tex()
    rot, weiss = '#D6402B', '#EDEDED'
    jacke(a, rot); mittelreissverschluss(a, '#3A3A3A'); a.band('body', 0, 4, '#26324A')
    reflex(a, 'body', 30, '#D8D8D8', '#F4E04A'); reflex(a, 'arm', 30, '#D8D8D8', '#F4E04A')
    a.text('body', 'back', 'RETTUNG', 12, weiss)
    hutform(a, rot, 8); a.rect('head', 'front', 0, 8, 32, 12, '#26324A')
    hose(b, '#26324A', '#141414'); reflex(b, 'leg', 30, '#D8D8D8', '#F4E04A')
    schuhe(a, '#1A1A1A', '#0A0A0A', 34)
    return a.finish(), b.finish()


def mechaniker():
    a, b = Tex(), Tex()
    blau = '#2F4F7F'
    jacke(a, blau); a.band('body', 0, 4, shade(blau, 0.8)); mittelreissverschluss(a, '#9A9AA0', 4, 28)
    a.rect('body', 'front', 4, 10, 12, 14, '#EDEDED'); a.rect('body', 'front', 5, 11, 11, 13, '#9A1F1F')  # Namensschild
    a.rect('body', 'front', 19, 10, 27, 18, shade(blau, 0.85))  # Brusttasche
    for (x, y) in ((22, 30), (8, 38), (24, 42), (6, 24)): a.rect('body', 'front', x, y, x + 2, y + 2, '#2A2A2A')  # Ölflecken
    a.band('head', 10, 12, '#3A2A1A')  # Schweißerbrille: Band
    for x in (4, 18): a.rect('head', 'front', x, 8, x + 10, 14, '#3A3A3A'); a.rect('head', 'front', x + 2, 9, x + 8, 13, '#4A7A6A')
    hose(b, blau, shade(blau, 0.75)); b.rect('leg', 'front', 2, 26, 6, 30, '#2A2A2A')
    schuhe(a, '#1A1A1A', '#0A0A0A', 34); a.rect('leg', 'front', 0, 40, 16, 46, '#8A8A90')  # Stahlkappe
    return a.finish(), b.finish()


def koch():
    a, b = Tex(), Tex()
    weiss = '#F2F2F2'
    jacke(a, weiss); a.band('body', 0, 4, '#E0E0E0')
    knoepfe(a, '#9A9AA0', xs=(9, 21), ys=(10, 18, 26, 34))
    a.vline('body', 'front', 15, 4, 48, '#DADADA')
    hutform(a, weiss, 16)
    for f in SIDES:
        for x in range(0, 32, 4): a.vline('head', f, x, 0, 12, '#E2E2E2')
    a.band('head', 12, 16, '#E6E6E6')
    hose(b, '#2A2A2A')
    for part, fs in (('leg', SIDES), ('body', SIDES)):
        for f in fs:
            fw, fh = b.face_size(part, f)
            for y in range(28 if part == 'body' else 0, 48):
                for x in range(fw):
                    if ((x // 2) + (y // 2)) % 2 == 0: b.set(part, f, x, y, '#E8E8E8')
    schuhe(a, '#1E1E1E', '#0A0A0A', 38)
    return a.finish(0.02), b.finish(0.03)


def pirat():
    a, b = Tex(), Tex()
    mantel, gold, weiss = '#5A1A1A', '#D4AF37', '#EDE6D6'
    jacke(a, mantel); a.band('arm', 36, 44, shade(mantel, 0.75)); a.band('arm', 36, 37, gold)
    hemd_v(a, weiss, gold, 18)
    for y in range(4, 14, 3): a.rect('body', 'front', 14, y, 18, y + 1, '#D8D0C0')  # Rüschen
    knoepfe(a, gold, xs=(8, 23), ys=(22, 30, 38))
    a.band('body', 40, 44, '#2A1A10'); a.rect('body', 'front', 13, 40, 19, 44, gold)
    hutform(a, '#141414', 10); a.band('head', 8, 10, gold)
    a.rect('head', 'front', 14, 2, 18, 5, weiss); a.rect('head', 'front', 15, 3, 16, 4, '#141414'); a.rect('head', 'front', 16, 3, 17, 4, '#141414')
    a.rect('head', 'front', 13, 6, 19, 7, weiss)
    hose(b, '#5A4A3A', '#2A1A10', gold)
    schuhe(a, '#141414', '#050505', 22); a.band('leg', 22, 26, '#2A2A2A')
    return a.finish(), b.finish()


def weisser_anzug():
    a, b = Tex(), Tex()
    weiss, hemd = '#EFEFEA', '#5A1416'
    jacke(a, weiss); hemd_v(a, hemd, '#DCDCD4', 22)
    for y in range(2, 8): a.rect('body', 'front', 13 - (y - 2) // 2, y, 15, y + 1, '#DCDCD4')  # offener Kragen
    knoepfe(a, '#CFCFC8', ys=(28, 38)); a.rect('body', 'front', 22, 9, 26, 11, hemd)
    sonnenbrille(a, '#1A1A1A')
    hose(b, weiss, '#3A2A1A', '#C8B070')
    schuhe(a, '#F4F4F0', '#BDBDB5', 38)
    return a.finish(0.03), b.finish(0.03)


def schwarzer_anzug():
    a, b = Tex(), Tex()
    schwarz = '#121216'
    jacke(a, schwarz); hemd_v(a, '#EDEDED', '#1E1E24', 22); krawatte(a, '#0A0A0C'); knoepfe(a, '#2A2A30', ys=(28,))
    a.rect('body', 'front', 4, 30, 10, 31, '#2A2A30'); a.rect('body', 'front', 22, 30, 28, 31, '#2A2A30')
    for f in ('front', 'right', 'left'):  # Bart (unteres Gesicht)
        fw, _ = a.face_size('head', f)
        for y in range(22, 32):
            for x in range(fw):
                if f == 'front' and 10 <= x < 22 and y < 25: continue
                if (y >= 24 or f != 'front' or x < 6 or x > 25): a.set('head', f, x, y, '#2E2018' if (x + y) % 3 else '#3A2A1E')
    hose(b, schwarz, '#050507')
    schuhe(a, '#08080A', '#020202', 38, glanz='#3A3A44')
    return a.finish(0.03), b.finish(0.03)


def zwanziger():
    a, b = Tex(), Tex()
    tweed, weste = '#3A3A3E', '#2A2A2E'
    jacke(a, tweed)
    for f in SIDES:
        fw, fh = a.face_size('body', f)
        for y in range(fh):
            for x in range(fw):
                if (x + y) % 4 == 0 and a.get('body', f, x, y)[3]: a.set('body', f, x, y, '#46464A')
    hemd_v(a, weste, '#2E2E33', 26); hemd_v(a, '#F0F0EA', None, 10)
    knoepfe(a, '#8A8A8A', xs=(15,), ys=(14, 19, 24))
    a.rect('body', 'front', 9, 22, 13, 23, '#C8B070')  # Uhrkette
    hutform(a, '#3E3E42', 6); a.rect('head', 'front', 0, 6, 32, 9, '#343438')  # Schiebermütze
    hose(b, tweed, '#1A1A1A')
    schuhe(a, '#2A1A10', '#120A05', 26); a.band('leg', 26, 28, '#1A1008')
    return a.finish(), b.finish()


OUTFITS = {
    'smoking': smoking, 'nadelstreifen': nadelstreifen, 'gold_vip': gold_vip, 'trainingsanzug': trainingsanzug,
    'hoodie': hoodie, 'biker': biker, 'polizei': polizei, 'swat': swat, 'feuerwehr': feuerwehr,
    'sanitaeter': sanitaeter, 'mechaniker': mechaniker, 'koch': koch, 'pirat': pirat,
    'weisser_anzug': weisser_anzug, 'schwarzer_anzug': schwarzer_anzug, 'zwanziger': zwanziger,
}


# ------------------------------------------------------------------ Kopfbedeckungen (nur Kopf)

def kopf(fn):
    t = Tex(); fn(t); return t.finish(0.04)


def cowboyhut(t):
    hutform(t, '#7A5A3A', 10, band='#3A2414', krempe='#6A4A2E'); t.rect('head', 'top', 12, 8, 20, 24, '#6A4A2E')


def cap_rueck(t):
    hutform(t, '#B3261E', 8); t.rect('head', 'back', 0, 8, 32, 12, '#8A1A14'); t.rect('head', 'back', 12, 4, 20, 8, (0, 0, 0, 0))


def bandana(t):
    for f in SIDES:
        fw, _ = t.face_size('head', f); t.rect('head', f, 0, 18, fw, 32, '#9A1F1F')
        for x in range(1, fw, 5):
            for y in (21, 27): t.set('head', f, x, y, '#EDEDED'); t.set('head', f, x + 1, y + 1, '#EDEDED')
    t.rect('head', 'front', 0, 18, 32, 19, '#7A1414')


def sturmhaube(t):
    t.fill('head', '#121214'); t.clear('head', 'front', 4, 12, 28, 18); t.rect('head', 'front', 4, 18, 28, 19, '#1E1E22')


def krone(t):
    gold = '#E6B422'
    t.band('head', 0, 8, gold)
    for f in SIDES:
        fw, _ = t.face_size('head', f)
        for x in range(0, fw, 8): t.clear('head', f, x + 2, 0, x + 6, 3)
    for x, c in ((6, '#C8102E'), (14, '#1F5AC8'), (22, '#2E9A3A')): t.rect('head', 'front', x, 4, x + 4, 7, c)
    t.rect('head', 'top', 0, 0, 32, 3, gold); t.rect('head', 'top', 0, 29, 32, 32, gold); t.rect('head', 'top', 0, 0, 3, 32, gold); t.rect('head', 'top', 29, 0, 32, 32, gold)


def wikinger(t):
    eisen = '#8A8E94'
    hutform(t, eisen, 12, band='#5A4A3A'); t.rect('head', 'front', 14, 12, 18, 22, eisen)
    for f in ('right', 'left'):
        for i in range(6): t.rect('head', f, 10 + i, 6 - i, 22 - i, 7 - i, '#E8E0C8')
        for y in range(0, 8): t.rect('head', f, 14, y, 18, y + 1, '#E8E0C8')


def samurai(t):
    lack, gold = '#5A1414', '#D4AF37'
    hutform(t, lack, 10)
    for f in ('right', 'left', 'back'):
        fw, _ = t.face_size('head', f)
        t.rect('head', f, 0, 10, fw, 24, shade(lack, 0.85))
        for y in (14, 18, 22): t.rect('head', f, 0, y, fw, y + 1, '#2A0A0A')
    for i in range(6): t.rect('head', 'front', 10 + i, 6 - i, 12 + i, 8 - i, gold); t.rect('head', 'front', 20 - i, 6 - i, 22 - i, 8 - i, gold)


def gasmaske(t):
    gummi = '#2E3230'
    t.rect('head', 'front', 2, 8, 30, 30, gummi)
    for x in (4, 18): t.rect('head', 'front', x, 10, x + 10, 18, '#1A1A1A'); t.rect('head', 'front', x + 1, 11, x + 9, 17, '#5A7A70')
    t.rect('head', 'front', 11, 22, 21, 30, '#4A4E4C'); t.rect('head', 'front', 13, 24, 19, 28, '#2A2A2A')
    for f in ('right', 'left', 'back'): fw, _ = t.face_size('head', f); t.rect('head', f, 0, 12, fw, 15, '#1E1E1E')


def venezianisch(t):
    gold = '#D4AF37'
    t.rect('head', 'front', 2, 10, 30, 20, gold)
    for x in (6, 19): t.clear('head', 'front', x, 13, x + 7, 17)
    for x in range(3, 30, 4): t.set('head', 'front', x, 11, '#8E1F4A'); t.set('head', 'front', x + 1, 19, '#8E1F4A')
    for y in range(0, 12): t.rect('head', 'right', 20 + y // 3, y, 24 + y // 3, y + 1, '#C8507A')


def weihnachtsmuetze(t):
    hutform(t, '#C8102E', 10); t.band('head', 10, 14, '#F4F4F4')
    t.rect('head', 'top', 22, 22, 32, 32, '#F4F4F4'); t.rect('head', 'right', 0, 0, 6, 6, '#F4F4F4')


def hasenohren(t):
    t.band('head', 0, 3, '#F2F2F2')
    t.rect('head', 'top', 4, 10, 30, 14, '#F2F2F2')
    for x in (4, 20):
        t.rect('head', 'front', x, 0, x + 8, 3, '#F2F2F2'); t.rect('head', 'front', x + 2, 0, x + 6, 2, '#F4B8C8')
        t.rect('head', 'top', x, 0, x + 8, 14, '#F2F2F2'); t.rect('head', 'top', x + 2, 2, x + 6, 12, '#F4B8C8')


def heiligenschein(t):
    g = '#FFE680'
    t.rect('head', 'top', 2, 2, 30, 5, g); t.rect('head', 'top', 2, 27, 30, 30, g); t.rect('head', 'top', 2, 2, 5, 30, g); t.rect('head', 'top', 27, 2, 30, 30, g)


def teufelshoerner(t):
    rot = '#9A0F0F'
    t.band('head', 2, 4, '#2A0A0A')
    for x in (2, 24):
        for i in range(6): t.rect('head', 'front', x + i // 2, 6 - i, x + 6 - i // 2, 7 - i, rot)
        t.rect('head', 'top', x, 0, x + 6, 6, rot)


def astronaut(t):
    weiss = '#EDEDED'
    t.fill('head', weiss)
    t.rect('head', 'front', 3, 8, 29, 24, '#B8862A'); t.rect('head', 'front', 5, 10, 12, 12, '#F0D58A')
    t.rect('head', 'front', 2, 26, 30, 30, '#C8C8C8'); t.rect('head', 'right', 10, 12, 20, 22, '#C8C8C8')
    t.rect('head', 'top', 14, 0, 18, 32, '#1F3A8A')


KOPF = {
    'cowboyhut': cowboyhut, 'cap_rueckwaerts': cap_rueck, 'bandana': bandana, 'sturmhaube': sturmhaube,
    'krone': krone, 'wikingerhelm': wikinger, 'samurai_helm': samurai, 'gasmaske': gasmaske,
    'venezianische_maske': venezianisch, 'weihnachtsmuetze': weihnachtsmuetze, 'hasenohren': hasenohren,
    'heiligenschein': heiligenschein, 'teufelshoerner': teufelshoerner, 'astronautenhelm': astronaut,
}
