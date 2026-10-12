// Beispiele für das Menü „Beispiele“. Alle mit Customizer-Parametern.

export const EXAMPLES = [
  {
    id: 'box',
    title: 'Box mit Deckel',
    desc: 'Abgerundete Box – der Einstieg',
    icon: 'box',
    code: `// Willkommen bei Formwerk!
// Ändere Zahlen im Code oder rechts im Customizer – das Modell rendert automatisch.
// Tipp: ⌥/Alt gedrückt halten und über eine Zahl ziehen.

/* [Maße] */
breite = 60;      // [20:150]
tiefe = 40;       // [20:150]
hoehe = 30;       // [10:100]
wand = 2;         // [1:0.5:5]
radius = 6;       // [0:20]

/* [Deckel] */
mit_deckel = true;
spiel = 0.3;      // [0:0.05:1]

/* [Hidden] */
$fn = 48;

module abgerundet(b, t, h, r) {
  rr = max(0, min(r, b / 2 - 0.01, t / 2 - 0.01));
  if (rr <= 0) cube([b, t, h]);
  else hull() for (x = [rr, b - rr], y = [rr, t - rr]) translate([x, y, 0]) cylinder(r = rr, h = h);
}

// Unterteil
difference() {
  abgerundet(breite, tiefe, hoehe, radius);
  translate([wand, wand, wand]) abgerundet(breite - 2 * wand, tiefe - 2 * wand, hoehe, radius - wand);
}

// Deckel mit Steckrand
if (mit_deckel)
  translate([0, tiefe + 10, 0]) {
    abgerundet(breite, tiefe, wand, radius);
    rand = wand + spiel;
    translate([rand, rand, wand])
      difference() {
        abgerundet(breite - 2 * rand, tiefe - 2 * rand, 4, radius - rand);
        translate([wand, wand, -1]) abgerundet(breite - 2 * rand - 2 * wand, tiefe - 2 * rand - 2 * wand, 6, radius - rand - wand);
      }
  }
`,
  },
  {
    id: 'gear',
    title: 'Zahnrad',
    desc: 'Zähne, Bohrung und Aussparungen',
    icon: 'settings',
    code: `// Zahnrad mit trapezförmigen Zähnen
zaehne = 18;        // [6:60]
modul = 2;          // [0.5:0.25:5]
dicke = 6;          // [1:30]
bohrung = 5;        // [0:0.5:30]
fenster = 5;        // [0:8]

/* [Hidden] */
$fn = 96;
r_teil = modul * zaehne / 2;
r_kopf = r_teil + modul;
r_fuss = r_teil - 1.25 * modul;

module zahnrad_2d() {
  w = 360 / zaehne;
  union() {
    circle(r = r_fuss);
    polygon([for (i = [0 : zaehne - 1]) each [
      r_fuss * [cos(i * w - w * 0.30), sin(i * w - w * 0.30)],
      r_kopf * [cos(i * w - w * 0.12), sin(i * w - w * 0.12)],
      r_kopf * [cos(i * w + w * 0.12), sin(i * w + w * 0.12)],
      r_fuss * [cos(i * w + w * 0.30), sin(i * w + w * 0.30)]
    ]]);
  }
}

r_innen = bohrung / 2 + 2 * modul;
r_aussen = r_fuss - 1.5 * modul;

color("#38bdf8") difference() {
  linear_extrude(dicke) zahnrad_2d();
  translate([0, 0, -1]) cylinder(d = bohrung, h = dicke + 2);
  if (fenster > 0 && r_aussen - r_innen > 3)
    for (i = [0 : fenster - 1])
      rotate(i * 360 / fenster)
        translate([(r_innen + r_aussen) / 2, 0, -1])
          cylinder(r = (r_aussen - r_innen) / 2 * 0.85, h = dicke + 2);
}

echo(str("Teilkreis: ", 2 * r_teil, " mm, Kopfkreis: ", 2 * r_kopf, " mm"));
`,
  },
  {
    id: 'vase',
    title: 'Gedrehte Vase',
    desc: 'linear_extrude mit Drehung',
    icon: 'sparkles',
    code: `// Gedrehte Vase – ideal für den Vasenmodus im Slicer
hoehe = 120;      // [40:250]
radius = 30;      // [10:80]
wellen = 7;       // [3:12]
tiefe = 0.18;     // [0:0.01:0.4]
drehung = 120;    // [0:360]
oeffnung = 1.3;   // [0.5:0.05:2]

module profil() {
  n = wellen * 12;
  polygon([for (i = [0 : n - 1]) let(a = i * 360 / n)
    radius * (1 + tiefe * cos(a * wellen)) * [cos(a), sin(a)]]);
}

color("#ec4899")
  linear_extrude(height = hoehe, twist = drehung, scale = oeffnung, slices = 90)
    profil();
`,
  },
  {
    id: 'keychain',
    title: 'Schlüsselanhänger',
    desc: 'Text mit eingebauter Schrift',
    icon: 'link',
    code: `// Schlüsselanhänger mit Text – zweifarbig für den Multicolor-Druck (3MF)
beschriftung = "Formwerk";
schriftgroesse = 9;     // [4:20]
schrift = "Liberation Sans:style=Bold"; // [Liberation Sans:style=Bold, Liberation Sans, Liberation Serif:style=Bold, Liberation Mono:style=Bold]
dicke = 3;              // [1:0.5:6]
relief = 1.2;           // [0.4:0.2:3]
rand = 4;               // [2:10]

/* [Hidden] */
$fn = 64;
hoehe = schriftgroesse + 2 * rand;
laenge = len(beschriftung) * schriftgroesse * 0.75 + rand;

color("#8b5cf6") difference() {
  hull() {
    translate([0, 0, 0]) cylinder(d = hoehe, h = dicke);
    translate([laenge, 0, 0]) cylinder(d = hoehe, h = dicke);
  }
  translate([0, 0, -1]) cylinder(d = hoehe * 0.36, h = dicke + 2);
}

color("white")
  translate([hoehe * 0.42, 0, dicke - 0.01])
    linear_extrude(relief)
      text(beschriftung, size = schriftgroesse, font = schrift, valign = "center");
`,
  },
  {
    id: 'mug',
    title: 'Becher mit Henkel',
    desc: 'rotate_extrude aus einem Profil',
    icon: 'rotate',
    code: `// Becher – rotate_extrude macht aus einem 2D-Profil einen Drehkörper
hoehe = 90;       // [40:150]
radius = 38;      // [20:60]
wand = 2.4;       // [1:0.2:5]
boden = 3;        // [1:0.5:8]
henkel = true;

/* [Hidden] */
$fn = 96;
neigung = 6;

difference() {
  union() {
    color("#f8fafc")
      rotate_extrude() polygon([[0, 0], [radius, 0], [radius + neigung, hoehe], [0, hoehe]]);
    if (henkel)
      color("#f97316")
        translate([radius + neigung / 2, 0, hoehe / 2])
          rotate([90, 0, 0]) rotate([0, 0, -90])
            rotate_extrude(angle = 180)
              translate([hoehe * 0.27, 0]) circle(r = 4.5);
  }
  // Innenraum
  rotate_extrude()
    polygon([[0, boden], [radius - wand, boden], [radius + neigung - wand, hoehe + 1], [0, hoehe + 1]]);
}
`,
  },
  {
    id: 'colors',
    title: 'Farben & Schleifen',
    desc: 'for-Schleife, color() mit Alpha',
    icon: 'layers',
    code: `// Schleifen, Farben und Transparenz
anzahl = 16;      // [3:40]
radius = 40;      // [10:100]
welle = 2;        // [0:6]

$fn = 40;
for (i = [0 : anzahl - 1]) {
  a = i * 360 / anzahl;
  h = 12 + 10 * (1 + sin(a * welle));
  color([0.5 + 0.5 * cos(a), 0.5 + 0.5 * cos(a + 120), 0.5 + 0.5 * cos(a + 240)])
    translate([radius * cos(a), radius * sin(a), 0])
      cylinder(h = h, r = 2 * PI * radius / anzahl * 0.32);
}

// Halbtransparente Bodenplatte
color("white", 0.35)
  translate([0, 0, -3]) cylinder(h = 3, r = radius + 12);
`,
  },
  {
    id: 'star2d',
    title: '2D: Stern zum Lasern',
    desc: 'Export als SVG oder DXF',
    icon: 'sparkles',
    code: `// 2D-Design für Laserschneider oder Plotter – exportiere als SVG oder DXF
zacken = 7;          // [3:16]
aussen = 50;         // [10:120]
innen = 22;          // [5:100]
rundung = 2;         // [0:0.5:8]
loch = 6;            // [0:20]

$fn = 48;
difference() {
  offset(r = rundung) offset(delta = -rundung)
    polygon([for (i = [0 : 2 * zacken - 1])
      let(r = i % 2 == 0 ? aussen : innen, a = 90 + i * 180 / zacken)
        r * [cos(a), sin(a)]]);
  if (loch > 0) circle(d = loch);
}
`,
  },
  {
    id: 'bosl2',
    title: 'Bibliothek: BOSL2',
    desc: 'Wird automatisch nachgeladen',
    icon: 'package',
    code: `// Bibliotheken: BOSL2 wird beim ersten Rendern automatisch geladen (jsDelivr).
include <BOSL2/std.scad>

groesse = 40;   // [20:100]
rundung = 6;    // [0:15]
fase = 2;       // [0:0.5:6]

$fn = 64;

diff()
  cuboid([groesse, groesse, groesse / 2], rounding = rundung, edges = "Z", anchor = BOTTOM)
    tag("remove") position(TOP) cyl(d = groesse / 2, h = groesse / 3, anchor = TOP, chamfer2 = -fase);
`,
  },
  {
    id: 'empty',
    title: 'Leeres Projekt',
    desc: 'Mit einem Würfel starten',
    icon: 'filePlus',
    code: `// Neues Projekt
cube(20, center = true);
`,
  },
];
