// English versions of the examples (same ids as examples.js).

export const EXAMPLES_EN = {
  box: {
    title: 'Box with lid',
    desc: 'Rounded box – the starting point',
    code: `// Welcome to Formwerk!
// Change numbers in the code or in the customizer – the model renders automatically.
// Tip: hold ⌥/Alt and drag over a number.

/* [Size] */
width = 60;       // [20:150]
depth = 40;       // [20:150]
height = 30;      // [10:100]
wall = 2;         // [1:0.5:5]
radius = 6;       // [0:20]

/* [Lid] */
with_lid = true;
clearance = 0.3;  // [0:0.05:1]

/* [Hidden] */
$fn = 48;

module rounded(w, d, h, r) {
  rr = max(0, min(r, w / 2 - 0.01, d / 2 - 0.01));
  if (rr <= 0) cube([w, d, h]);
  else hull() for (x = [rr, w - rr], y = [rr, d - rr]) translate([x, y, 0]) cylinder(r = rr, h = h);
}

// Base
difference() {
  rounded(width, depth, height, radius);
  translate([wall, wall, wall]) rounded(width - 2 * wall, depth - 2 * wall, height, radius - wall);
}

// Lid with a plug-in rim
if (with_lid)
  translate([0, depth + 10, 0]) {
    rounded(width, depth, wall, radius);
    rim = wall + clearance;
    translate([rim, rim, wall])
      difference() {
        rounded(width - 2 * rim, depth - 2 * rim, 4, radius - rim);
        translate([wall, wall, -1]) rounded(width - 2 * rim - 2 * wall, depth - 2 * rim - 2 * wall, 6, radius - rim - wall);
      }
  }
`,
  },
  gear: {
    title: 'Gear',
    desc: 'Teeth, bore and cut-outs',
    code: `// Gear with trapezoidal teeth
teeth = 18;         // [6:60]
module_size = 2;    // [0.5:0.25:5]
thickness = 6;      // [1:30]
bore = 5;           // [0:0.5:30]
windows = 5;        // [0:8]

/* [Hidden] */
$fn = 96;
r_pitch = module_size * teeth / 2;
r_tip = r_pitch + module_size;
r_root = r_pitch - 1.25 * module_size;

module gear_2d() {
  w = 360 / teeth;
  union() {
    circle(r = r_root);
    polygon([for (i = [0 : teeth - 1]) each [
      r_root * [cos(i * w - w * 0.30), sin(i * w - w * 0.30)],
      r_tip * [cos(i * w - w * 0.12), sin(i * w - w * 0.12)],
      r_tip * [cos(i * w + w * 0.12), sin(i * w + w * 0.12)],
      r_root * [cos(i * w + w * 0.30), sin(i * w + w * 0.30)]
    ]]);
  }
}

r_inner = bore / 2 + 2 * module_size;
r_outer = r_root - 1.5 * module_size;

color("#38bdf8") difference() {
  linear_extrude(thickness) gear_2d();
  translate([0, 0, -1]) cylinder(d = bore, h = thickness + 2);
  if (windows > 0 && r_outer - r_inner > 3)
    for (i = [0 : windows - 1])
      rotate(i * 360 / windows)
        translate([(r_inner + r_outer) / 2, 0, -1])
          cylinder(r = (r_outer - r_inner) / 2 * 0.85, h = thickness + 2);
}

echo(str("Pitch diameter: ", 2 * r_pitch, " mm, tip diameter: ", 2 * r_tip, " mm"));
`,
  },
  vase: {
    title: 'Twisted vase',
    desc: 'linear_extrude with a twist',
    code: `// Twisted vase – perfect for the slicer's vase mode
height = 120;     // [40:250]
radius = 30;      // [10:80]
waves = 7;        // [3:12]
depth = 0.18;     // [0:0.01:0.4]
twist = 120;      // [0:360]
flare = 1.3;      // [0.5:0.05:2]

module profile() {
  n = waves * 12;
  polygon([for (i = [0 : n - 1]) let(a = i * 360 / n)
    radius * (1 + depth * cos(a * waves)) * [cos(a), sin(a)]]);
}

color("#ec4899")
  linear_extrude(height = height, twist = twist, scale = flare, slices = 90)
    profile();
`,
  },
  keychain: {
    title: 'Key chain',
    desc: 'Text with the built-in font',
    code: `// Key chain with text – two colors for multicolor printing (3MF)
label = "Formwerk";
font_size = 9;          // [4:20]
font = "Liberation Sans:style=Bold"; // [Liberation Sans:style=Bold, Liberation Sans, Liberation Serif:style=Bold, Liberation Mono:style=Bold]
thickness = 3;          // [1:0.5:6]
relief = 1.2;           // [0.4:0.2:3]
margin = 4;             // [2:10]

/* [Hidden] */
$fn = 64;
height = font_size + 2 * margin;
length = len(label) * font_size * 0.75 + margin;

color("#8b5cf6") difference() {
  hull() {
    translate([0, 0, 0]) cylinder(d = height, h = thickness);
    translate([length, 0, 0]) cylinder(d = height, h = thickness);
  }
  translate([0, 0, -1]) cylinder(d = height * 0.36, h = thickness + 2);
}

color("white")
  translate([height * 0.42, 0, thickness - 0.01])
    linear_extrude(relief)
      text(label, size = font_size, font = font, valign = "center");
`,
  },
  mug: {
    title: 'Mug with handle',
    desc: 'rotate_extrude from a profile',
    code: `// Mug – rotate_extrude turns a 2D profile into a solid of revolution
height = 90;      // [40:150]
radius = 38;      // [20:60]
wall = 2.4;       // [1:0.2:5]
bottom = 3;       // [1:0.5:8]
handle = true;

/* [Hidden] */
$fn = 96;
flare = 6;

difference() {
  union() {
    color("#f8fafc")
      rotate_extrude() polygon([[0, 0], [radius, 0], [radius + flare, height], [0, height]]);
    if (handle)
      color("#f97316")
        translate([radius + flare / 2, 0, height / 2])
          rotate([90, 0, 0]) rotate([0, 0, -90])
            rotate_extrude(angle = 180)
              translate([height * 0.27, 0]) circle(r = 4.5);
  }
  // Inside
  rotate_extrude()
    polygon([[0, bottom], [radius - wall, bottom], [radius + flare - wall, height + 1], [0, height + 1]]);
}
`,
  },
  colors: {
    title: 'Colors & loops',
    desc: 'for loop, color() with alpha',
    code: `// Loops, colors and transparency
count = 16;       // [3:40]
radius = 40;      // [10:100]
wave = 2;         // [0:6]

$fn = 40;
for (i = [0 : count - 1]) {
  a = i * 360 / count;
  h = 12 + 10 * (1 + sin(a * wave));
  color([0.5 + 0.5 * cos(a), 0.5 + 0.5 * cos(a + 120), 0.5 + 0.5 * cos(a + 240)])
    translate([radius * cos(a), radius * sin(a), 0])
      cylinder(h = h, r = 2 * PI * radius / count * 0.32);
}

// Semi-transparent base plate
color("white", 0.35)
  translate([0, 0, -3]) cylinder(h = 3, r = radius + 12);
`,
  },
  star2d: {
    title: '2D: star for laser cutting',
    desc: 'Export as SVG or DXF',
    code: `// 2D design for laser cutters or plotters – export as SVG or DXF
points = 7;          // [3:16]
outer = 50;          // [10:120]
inner = 22;          // [5:100]
rounding = 2;        // [0:0.5:8]
hole = 6;            // [0:20]

$fn = 48;
difference() {
  offset(r = rounding) offset(delta = -rounding)
    polygon([for (i = [0 : 2 * points - 1])
      let(r = i % 2 == 0 ? outer : inner, a = 90 + i * 180 / points)
        r * [cos(a), sin(a)]]);
  if (hole > 0) circle(d = hole);
}
`,
  },
  bosl2: {
    title: 'Library: BOSL2',
    desc: 'Loaded automatically',
    code: `// Libraries: BOSL2 is loaded automatically on the first render (jsDelivr).
include <BOSL2/std.scad>

size = 40;      // [20:100]
rounding = 6;   // [0:15]
chamfer = 2;    // [0:0.5:6]

$fn = 64;

diff()
  cuboid([size, size, size / 2], rounding = rounding, edges = "Z", anchor = BOTTOM)
    tag("remove") position(TOP) cyl(d = size / 2, h = size / 3, anchor = TOP, chamfer2 = -chamfer);
`,
  },
  empty: {
    title: 'Empty project',
    desc: 'Start with a cube',
    code: `// New project
cube(20, center = true);
`,
  },
};
