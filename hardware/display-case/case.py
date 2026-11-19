"""
A case that holds a location display (CYD, ESP32-2432S028R) and its tag reader (the red PN532 board) side by side.

Run it to write the files to print:

    pip install cadquery
    python case.py

Two parts, printed without supports:
  - shell: the front and sides. Print it face down. The screen looks through a window; the reader sits behind
    the plain panel beside it, under the ring. Both boards drop in from the back.
  - lid:   the back. Posts on it press the boards against the front. Four M3 x 12 screws go through it into
           the shell's corners.

Every size is a setting below. The boards' sizes are the commonly published ones, NOT measured from the boards
this is for: check the ones marked MEASURE with calipers, then print fit_test first (the front few millimetres
of the shell, a quarter of an hour of printing) and try both boards in it before printing the shell.

Positions are in millimetres, looking at the front: x to the right, y up, z towards the back.
"""

import cadquery as cq

# ---- The display board (CYD) -------------------------------------------------------------------
CYD_W = 86.0        # MEASURE: board width
CYD_H = 50.0        # MEASURE: board height
PCB_T = 1.6         # board thickness
LCD_H = 4.2         # MEASURE: from the board's front face to the front of the screen's glass
REAR_H = 8.5        # tallest part on the back of the board (the sockets), plus room for the plugs' wires
WINDOW_W = 59.0     # MEASURE: the part of the screen that lights up, plus a millimetre
WINDOW_H = 44.5
WINDOW_DX = 0.0     # MEASURE: how far the lit area's centre is right (+) or left (-) of the board's centre
WINDOW_DY = 0.0     # ... and above (+) or below (-) it
CYD_HOLE_INSET = 4.0  # the board's four mounting holes, from each edge: the lid's posts press here

# The USB socket is on one short edge of the board. The case puts that edge on the left, away from the reader.
USB_W = 13.5        # wide enough for the plug's moulded grip to pass through the wall
USB_DY = 0.0        # MEASURE: the socket's centre above (+) or below (-) the middle of that edge

# ---- The tag reader (red PN532 "NFC Module V3") --------------------------------------------------
PN_W = 42.7         # MEASURE
PN_H = 40.4         # MEASURE
PN_REAR_H = 3.0     # parts on the back of the reader that the lid's posts must clear around

# ---- The case -----------------------------------------------------------------------------------
CLEAR = 0.3         # gap around each board, for a printer's tolerance
WALL = 2.0
FRONT_T = 1.6       # also what the reader reads through: keep it under 2 mm
LID_T = 2.4
PAD = 7.0           # room at each end for the screw posts
GAP = 4.0           # between the two boards
CORNER_R = 3.0
BOSS_D = 7.0
PILOT_D = 2.8       # an M3 screw cuts its own thread in this
SCREW_D = 3.4       # an M3 screw passes through this
HEAD_D = 6.2        # recess for the screw's head in the lid
POST_D = 5.0
RAIL_T = 1.2
RAIL_H = 3.0
RING_D = 30.0       # the "tap here" ring on the front, over the reader's aerial
FIT_TEST_Z = 3.5    # how much of the shell's depth the fit test keeps

# ---- Worked out from the settings -----------------------------------------------------------------
DEPTH = LCD_H + PCB_T + REAR_H                      # inside, front to back
INNER_W = PAD + (CYD_W + 2 * CLEAR) + GAP + (PN_W + 2 * CLEAR) + PAD
INNER_H = CYD_H + 2 * CLEAR
CYD_X0 = PAD                                        # left edge of the display board's pocket
CYD_CX = CYD_X0 + CLEAR + CYD_W / 2
PN_X0 = CYD_X0 + CYD_W + 2 * CLEAR + GAP            # left edge of the reader's pocket
PN_CX = PN_X0 + CLEAR + PN_W / 2
MID_Y = INNER_H / 2
BOSSES = [(BOSS_D / 2, BOSS_D / 2), (BOSS_D / 2, INNER_H - BOSS_D / 2), (INNER_W - BOSS_D / 2, BOSS_D / 2), (INNER_W - BOSS_D / 2, INNER_H - BOSS_D / 2)]


def box(x0, y0, z0, w, h, d):
    """A block from its lowest corner."""
    return cq.Workplane("XY").box(w, h, d, centered=False).translate((x0, y0, z0))


def cylinder(x, y, z0, diameter, length):
    return cq.Workplane("XY").circle(diameter / 2).extrude(length).translate((x, y, z0))


def make_shell():
    outer = box(-WALL, -WALL, -FRONT_T, INNER_W + 2 * WALL, INNER_H + 2 * WALL, FRONT_T + DEPTH).edges("|Z").fillet(CORNER_R)
    shell = outer.cut(box(0, 0, 0, INNER_W, INNER_H, DEPTH))

    # Posts in the four corners for the lid's screws. They also stop the boards sliding towards the ends.
    for x, y in BOSSES:
        post = cylinder(x, y, 0, BOSS_D, DEPTH)
        # Square the post into its corner so there is no sliver of a gap behind it.
        corner = box(0 if x < INNER_W / 2 else INNER_W - BOSS_D / 2, 0 if y < MID_Y else INNER_H - BOSS_D / 2, 0, BOSS_D / 2, BOSS_D / 2, DEPTH)
        shell = shell.union(post).union(corner)
    for x, y in BOSSES:
        shell = shell.cut(cylinder(x, y, 1.0, PILOT_D, DEPTH))

    # A low wall between the boards: it keeps each in its own pocket, and the wires cross over it.
    shell = shell.union(box(PN_X0 - GAP, 0, 0, GAP, INNER_H, LCD_H + PCB_T - 0.4))
    # Rails above and below the reader, which is not as tall as the display board.
    pn_y0 = MID_Y - PN_H / 2 - CLEAR
    pn_y1 = MID_Y + PN_H / 2 + CLEAR
    shell = shell.union(box(PN_X0, pn_y0 - RAIL_T, 0, PN_W + 2 * CLEAR, RAIL_T, RAIL_H))
    shell = shell.union(box(PN_X0, pn_y1, 0, PN_W + 2 * CLEAR, RAIL_T, RAIL_H))

    # The window for the screen, widening towards the front so the bezel does not shade the edges.
    window = (
        cq.Workplane("XY")
        .workplane(offset=0.01)
        .rect(WINDOW_W, WINDOW_H)
        .workplane(offset=-FRONT_T - 0.02)
        .rect(WINDOW_W + 2 * FRONT_T, WINDOW_H + 2 * FRONT_T)
        .loft(combine=True)
        .translate((CYD_CX + WINDOW_DX, MID_Y + WINDOW_DY, 0))
    )
    shell = shell.cut(window)

    # A shallow ring on the front showing where to hold a spool.
    ring = cylinder(PN_CX, MID_Y, -FRONT_T - 0.01, RING_D, 0.41).cut(cylinder(PN_CX, MID_Y, -FRONT_T - 0.02, RING_D - 2.4, 0.5))
    shell = shell.cut(ring)

    # A notch in the left wall for the USB plug, open at the back so the cable drops in before the lid goes on.
    usb_z0 = LCD_H + PCB_T - 0.5
    shell = shell.cut(box(-WALL - 0.1, MID_Y + USB_DY - USB_W / 2, usb_z0, WALL + 0.2, USB_W, DEPTH - usb_z0 + 0.1))
    return shell


def make_lid():
    z0 = DEPTH
    lid = box(-WALL, -WALL, z0, INNER_W + 2 * WALL, INNER_H + 2 * WALL, LID_T).edges("|Z").fillet(CORNER_R)

    # Posts that press the display board against the front, on its four mounting holes.
    cyd_gap = REAR_H - 0.2
    for dx in (CYD_HOLE_INSET, CYD_W - CYD_HOLE_INSET):
        for dy in (CYD_HOLE_INSET, CYD_H - CYD_HOLE_INSET):
            lid = lid.union(cylinder(CYD_X0 + CLEAR + dx, CLEAR + dy, z0 - cyd_gap, POST_D, cyd_gap))
    # Two posts that press the reader against the front, at opposite corners where the board is bare.
    pn_gap = DEPTH - PCB_T - 0.2
    pn_y0 = MID_Y - PN_H / 2
    for dx, dy in ((3.5, PN_H - 3.5), (PN_W - 3.5, 3.5)):
        lid = lid.union(cylinder(PN_X0 + CLEAR + dx, pn_y0 + dy, z0 - pn_gap, POST_D, pn_gap))

    for x, y in BOSSES:
        lid = lid.cut(cylinder(x, y, z0 - 0.1, SCREW_D, LID_T + 0.2))
        lid = lid.cut(cylinder(x, y, z0 + LID_T - 1.4, HEAD_D, 1.5))
    return lid


def boards():
    """Stand-ins for the two boards, where the case holds them: used to check nothing collides."""
    cyd = box(CYD_X0 + CLEAR, CLEAR, LCD_H, CYD_W, CYD_H, PCB_T)
    reader = box(PN_X0 + CLEAR, MID_Y - PN_H / 2, 0, PN_W, PN_H, PCB_T)
    return cyd, reader


if __name__ == "__main__":
    shell = make_shell()
    lid = make_lid()
    fit_test = shell.intersect(box(-WALL - 1, -WALL - 1, -FRONT_T - 1, INNER_W + 2 * WALL + 2, INNER_H + 2 * WALL + 2, FRONT_T + 1 + FIT_TEST_Z))

    cyd, reader = boards()
    for name, board in (("display board", cyd), ("reader", reader)):
        for part_name, part in (("shell", shell), ("lid", lid)):
            clash = board.intersect(part).val().Volume()
            assert clash < 0.01, f"The {name} collides with the {part_name} ({clash:.2f} mm3)"
    assert shell.intersect(lid).val().Volume() < 0.01, "The lid collides with the shell"

    for name, part in (("shell", shell), ("lid", lid), ("fit_test", fit_test)):
        cq.exporters.export(part, f"{name}.stl", tolerance=0.02, angularTolerance=0.2)
        cq.exporters.export(part, f"{name}.step")
    size = shell.union(lid).val().BoundingBox()
    print(f"Outside: {size.xlen:.1f} x {size.ylen:.1f} x {size.zlen:.1f} mm")
    print(f"Inside depth {DEPTH:.1f} mm; screen window {WINDOW_W} x {WINDOW_H} mm")
