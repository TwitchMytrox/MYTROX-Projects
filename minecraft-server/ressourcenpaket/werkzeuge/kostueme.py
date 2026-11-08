"""23 eigene Kostüme (ersetzen die Filmfiguren-Kostüme)."""
from tex import *

LEER = (0, 0, 0, 0)


def kapuze(t, farbe, gesicht=None, augen=None, augen_y=14):
    """Kapuze über den ganzen Kopf, vorne Gesichtsöffnung (dunkel oder frei)."""
    t.fill('head', farbe, bottom=False)
    if gesicht is None: t.clear('head', 'front', 6, 6, 26, 32)
    else: t.rect('head', 'front', 6, 6, 26, 32, gesicht)
    t.rect('head', 'front', 4, 4, 28, 6, shade(farbe, 0.8))
    if augen:
        for x in (10, 18): t.rect('head', 'front', x, augen_y, x + 4, augen_y + 3, augen); t.rect('head', 'front', x + 1, augen_y + 1, x + 3, augen_y + 2, shade(augen, 1.4))


def vollhelm(t, farbe, visier, y0=12, y1=18, x0=4, x1=28):
    t.fill('head', farbe)
    t.rect('head', 'front', x0, y0, x1, y1, visier)
    t.rect('head', 'front', x0, y0, x1, y0 + 1, shade(visier, 1.3))
    for f in ('right', 'left'): t.rect('head', f, 4, y0 + 2, 28, y0 + 4, shade(farbe, 0.75))


def zerfetzt(t, part, unten=48, tiefe=4):
    """Ausgefranster Saum unten."""
    for f in SIDES:
        fw, _ = t.face_size(part, f)
        for x in range(fw):
            h = (hashlib.md5(f'{part}{f}{x}'.encode()).digest()[0] % (tiefe + 1))
            if (x // 2) % 2: t.clear(part, f, x, unten - h, x + 1, unten)


def rauten(t, part, a, b, y0=0, y1=48, groesse=6):
    for f in SIDES:
        fw, fh = t.face_size(part, f)
        for y in range(y0, min(y1, fh)):
            for x in range(fw):
                if not t.get(part, f, x, y)[3]: continue
                gx, gy = (x + groesse // 2) % groesse, y % groesse
                inner = abs(gx - groesse / 2) + abs(gy - groesse / 2) <= groesse / 2
                t.set(part, f, x, y, a if inner ^ ((x // groesse + y // groesse) % 2 == 0) else b)


def platten(t, part, farbe, fuge, schritt=12):
    for f in SIDES:
        fw, fh = t.face_size(part, f)
        for y in range(0, fh, schritt): t.rect(part, f, 0, y, fw, y + 1, fuge)


def robe_unten(b, farbe, saum=True):
    b.fill('body', farbe, 24, 48, top=False); b.fill('leg', farbe)
    if saum: zerfetzt(b, 'leg')


# ------------------------------------------------------------------ Horror

def schattenschnitter():
    a, b = Tex(), Tex()
    robe, dunkel, kette = '#2A2433', '#0A0A0E', '#A8A8B0'
    jacke(a, robe); kapuze(a, robe, dunkel, '#5CFF7A', 14)
    for i in range(30): a.rect('body', 'front', 2 + i * 28 // 30, 6 + i, 4 + i * 28 // 30, 7 + i, kette)
    a.rect('body', 'front', 14, 20, 18, 24, '#5CFF7A')
    zerfetzt(a, 'arm')
    robe_unten(b, robe)
    schuhe(a, '#141218', '#050505', 40)
    return a.finish(), b.finish()


def moorwanderer():
    a, b = Tex(), Tex()
    moos, braun = '#3E4A2A', '#4A3A24'
    jacke(a, moos); kapuze(a, '#2E3A20', '#141A0E', '#E8D44A', 15)
    for (x, y) in ((4, 10), (20, 18), (8, 30), (24, 36), (12, 42)): a.rect('body', 'front', x, y, x + 5, y + 3, '#2A3418')
    for (x, y) in ((2, 20), (9, 34)): a.rect('arm', 'front', x % 12, y, x % 12 + 4, y + 3, '#5A6A34')
    a.band('body', 34, 36, '#6A5A3A')
    for f in SIDES:
        fw, _ = a.face_size('head', f)
        for x in range(1, fw, 7): a.vline('head', f, x, 0, 6, '#5A4A2A')  # Wurzeln
    zerfetzt(a, 'arm'); zerfetzt(a, 'body')
    hose(b, braun); zerfetzt(b, 'leg')
    schuhe(a, '#3A2E1E', '#1E1810', 38)
    return a.finish(0.08), b.finish(0.08)


def untoter_waerter():
    a, b = Tex(), Tex()
    grau, haut = '#5A5E66', '#7A9A6A'
    jacke(a, grau); a.band('body', 0, 3, shade(grau, 0.8))
    for (x, y, w) in ((6, 20, 6), (20, 32, 5), (10, 40, 4)): a.rect('body', 'front', x, y, x + w, y + 3, haut)
    a.rect('arm', 'front', 4, 30, 12, 36, haut)
    a.rect('body', 'front', 21, 10, 25, 14, '#8A5A2A')  # rostiges Abzeichen
    t = a  # Gesicht
    t.rect('head', 'front', 0, 8, 32, 32, haut)
    for x in (8, 20): t.rect('head', 'front', x, 14, x + 5, 18, '#E8E8D0'); t.rect('head', 'front', x + 2, 15, x + 4, 17, '#9A1F1F')
    for x in range(10, 22, 2): t.set('head', 'front', x, 26, '#3A2A2A'); t.set('head', 'front', x + 1, 25, '#3A2A2A')
    t.rect('head', 'front', 4, 20, 5, 28, '#3A2A2A')
    for y in range(20, 28, 2): t.rect('head', 'front', 3, y, 6, y + 1, '#3A2A2A')
    for f in ('right', 'left', 'back'): fw, _ = t.face_size('head', f); t.rect('head', f, 0, 8, fw, 32, haut)
    hutform(a, '#3E4248', 8, band='#1A1A1A'); a.rect('head', 'front', 0, 8, 32, 10, '#1A1A1A')
    hose(b, grau, '#2A2A2A'); b.rect('leg', 'front', 4, 20, 12, 26, haut)
    schuhe(a, '#1A1A1A', '#050505', 36)
    return a.finish(0.07), b.finish(0.07)


def kuerbiskoenig():
    a, b = Tex(), Tex()
    gruen, orange = '#2E4A24', '#E07A1A'
    jacke(a, gruen); knoepfe(a, orange, ys=(14, 22, 30, 38))
    for f in SIDES:
        fw, fh = a.face_size('body', f)
        for y in range(0, fh, 5):
            x = (y * 3) % fw; a.rect('body', f, x, y, x + 3, y + 1, '#4A7A2E')
    a.band('arm', 0, 4, '#4A7A2E')
    hose(b, '#4A3420', '#1E1408', orange)
    schuhe(a, '#24381C', '#0E140A', 34)
    return a.finish(), b.finish()


def gaukler():
    a, b = Tex(), Tex()
    lila, schwarz, gold = '#5A1E7A', '#1A1020', '#E6B422'
    jacke(a, lila); rauten(a, 'body', lila, schwarz); rauten(a, 'arm', lila, schwarz)
    a.band('body', 0, 5, '#F2F2F2'); [a.rect('body', 'front', x, 5, x + 2, 7, '#F2F2F2') for x in range(0, 32, 4)]  # Halskrause
    a.band('arm', 44, 48, gold)
    hose(b, schwarz); rauten(b, 'leg', schwarz, lila); b.band('body', 28, 31, gold)
    schuhe(a, gold, '#8A6A10', 38)
    return a.finish(0.03), b.finish(0.03)


def seuchendoktor():
    a, b = Tex(), Tex()
    schwarz, leder = '#18181A', '#5A3A1E'
    jacke(a, schwarz); a.band('body', 0, 6, '#222226')
    a.band('body', 30, 33, leder)
    for x in (4, 22): a.rect('body', 'front', x, 33, x + 6, 39, leder); a.rect('body', 'front', x + 2, 34, x + 4, 35, '#C8B070')
    a.band('arm', 40, 48, leder)  # Handschuhe
    robe_unten(b, schwarz, saum=False); b.band('leg', 44, 48, '#101012')
    schuhe(a, leder, '#2A1A0E', 34)
    return a.finish(0.04), b.finish(0.04)


def vampirgraf():
    a, b = Tex(), Tex()
    schwarz, rot, blass = '#121014', '#8E0F1A', '#D8D4CE'
    jacke(a, schwarz)
    a.rect('body', 'front', 8, 6, 24, 34, rot)  # Weste
    a.rect('body', 'front', 12, 2, 20, 14, '#F2F2F2'); a.rect('body', 'front', 13, 14, 19, 18, '#E6E6E6')  # Jabot
    knoepfe(a, '#C8B070', xs=(15,), ys=(20, 26, 32))
    for f in ('right', 'left', 'back'): fw, _ = a.face_size('body', f); a.rect('body', f, 0, 0, fw, 6, rot)  # hoher Kragen
    a.fill('head', blass, 8, 32, top=False, bottom=False); a.fill('head', '#0E0E10', 0, 8, bottom=False)
    a.rect('head', 'front', 12, 8, 20, 11, '#0E0E10')  # Haaransatz-Spitze
    for x in (8, 20): a.rect('head', 'front', x, 15, x + 4, 18, '#C8102E')
    a.rect('head', 'front', 13, 24, 14, 27, '#F2F2F2'); a.rect('head', 'front', 18, 24, 19, 27, '#F2F2F2')
    hose(b, schwarz, '#050507')
    schuhe(a, '#08080A', '#020202', 38, glanz='#3A3A44')
    return a.finish(0.03), b.finish(0.03)


# ------------------------------------------------------------------ Sci-Fi

def leerenkaiser():
    a, b = Tex(), Tex()
    obsidian, lila = '#15121C', '#B04CFF'
    jacke(a, obsidian); platten(a, 'body', obsidian, '#0A0810'); platten(a, 'arm', obsidian, '#0A0810')
    for y in (10, 22, 34): a.rect('body', 'front', 4, y, 28, y + 1, lila)
    a.vline('body', 'front', 15, 4, 44, lila, 2); a.rect('body', 'front', 12, 14, 20, 20, lila); a.rect('body', 'front', 14, 16, 18, 18, '#F0D8FF')
    for f in SIDES: fw, _ = a.face_size('arm', f); a.rect('arm', f, 0, 20, fw, 21, lila)
    vollhelm(a, obsidian, lila, 13, 16)
    a.rect('head', 'top', 14, 0, 18, 32, lila)
    hose(b, obsidian, '#0A0810'); [b.vline('leg', f, 7, 0, 46, lila, 2) for f in ('right', 'left', 'front')]
    schuhe(a, '#0E0C14', '#050408', 32); a.band('leg', 32, 33, lila)
    return a.finish(0.03), b.finish(0.03)


def orbit_soldat():
    a, b = Tex(), Tex()
    stahl, orange = '#4A5868', '#E8782A'
    jacke(a, stahl); platten(a, 'body', stahl, '#323C48', 10); platten(a, 'arm', stahl, '#323C48', 10)
    a.rect('body', 'front', 4, 4, 12, 8, orange); a.rect('body', 'front', 20, 4, 28, 8, orange)
    a.text('body', 'back', 'O2', 8, orange)
    a.band('arm', 0, 3, orange)
    vollhelm(a, '#5A6878', '#F0A040', 12, 18)
    a.rect('head', 'right', 8, 6, 12, 10, orange)
    hose(b, stahl, '#28303A', orange); platten(b, 'leg', stahl, '#323C48', 10)
    schuhe(a, '#2A323C', '#14181E', 30); a.band('leg', 30, 32, orange)
    return a.finish(0.03), b.finish(0.03)


def sternenmoench():
    a, b = Tex(), Tex()
    tuerkis, gold, creme = '#2E6E6A', '#D4AF37', '#E8DCC0'
    jacke(a, tuerkis)
    for f in SIDES: fw, _ = a.face_size('body', f); [a.rect('body', f, x, 44, x + 2, 46, gold) for x in range(0, fw, 4)]
    for i in range(24): a.rect('body', 'front', 4 + i, 4 + i, 8 + i, 6 + i, creme)  # Schärpe
    kapuze(a, tuerkis)
    for f in ('right', 'left', 'back'): fw, _ = a.face_size('head', f); [a.set('head', f, x, 30, gold) for x in range(0, fw, 3)]
    hose(b, creme, gold)
    schuhe(a, '#7A5432', '#4A3018', 42)
    return a.finish(0.03), b.finish(0.03)


def cyborg_jaeger():
    a, b = Tex(), Tex()
    schwarz, chrom, rot = '#141416', '#B8BCC4', '#FF2A2A'
    jacke(a, schwarz)
    a.fill('arm', chrom, 0, 12, bottom=False); a.fill('arm', chrom, 28, 44, top=False, bottom=False)
    platten(a, 'arm', chrom, '#7A7E86', 4)
    a.rect('body', 'front', 4, 6, 28, 18, '#2A2A2E'); a.rect('body', 'front', 6, 8, 26, 9, chrom)
    a.fill('head', chrom, 0, 12, bottom=False); a.band('head', 12, 15, '#1A1A1A'); a.rect('head', 'front', 4, 12, 28, 15, rot)
    a.rect('head', 'front', 4, 13, 28, 14, '#FF8A8A')
    hose(b, schwarz, '#0A0A0A', chrom)
    for f in ('right', 'left'): b.rect('leg', f, 2, 10, 14, 22, chrom)
    schuhe(a, '#0E0E10', '#050505', 30); a.rect('leg', 'front', 0, 30, 16, 34, chrom)
    return a.finish(0.03), b.finish(0.03)


def neon_hacker():
    a, b = Tex(), Tex()
    schwarz, cyan, magenta = '#0E0E14', '#2AF0FF', '#FF2AD4'
    jacke(a, schwarz); mittelreissverschluss(a, '#2A2A34')
    a.rect('body', 'front', 2, 12, 12, 13, cyan); a.vline('body', 'front', 11, 12, 30, cyan); a.rect('body', 'front', 20, 24, 30, 25, magenta)
    for f in ('right', 'left'): a.vline('arm', f, 7, 0, 44, cyan)
    a.text('body', 'back', 'NEON', 12, magenta)
    a.rect('head', 'front', 2, 13, 30, 17, '#14141C'); a.rect('head', 'front', 3, 14, 29, 16, cyan)
    for f in ('right', 'left'): a.rect('head', f, 0, 13, 32, 15, '#14141C')
    hose(b, '#16161E', '#0A0A0E', magenta); [b.vline('leg', f, 7, 0, 46, magenta) for f in ('right', 'left')]
    schuhe(a, '#F2F2F2', cyan, 38)
    return a.finish(0.03), b.finish(0.03)


def strahlen_techniker():
    a, b = Tex(), Tex()
    gelb, schwarz = '#E8C81E', '#141414'
    jacke(a, gelb); a.band('arm', 40, 48, schwarz)
    for x in range(0, 32, 6):
        for i in range(4): a.rect('body', 'front', x + i, 30 + i, x + i + 3, 31 + i, schwarz)
    a.rect('body', 'front', 0, 28, 32, 29, schwarz); a.rect('body', 'front', 0, 34, 32, 35, schwarz)
    a.rect('body', 'back', 8, 8, 24, 26, '#9A9A9A'); a.rect('body', 'back', 10, 10, 22, 24, '#6A6A6A')  # Filter-Rucksack
    a.fill('head', gelb); a.rect('head', 'front', 4, 8, 28, 22, '#9AD4E8'); a.rect('head', 'front', 6, 10, 12, 12, '#E0F4FF')
    a.rect('head', 'front', 12, 24, 20, 30, schwarz)
    hose(b, gelb, schwarz)
    schuhe(a, schwarz, '#050505', 30)
    return a.finish(0.03), b.finish(0.03)


# ------------------------------------------------------------------ Helden

def nachtfalke():
    a, b = Tex(), Tex()
    navy, silber = '#1A2440', '#C8CCD8'
    jacke(a, navy); platten(a, 'body', navy, '#121A30', 16)
    for i in range(10):
        a.rect('body', 'front', 4 + i, 8 + i, 6 + i, 10 + i, silber); a.rect('body', 'front', 26 - i, 8 + i, 28 - i, 10 + i, silber)
    a.band('body', 34, 37, silber); a.band('arm', 34, 44, '#141C34')
    a.rect('head', 'front', 2, 10, 30, 19, navy); [a.rect('head', 'front', x, 13, x + 6, 16, silber) for x in (6, 20)]
    for f in ('right', 'left'): a.rect('head', f, 0, 10, 32, 19, navy)
    a.fill('head', navy, 0, 10, bottom=False)
    hose(b, navy, '#121A30', silber); [b.vline('leg', f, 7, 0, 46, silber, 2) for f in ('right', 'left')]
    schuhe(a, '#141C34', '#0A0E1A', 28); a.band('leg', 28, 30, silber)
    return a.finish(0.03), b.finish(0.03)


def sturmlaeufer():
    a, b = Tex(), Tex()
    teal, weiss = '#1E8A8A', '#F2F2F2'
    jacke(a, teal)
    pts = [(4, 6), (18, 18), (10, 22), (26, 40)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        for i in range(21):
            x = x0 + (x1 - x0) * i // 20; y = y0 + (y1 - y0) * i // 20; a.rect('body', 'front', x, y, x + 3, y + 2, weiss)
    for f in ('right', 'left'): a.vline('arm', f, 6, 0, 48, weiss, 2)
    a.fill('head', teal, 0, 32, bottom=False); a.clear('head', 'front', 6, 18, 26, 32)
    a.rect('head', 'front', 4, 11, 28, 17, weiss); a.rect('head', 'front', 6, 12, 26, 16, '#9AE8E8')
    hose(b, teal, '#126464'); [b.vline('leg', f, 6, 0, 46, weiss, 2) for f in ('right', 'left')]
    schuhe(a, weiss, '#9AE8E8', 34)
    return a.finish(0.03), b.finish(0.03)


def titan_panzer():
    a, b = Tex(), Tex()
    bronze, gruen = '#8A6A3A', '#3CFF8A'
    jacke(a, bronze); platten(a, 'body', bronze, '#5A4424', 8); platten(a, 'arm', bronze, '#5A4424', 8)
    for y, w in ((12, 4), (14, 8), (16, 10), (18, 10), (20, 8), (22, 4)): a.rect('body', 'front', 16 - w // 2, y, 16 + w // 2, y + 2, gruen)
    a.rect('body', 'front', 14, 15, 18, 21, '#C8FFE0')
    vollhelm(a, bronze, gruen, 12, 16, 6, 26)
    a.rect('head', 'top', 6, 6, 26, 26, '#6A4E28')
    hose(b, bronze, '#5A4424', gruen); platten(b, 'leg', bronze, '#5A4424', 8)
    schuhe(a, '#6A4E28', '#3A2A14', 30); a.band('leg', 30, 31, gruen)
    return a.finish(0.04), b.finish(0.04)


def phoenix_waechter():
    a, b = Tex(), Tex()
    rot, gold, orange = '#B83A1A', '#E6B422', '#F08A2A'
    jacke(a, rot)
    for i in range(8):
        a.rect('body', 'front', 8 + i, 10 + i * 2, 10 + i, 12 + i * 2, gold); a.rect('body', 'front', 22 - i, 10 + i * 2, 24 - i, 12 + i * 2, gold)
    for f in SIDES:
        fw, _ = a.face_size('arm', f)
        for x in range(0, fw, 4): a.rect('arm', f, x, 40 - (x % 8), x + 2, 48, orange)
    a.fill('head', gold, 0, 10, bottom=False); a.rect('head', 'front', 0, 10, 32, 12, gold)
    for x in range(10, 22, 3): a.rect('head', 'front', x, 0, x + 2, 6, orange)
    a.rect('head', 'top', 14, 0, 18, 32, orange)
    hose(b, rot, gold); [b.rect('leg', f, 0, 36, 16, 38, gold) for f in SIDES]
    schuhe(a, gold, '#8A6A10', 34)
    return a.finish(0.03), b.finish(0.03)


def schattenninja():
    a, b = Tex(), Tex()
    grau, rot = '#2A2A30', '#B3261E'
    jacke(a, grau)
    for f in SIDES: fw, _ = a.face_size('arm', f); [a.rect('arm', f, 0, y, fw, y + 1, '#1E1E24') for y in range(24, 44, 3)]
    a.band('body', 0, 6, rot); a.rect('body', 'back', 18, 6, 24, 28, rot)  # Schal
    a.band('body', 30, 33, '#1A1A1E')
    a.fill('head', grau); a.clear('head', 'front', 6, 13, 26, 18); a.band('head', 6, 9, rot)
    a.rect('head', 'back', 20, 9, 26, 20, rot)
    hose(b, grau, '#1A1A1E')
    for f in SIDES: fw, _ = b.face_size('leg', f); [b.rect('leg', f, 0, y, fw, y + 1, '#1E1E24') for y in range(30, 46, 3)]
    schuhe(a, '#1A1A1E', '#0A0A0C', 36)
    return a.finish(0.03), b.finish(0.03)


# ------------------------------------------------------------------ Fantasy

def akademie_magier():
    a, b = Tex(), Tex()
    lila, silber = '#3A2466', '#D8DCE8'
    jacke(a, lila)
    for (x, y) in ((4, 8), (22, 14), (10, 26), (26, 34), (6, 40), (18, 42)):
        a.set('body', 'front', x, y, silber); a.set('body', 'front', x + 1, y, silber); a.set('body', 'front', x, y + 1, silber)
    a.rect('body', 'back', 10, 10, 20, 20, silber); a.rect('body', 'back', 13, 10, 22, 18, lila)  # Mond
    a.band('arm', 40, 48, '#2A1A4A'); a.band('arm', 40, 41, silber)
    robe_unten(b, lila, saum=False); b.band('leg', 44, 46, silber)
    schuhe(a, '#2A1A4A', '#140A24', 40)
    return a.finish(0.03), b.finish(0.03)


def druide():
    a, b = Tex(), Tex()
    gruen, braun = '#4A5A2E', '#5A4024'
    jacke(a, gruen)
    for f in SIDES:
        fw, fh = a.face_size('body', f)
        for y in range(4, fh, 7):
            for x in range((y // 7) % 2 * 4, fw, 8): a.rect('body', f, x, y, x + 3, y + 2, '#6A8A3A'); a.set('body', f, x + 1, y + 2, '#3A4A22')
    a.band('body', 28, 30, '#C8B070')
    robe_unten(b, braun)
    schuhe(a, braun, '#2A1E10', 36); [a.band('leg', y, y + 1, '#C8B070') for y in (38, 42)]
    return a.finish(0.05), b.finish(0.05)


def wuestenforscher():
    a, b = Tex(), Tex()
    khaki, braun = '#C8B07A', '#5A3A1E'
    jacke(a, khaki, aermel=khaki); a.band('arm', 20, 48, LEER)  # kurze Ärmel
    a.clear('arm', 'top', 0, 0, 16, 16) if False else None
    for x in (4, 20): a.rect('body', 'front', x, 10, x + 8, 18, shade(khaki, 0.88)); a.rect('body', 'front', x, 10, x + 8, 11, shade(khaki, 0.7))
    a.rect('body', 'front', 0, 0, 32, 3, shade(khaki, 0.85)); knoepfe(a, braun, ys=(8, 16, 24, 32, 40))
    hose(b, '#A89060', braun, '#C8B070'); [b.rect('leg', 'front', 2, 18, 14, 26, shade('#A89060', 0.88)) for _ in (0,)]
    schuhe(a, braun, '#2A1A0E', 28); a.band('leg', 28, 30, '#3A2414')
    return a.finish(), b.finish()


# ------------------------------------------------------------------ Gangster

def casino_boss():
    a, b = Tex(), Tex()
    bordeaux, gold = '#5A0E1E', '#E6B422'
    jacke(a, bordeaux); hemd_v(a, '#0E0E10', '#3A0812', 22); krawatte(a, gold)
    a.rect('body', 'front', 22, 9, 26, 13, gold); a.rect('body', 'front', 23, 10, 25, 12, '#C8102E')
    for x in range(6, 26, 2): a.set('body', 'front', x, 36 + abs(16 - x) // 4, gold)
    hutform(a, '#141416', 10, band=bordeaux, krempe='#0E0E10')
    hose(b, bordeaux, '#0E0E10', gold)
    schuhe(a, '#0A0A0C', '#020202', 38, glanz='#3A3A44')
    return a.finish(0.03), b.finish(0.03)


def tresorknacker():
    a, b = Tex(), Tex()
    jacke(a, '#F0F0F0')
    for p in ('body', 'arm'): [a.band(p, y, y + 3, '#141414') for y in range(0, 48, 6)]
    a.rect('body', 'back', 8, 10, 24, 28, '#8A6A3A'); a.text('body', 'back', 'S', 15, '#F0F0F0')  # Beutel
    a.fill('head', '#1A1A1A', 0, 9, bottom=False); a.band('head', 6, 9, '#2A2A2A')
    a.rect('head', 'front', 2, 13, 30, 18, '#0A0A0A'); [a.clear('head', 'front', x, 14, x + 5, 17) for x in (8, 19)]
    for f in ('right', 'left', 'back'): fw, _ = a.face_size('head', f); a.rect('head', f, 0, 13, fw, 16, '#0A0A0A')
    hose(b, '#141414', '#0A0A0A')
    schuhe(a, '#0E0E0E', '#050505', 38)
    return a.finish(0.03), b.finish(0.03)


KOSTUEME = {
    'schattenschnitter': schattenschnitter, 'moorwanderer': moorwanderer, 'untoter_waerter': untoter_waerter,
    'kuerbiskoenig': kuerbiskoenig, 'gaukler': gaukler, 'seuchendoktor': seuchendoktor, 'vampirgraf': vampirgraf,
    'leerenkaiser': leerenkaiser, 'orbit_soldat': orbit_soldat, 'sternenmoench': sternenmoench, 'cyborg_jaeger': cyborg_jaeger,
    'neon_hacker': neon_hacker, 'strahlen_techniker': strahlen_techniker,
    'nachtfalke': nachtfalke, 'sturmlaeufer': sturmlaeufer, 'titan_panzer': titan_panzer, 'phoenix_waechter': phoenix_waechter,
    'schattenninja': schattenninja, 'akademie_magier': akademie_magier, 'druide': druide, 'wuestenforscher': wuestenforscher,
    'casino_boss': casino_boss, 'tresorknacker': tresorknacker,
}
