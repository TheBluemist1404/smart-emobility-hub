"""Build the "Working demonstration" section of the final report (docx).

Usage (from mvp/):  python -I -B report/build_demo_docx.py  [out.docx]

Writes report/asmt-4-demo.docx. Styles come from report/style-template.docx (a copy of
sub3-design/tools/style-template.docx), and the builder follows sub3-design/tools/build_sub3_docx.py,
so the output matches the Sub3 design document. Screenshots are read from screenshots/.
The test table is counted from the test names in tests/*.test.ts; the test result line is the
result of the last `npm test` run and is set in TEST_RUN below.
"""
import copy
import glob
import os
import re
import sys
from collections import Counter

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import docx_xml_helpers as h  # noqa: E402

MVP = os.path.dirname(HERE)
SHOTS = os.path.join(MVP, "screenshots")
TEXT_W_IN = 7.0
FULL_MAX_H_IN = 7.9      # console figure, leaves room for its caption and text on the page
PHONE_W_IN = 2.45        # two phone screens side by side
TOTAL_TW = 10080         # 7 in in twips
TEST_RUN = ("Result of `npm test` on 24/11/2026 (Vitest 2.1.9, Node 24): 5 test files, "
            "63 tests, 63 passed, 0 failed, in about 2.4 s.")

INLINE = re.compile(r"(`[^`]+`|\*\*[^*]+\*\*)")


class Builder:
    def __init__(self, template):
        self.doc = Document(template)
        paras = self.doc.paragraphs
        pick = lambda f: h.clone_para(next(p._p for p in paras if f(p)))  # noqa: E731
        self.tpl = {"title": pick(lambda p: p.style.name == "Title"),
                    "subtitle": pick(lambda p: p.style.name == "Subtitle"),
                    "h1": pick(lambda p: p.style.name == "Heading 1"),
                    "h2": pick(lambda p: p.style.name == "Heading 2"),
                    "h3": pick(lambda p: p.style.name == "Heading 3"),
                    "body": pick(lambda p: p.style.name == "normal" and len(p.text) > 80),
                    "caption": pick(lambda p: p.text.startswith("Figure 1."))}
        first = next(r for r in self.tpl["body"].iter(qn("w:r")) if r.find(qn("w:t")) is not None)
        self.rpr = first.find(qn("w:rPr"))
        self.body = self.doc.element.body
        for el in list(self.body):
            if el.tag != qn("w:sectPr"):
                self.body.remove(el)
        self.setup_page()
        self.figures = []      # (number, file, width in inches)
        self.sec = 0
        self.fig_no = 0

    # ---- low level -------------------------------------------------------------------------
    def add(self, el):
        self.body.insert(len(self.body) - 1, el)
        return el

    def run(self, p_el, text, code=False, bold=False, italic=False, size=None):
        r = p_el.makeelement(qn("w:r"), {})
        rpr = copy.deepcopy(self.rpr) if self.rpr is not None else r.makeelement(qn("w:rPr"), {})
        if code:
            for old in rpr.findall(qn("w:rFonts")):
                rpr.remove(old)
            rpr.insert(0, rpr.makeelement(qn("w:rFonts"),
                                          {qn(f"w:{a}"): "Consolas" for a in ("ascii", "hAnsi", "cs")}))
        if bold:
            rpr.append(rpr.makeelement(qn("w:b"), {}))
        if italic:
            rpr.append(rpr.makeelement(qn("w:i"), {}))
        sz = size if size is not None else (self.code_size(rpr) if code else None)
        if sz is not None:
            for tag in ("w:sz", "w:szCs"):
                for old in rpr.findall(qn(tag)):
                    rpr.remove(old)
                rpr.append(rpr.makeelement(qn(tag), {qn("w:val"): str(sz)}))
        r.append(rpr)
        t = r.makeelement(qn("w:t"), {})
        t.text = text
        t.set(h.XML_SPACE, "preserve")
        r.append(t)
        p_el.append(r)

    def code_size(self, rpr):
        el = rpr.find(qn("w:sz"))
        base = int(el.get(qn("w:val"))) if el is not None else 22
        return max(base - 2, 16)

    def inline(self, p_el, text, size=None, bold=False):
        for part in INLINE.split(text):
            if not part:
                continue
            if part.startswith("`") and part.endswith("`") and len(part) > 1:
                self.run(p_el, part[1:-1], code=True, bold=bold,
                         size=None if size is None else max(size - 2, 14))
            elif part.startswith("**") and part.endswith("**"):
                self.run(p_el, part[2:-2], bold=True, size=size)
            else:
                self.run(p_el, part, bold=bold, size=size)

    @staticmethod
    def ppr_of(p):
        ppr = p.find(qn("w:pPr"))
        if ppr is None:
            ppr = p.makeelement(qn("w:pPr"), {})
            p.insert(0, ppr)
        return ppr

    def spacing(self, p, before=0, after=120):
        ppr = self.ppr_of(p)
        for old in ppr.findall(qn("w:spacing")):
            ppr.remove(old)
        ppr.append(ppr.makeelement(qn("w:spacing"), {qn("w:before"): str(before), qn("w:after"): str(after)}))

    def para(self, text, indent_in=None, keep_next=False, size=None, after=120):
        p = h.blank_like(self.tpl["body"])
        self.inline(p, text, size=size)
        self.spacing(p, 0, 40 if indent_in else after)
        ppr = self.ppr_of(p)
        if indent_in is not None:
            ppr.append(ppr.makeelement(qn("w:ind"), {qn("w:left"): str(int(indent_in * 1440)),
                                                     qn("w:hanging"): "220"}))
        if keep_next:
            ppr.append(ppr.makeelement(qn("w:keepNext"), {}))
        return self.add(p)

    def bullets(self, items):
        for it in items:
            self.para("• " + it, indent_in=0.3)
        self.add(h.blank_like(self.tpl["body"]))

    def heading(self, level, text):
        el = h.clone_para(self.tpl[level], text.replace("`", ""))
        ppr = self.ppr_of(el)
        if ppr.find(qn("w:keepNext")) is None:
            ppr.append(ppr.makeelement(qn("w:keepNext"), {}))
        return self.add(el)

    def section(self, title):
        self.sec += 1
        self.fig_no = 0
        el = self.heading("h1", f"{self.sec}. {title}")
        if self.sec > 1:
            h.page_break_before(el)

    def code_block(self, lines):
        for ln in lines:
            p = h.blank_like(self.tpl["body"])
            ppr = self.ppr_of(p)
            ppr.append(ppr.makeelement(qn("w:spacing"), {qn("w:before"): "0", qn("w:after"): "0",
                                                         qn("w:line"): "240", qn("w:lineRule"): "auto"}))
            ppr.append(ppr.makeelement(qn("w:ind"), {qn("w:left"): "360"}))
            ppr.append(ppr.makeelement(qn("w:keepNext"), {}))
            self.run(p, ln.rstrip() or " ", code=True, size=17)
            self.add(p)
        self.add(h.blank_like(self.tpl["body"]))

    def borders(self, tblpr, val):
        b = tblpr.makeelement(qn("w:tblBorders"), {})
        for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
            attrs = {qn("w:val"): val}
            if val != "nil":
                attrs.update({qn("w:sz"): "4", qn("w:color"): "808080"})
            b.append(b.makeelement(qn(f"w:{side}"), attrs))
        tblpr.append(b)

    def table(self, rows, widths):
        """rows[0] is the header; widths are relative column widths."""
        ncol = len(rows[0])
        tw = [int(TOTAL_TW * w / sum(widths)) for w in widths]
        t = self.doc.add_table(rows=len(rows), cols=ncol)
        tblpr = t._tbl.tblPr
        self.borders(tblpr, "single")
        tblpr.append(tblpr.makeelement(qn("w:tblW"), {qn("w:w"): str(TOTAL_TW), qn("w:type"): "dxa"}))
        tblpr.append(tblpr.makeelement(qn("w:tblLayout"), {qn("w:type"): "fixed"}))
        for col, w in zip(t._tbl.tblGrid.findall(qn("w:gridCol")), tw):
            col.set(qn("w:w"), str(w))
        for r, values in enumerate(rows):
            tr = t.rows[r]._tr
            trpr = tr.get_or_add_trPr()
            trpr.append(trpr.makeelement(qn("w:cantSplit"), {}))
            if r == 0:
                trpr.append(trpr.makeelement(qn("w:tblHeader"), {}))
            for c, value in enumerate(values):
                cell = t.rows[r].cells[c]
                tcpr = cell._tc.get_or_add_tcPr()
                tcpr.append(tcpr.makeelement(qn("w:tcW"), {qn("w:w"): str(tw[c]), qn("w:type"): "dxa"}))
                if r == 0:
                    h.shade_cell(cell._tc, "D9E2F3")
                p = cell.paragraphs[0]._p
                ppr = p.get_or_add_pPr()
                ppr.append(ppr.makeelement(qn("w:spacing"), {qn("w:before"): "20", qn("w:after"): "20",
                                                             qn("w:line"): "240", qn("w:lineRule"): "auto"}))
                self.inline(p, value, size=18, bold=(r == 0))
        el = t._tbl
        el.getparent().remove(el)
        self.add(el)
        self.add(h.blank_like(self.tpl["body"]))

    # ---- figures ---------------------------------------------------------------------------
    def next_number(self):
        self.fig_no += 1
        return f"{self.sec}.{self.fig_no}"

    def picture_para(self, png, width_in):
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.keep_with_next = True
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(2)
        p.add_run().add_picture(png, width=Inches(width_in))
        el = p._p
        el.getparent().remove(el)
        return el

    def caption_para(self, number, caption, keep_next=True):
        cap = h.clone_para(self.tpl["caption"], f"Figure {number} – {caption}")
        ppr = self.ppr_of(cap)
        ppr.append(ppr.makeelement(qn("w:jc"), {qn("w:val"): "center"}))
        if keep_next:
            ppr.append(ppr.makeelement(qn("w:keepNext"), {}))
        for rpr in cap.iter(qn("w:rPr")):
            for tag in ("w:sz", "w:szCs"):
                e = rpr.find(qn(tag))
                if e is None:
                    e = rpr.makeelement(qn(tag), {})
                    rpr.append(e)
                e.set(qn("w:val"), "18")
        return cap

    def shot(self, name):
        path = os.path.join(SHOTS, name)
        if not os.path.exists(path):
            raise SystemExit(f"missing screenshot {name}")
        return path

    def figure_full(self, name, caption, text):
        """A console or stage screenshot at full text width (or less, if it is tall)."""
        png = self.shot(name)
        w, ht = Image.open(png).size
        width = min(TEXT_W_IN, FULL_MAX_H_IN * w / ht)
        num = self.next_number()
        self.add(self.picture_para(png, width))
        self.add(self.caption_para(num, caption))
        d = self.para(text, after=200)
        self.ppr_of(d).append(d.makeelement(qn("w:keepLines"), {}))
        self.figures.append((num, name, round(width, 2)))

    def figure_phones(self, items):
        """One or two phone screenshots side by side; each with caption and text below."""
        n = len(items)
        tw = TOTAL_TW // 2
        t = self.doc.add_table(rows=1, cols=n)
        tblpr = t._tbl.tblPr
        self.borders(tblpr, "nil")
        tblpr.append(tblpr.makeelement(qn("w:tblW"), {qn("w:w"): str(tw * n), qn("w:type"): "dxa"}))
        tblpr.append(tblpr.makeelement(qn("w:jc"), {qn("w:val"): "center"}))
        tblpr.append(tblpr.makeelement(qn("w:tblLayout"), {qn("w:type"): "fixed"}))
        for col in t._tbl.tblGrid.findall(qn("w:gridCol")):
            col.set(qn("w:w"), str(tw))
        trpr = t.rows[0]._tr.get_or_add_trPr()
        trpr.append(trpr.makeelement(qn("w:cantSplit"), {}))
        for c, (name, caption, text) in enumerate(items):
            cell = t.rows[0].cells[c]
            tc = cell._tc
            tcpr = tc.get_or_add_tcPr()
            tcpr.append(tcpr.makeelement(qn("w:tcW"), {qn("w:w"): str(tw), qn("w:type"): "dxa"}))
            for p in tc.findall(qn("w:p")):
                tc.remove(p)
            num = self.next_number()
            tc.append(self.picture_para(self.shot(name), PHONE_W_IN))
            tc.append(self.caption_para(num, caption))
            d = h.blank_like(self.tpl["body"])
            self.inline(d, text, size=19)
            self.spacing(d, 0, 60)
            tc.append(d)
            self.figures.append((num, name, PHONE_W_IN))
        el = t._tbl
        el.getparent().remove(el)
        self.add(el)
        self.add(h.blank_like(self.tpl["body"]))

    def setup_page(self):
        for s in self.doc.sections:
            s.page_width, s.page_height = Inches(8.5), Inches(11)
            s.left_margin = s.right_margin = Inches(0.75)
            s.top_margin = s.bottom_margin = Inches(0.6)
            s.header_distance = s.footer_distance = Inches(0.3)
            fp = s.footer.paragraphs[0]
            fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            fld = fp._p.makeelement(qn("w:fldSimple"), {qn("w:instr"): "PAGE"})
            run = fld.makeelement(qn("w:r"), {})
            t = run.makeelement(qn("w:t"), {})
            t.text = "1"
            run.append(t)
            fld.append(run)
            fp._p.append(fld)


# OOXML schema order of the property children we write (Word may refuse other orders)
ORDER = {
    "pPr": "pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd "
           "tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi "
           "adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc "
           "textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange",
    "rPr": "rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof "
           "snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd "
           "fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath",
    "tblPr": "tblStyle tblpPr tblOverlap bidiVisual tblStyleRowBandSize tblStyleColBandSize tblW jc "
             "tblCellSpacing tblInd tblBorders shd tblLayout tblCellMar tblLook",
}


def normalise(root):
    for tag, names in ORDER.items():
        rank = {qn(f"w:{n}"): i for i, n in enumerate(names.split())}
        for el in root.iter(qn(f"w:{tag}")):
            kids = list(el)
            kids.sort(key=lambda k: rank.get(k.tag, len(rank)))
            for k in kids:
                el.remove(k)
            keep, seen = [], set()
            for k in reversed(kids):    # of a repeated element keep the one written last
                if k.tag in rank and k.tag in seen:
                    continue
                seen.add(k.tag)
                keep.append(k)
            for k in reversed(keep):
                el.append(k)


# ---- content -------------------------------------------------------------------------------
def front(b):
    b.add(h.clone_para(b.tpl["title"], "FINAL SUBMISSION — WORKING DEMONSTRATION"))
    b.add(h.clone_para(b.tpl["subtitle"],
                       "Smart E-Mobility Hub – Electric Mobility Coordination System for the VNU-HCM Urban Area"))
    b.para("This part of the final report presents the minimum viable product (MVP) we built from the "
           "Submission 2 use cases and the Submission 3 design. Section 1 describes the MVP and how to run "
           "it. Section 2 is the working demonstration as a sequence of screens, in the order of our live "
           "demo. Section 3 summarises the automated tests, section 4 lists where the code differs from the "
           "design, and section 5 gives the lessons we learned.")


def overview(b):
    b.section("Overview of the MVP")
    b.heading("h2", "1.1 What the MVP is")
    b.para("The MVP is a web application that covers all 14 use cases of the Smart E-Mobility Hub. It has "
           "two front ends: the **student app** (screens S01–S12, a phone layout) and the **operator console** "
           "(screens O01–O06, a desktop layout). Both talk to one server that holds the whole state of the "
           "Hub network: 7 Hubs, 230 docks, 146 shared vehicles, 41 charging points, 146 parking spaces and "
           "the bookings, trips, incidents and redistribution orders on them. A change made on one side "
           "(for example, an operator blocking a vehicle) reaches the other side within a second.")
    b.para("The brief allows hard-coded data and does not require a database. We load the state from a seed "
           "file at start-up and keep it in memory. The student is Nguyen Minh Khoa (2412345) and the "
           "operator is Tran Lan (OP-014); there is no login. The bank, the dock locks, the parking sensors "
           "and the chargers are simulated.")
    b.heading("h2", "1.2 Technology")
    b.table([["Part", "Technology"],
             ["Language", "TypeScript for the server, the front ends and the tests"],
             ["Server", "Node.js with Express (HTTP API) and socket.io (WebSocket push to both front ends)"],
             ["Front ends", "React 18, built and served by Vite on the same port as the API"],
             ["Data", "In-memory objects loaded from `seed/seed.json` (generated by `seed/generate.ts`); no database"],
             ["Tests", "Vitest, 63 tests named by their test-case ID"]], [22, 78])
    b.heading("h2", "1.3 Packages and the Sub3 development view")
    b.para("The source tree follows the development view of Submission 3: one directory per package and "
           "one file per class, with the class names of the class diagram. Table 1.1 maps the Sub3 packages "
           "to the directories. The last rows are parts that exist only to run and demonstrate the MVP; "
           "they are not design classes.")
    b.para("**Table 1.1 – Sub3 packages and MVP directories**", keep_next=True, after=60)
    b.table([["Sub3 package", "MVP directory", "Classes / content"],
             ["`ui.student`", "`src/ui/student`", "MobileApp: React screens S01–S12"],
             ["`ui.operator`", "`src/ui/operator`", "OperatorConsole: React screens O01–O06"],
             ["`control.booking`", "`src/control/booking`", "SearchController, ReservationController, RentalController"],
             ["`control.charging`", "`src/control/operations`", "ChargingController (placed with the operator controllers)"],
             ["`control.support`", "`src/control/booking`, `src/control/operations`",
              "IssueController (with booking), IncidentController (with operations)"],
             ["`control.operations`", "`src/control/operations`",
              "MonitoringController, RedistributionController, SimulationController"],
             ["`control.payment`", "`src/control/payment`", "PaymentController"],
             ["`domain.network`", "`src/domain/network`", "Hub, Resource, Vehicle, Dock, ChargingPoint, ParkingSpace"],
             ["`domain.allocation`", "`src/domain/allocation`",
              "StudentAccount, PrivateVehicle, Allocation, VehicleReservation, ParkingReservation, "
              "ChargingSession, Trip, Payment"],
             ["`domain.operations`", "`src/domain/operations`",
              "IssueReport, Incident, Action, RedistributionOrder, VehicleTransfer, SimulationScenario, Recommendation"],
             ["`gateway.bank`", "`src/gateway/bank`", "BankGateway (mock Bank System)"],
             ["`gateway.iot`", "`src/gateway/iot`", "IoTDataGateway, StatusListener, SimulatedDataSource"],
             ["`platform.config`", "`src/platform/config`", "ConfigurationRegistry (all parameters of Table 2.3-6)"],
             ["— (MVP only)", "`src/platform/clock`, `src/platform/events`", "DemoClock and the internal event bus"],
             ["— (MVP only)", "`src/api`, `server/main.ts`",
              "HTTP routes, socket push, controller singletons; one Express + socket.io + Vite server"],
             ["— (MVP only)", "`src/ui/demo`, `src/ui/shared`", "Demo stage, Demo tools drawer, shared map and helpers"]],
            [22, 33, 45])
    b.heading("h2", "1.4 How to run it")
    b.para("The MVP needs Node.js 20 or later (we tested with Node 24). From the `mvp` folder:", keep_next=True)
    b.code_block(["npm install", "npm run dev"])
    b.para("Everything runs on one port, 5173. An internet connection is only needed for the web fonts.")
    b.table([["URL", "What it shows"],
             ["`http://localhost:5173/stage`", "Demo stage: the student phone and the operator console side by side"],
             ["`http://localhost:5173/student`", "Student app (S01–S12), phone width 390 px"],
             ["`http://localhost:5173/operator`", "Operator console (O01–O06), desktop width"]], [40, 60])
    b.para("Other commands: `npm test` runs the test suite (section 3), `npm run typecheck` checks the "
           "TypeScript, and `npm run seed` regenerates the seed file. Adding `?tools=0` to a URL hides the "
           "Demo tools drawer.")
    b.heading("h2", "1.5 Demo clock and simulator")
    b.para("Many rules of the design depend on time: the 15-minute pickup window, the 2-minute payment hold, "
           "the 3-minute inspection timeout, the check-in grace of a parking reservation, and the stale-data "
           "limit of a Hub. Others depend on devices we do not have: dock locks, parking sensors, charging "
           "points and the bank. To show these rules in a 10-minute demo, the MVP has two pieces of demo "
           "infrastructure that are not design classes:")
    b.bullets([
        "**DemoClock** gives every timer one clock. The demo can skip ahead (+30 s to +1 h, or to the next "
        "timer), run faster (×10, ×60) or pause, so an expiry can be shown at once instead of after 15 minutes. "
        "The tests use the same clock to check each timer at its boundary. **Reset demo** returns to "
        "Mon 02/11/2026 14:36 and the seed data.",
        "**SimulatedDataSource** plays the docks, parking sensors and chargers. It sends its events through "
        "IoTDataGateway and StatusListener exactly as real devices would, so the controllers have no demo "
        "mode. The mock **BankGateway** answers Success, Failed or Timeout after a short delay.",
        "The **Demo tools** drawer drives both: bank answers, dock unlock result, the student's location, "
        "Hub data feeds, battery levels, charging-point faults, plug-in, the dock latch at return, and the "
        "Departed / Arrived / Breakdown events of each redistribution transfer."])


# Each phone item: (file, caption, text). Each pair is shown side by side.
STUDENT_MAIN = [
    [("S01-find-hub.png", "S01 Find a Hub, list view (UC-01)",
      "The student opens the app on the Hubs tab. Without location the system lists the default campus Hubs "
      "with free vehicles, parking spaces and chargers, and the time of the last data update."),
     ("S01-map.png", "S01 Find a Hub, map view (UC-01)",
      "The Map toggle shows the same Hubs on a schematic campus map. H06 shows 0 vehicles: its data feed "
      "is cut, so the system marks it stale and its vehicles cannot be reserved (UC-01 E1).")],
    [("S02-hub-detail.png", "S02 Hub detail, H01 KTX Khu A (UC-01)",
      "The student taps H01. The system shows the Hub's vehicles with type, battery, tariff and status; "
      "Parking and Charging tabs lead to UC-04 and UC-05. A disconnected vehicle is listed but cannot be reserved."),
     ("S03-reserve-vehicle.png", "S03 Reserve vehicle EB-0217 (UC-02)",
      "The student taps Reserve on EB-0217. The summary shows the dock, the 15-minute pickup window, the "
      "5,000 VND reservation fee and the no-refund rule (BR-PAY-01). The student taps Confirm & Pay.")],
    [("S04-payment-processing.png", "S04 Waiting for payment (UC-02, UC-03)",
      "The vehicle is held for 2 minutes (PAYMENT_HOLD_VEHICLE) while the Bank System answers. The "
      "reservation is Pending Payment and other students cannot reserve the vehicle."),
     ("S04-reservation-ticket.png", "S04 Reservation ticket (UC-02)",
      "The bank answers Success. The ticket shows reservation VR-JKDN as Confirmed, the transaction ID, "
      "the dock and the pickup deadline 14:51, with a countdown.")],
    [("S09-scan.png", "S09 Scan to pick up (UC-07)",
      "At the Hub the student taps \"I'm at the Hub — scan to pick up\". The system checks that the student "
      "is inside the Hub area and asks for the vehicle's QR code or ID."),
     ("S09-inspect.png", "S09 Check the vehicle (UC-07)",
      "After the scan the reservation is Pickup In Progress and cannot expire. The student ticks the four "
      "checks within INSPECTION_TIMEOUT (3 min) and taps Unlock & Start Trip.")],
    [("S09-trip.png", "S09 Trip in progress (UC-07)",
      "The dock unlocks and the trip starts. After the clock is skipped 15 minutes, the screen shows the "
      "trip time, battery, distance and the fare so far (3,600 VND); the reservation is Fulfilled."),
     ("S10-return.png", "S10 Return the vehicle (UC-08)",
      "The student picks the return Hub and sees its vacant docks. In Demo tools the vehicle is latched "
      "into a dock; the student taps \"I've docked it — End Trip\".")],
    [("S10-receipt.png", "S10 Receipt (UC-08)",
      "The dock reports the latch, the trip closes and the fare is charged through the Bank System. The "
      "receipt shows the fare, the transaction, the route and the trip time.")],
]
STUDENT_MORE = [
    [("S05-reserve-parking.png", "S05 Reserve parking (UC-04)",
      "On H01 → Parking the student chooses a private vehicle and a time window. The system offers space "
      "P-B01 and the fee (9,000 VND). After payment the reservation is Confirmed; the parking sensor "
      "checks the student in within CHECKIN_GRACE."),
     ("S06-schedule-charging.png", "S06 Schedule charging (UC-05)",
      "On H01 → Charging the student gives the vehicle, current and target battery and a needed-by time. "
      "The system proposes a point and slot (15:30–16:30 on CP-H01-01) with the price; after payment the "
      "session is Scheduled.")],
    [("S07-report-issue.png", "S07 Report an issue (UC-06)",
      "On the Report tab the student picks a category and one of the resources they use or have reserved, "
      "and describes the problem. Send report files the report and links it to an incident for the operators."),
     ("S08-report-during-trip.png", "S08 Report a breakdown during a trip (UC-06)",
      "During a trip, \"The vehicle broke down\" opens this form with the vehicle and location already set. "
      "The trip continues until an operator confirms the breakdown (UC-12 8c), which waives the fare.")],
    [("S11-bookings.png", "S11 My bookings",
      "The Bookings tab lists the student's active bookings: two charging sessions and the parking "
      "reservation. One charging session shows it was moved 15 minutes later by the schedule (BR-CHG-02)."),
     ("S12-notifications.png", "S12 Notifications",
      "The bell opens the stored notifications: trip ended, a parking reservation cancelled with a refund "
      "after its space was blocked, and a charging session moved. Each one links to its booking.")],
]
OPERATOR = [
    ("O01-network-monitor.png", "O01 Network monitor (UC-09)",
     "The operator's start screen shows the KPIs of the network, the alert banners (H06 disconnected, E1; "
     "H02 and H04 with too few charged vehicles, 5b), the Hub map and the Hub table sorted by dock "
     "occupancy. Status and flags follow BR-HUB-01."),
    ("O01-hub-panel-H02.png", "O01 Hub panel for H02 (UC-09 5a)",
     "Clicking H02 opens its panel: dock, charging-point and vehicle counts, the occupancy of the last two "
     "hours, and the overload warning (97 %). The panel lists nearby Hubs with free docks and leads to "
     "Create Redistribution Order and Run What-if Simulation."),
    ("O01-network-monitor-1280.png", "O01 Network monitor at 1280 px, whole page (UC-09)",
     "The same screen on a 1280 px display, captured as one page. The layout tightens and the alert banners "
     "wrap; the map, the Hub table and the H02 panel stack below one another."),
    ("O02-redistribution-orders.png", "O02 Redistribution orders (UC-10)",
     "The list shows today's orders with route, vehicle count, status and deadline, and two rebalancing "
     "suggestions from BR-HUB-01 flags. The selected order RO-0312 shows each vehicle transfer and the "
     "aggregation rule BR-RED-01."),
    ("O02-new-order.png", "O02 New order from a suggestion (UC-10)",
     "Use suggestion fills a new order H02 → H01 for 4 e-bikes. The system lists eligible vehicles by "
     "battery (charging vehicles only at 80 % or more) and runs the checks before Confirm Order: free docks "
     "at the destination, both Hubs reporting, deadline in the future."),
    ("O03-smart-charging.png", "O03 Smart charging for H01 (UC-11)",
     "Generate Schedule proposes a plan for the next 4 hours. The timeline keeps committed student sessions "
     "in their paid slots, queues shared vehicles by priority score (BR-CHG-01), skips the faulty point "
     "CP-H01-04, and keeps the Hub load under the 44 kW limit. Apply Schedule saves it."),
    ("O04-incidents.png", "O04 Incidents (UC-12)",
     "The incident list shows reports from students, the system and operators. INC-0192 is a student's "
     "breakdown report during a trip; the panel shows the live resource, the linked report, the open trip "
     "and the action log, with Confirm breakdown during trip, Block resource, Resolve and Dismiss."),
]
SIMULATION = [
    ("O05-what-if-simulation.png", "O05 What-if simulation, scenario A (UC-13)",
     "The operator runs scenario A (demand surge of +60 % at H02, H03 and H05, 15:00–17:00). The violet "
     "frame states that results do not change live data. The system shows the KPIs before and after the "
     "recommendations, the measures per Hub, and the recommendations of BR-SIM-01; alternative-Hub advice "
     "is information only and cannot be ticked."),
    ("O06-apply-review.png", "O06 Apply recommendations, review (UC-14)",
     "Apply 10 selected rechecks every recommendation against the live state and shows the concrete change "
     "it will make: a redistribution order or a charging schedule change. Here all 10 are still valid."),
    ("O06-apply-result.png", "O06 Apply recommendations, result (UC-14)",
     "After Confirm and apply, each recommendation is Applied with the order it created (RO-0315 to RO-0318) "
     "or the new schedule version. A recommendation that no longer fits would be shown Not Applied with its "
     "reason. The orders appear on O02 with source \"simulation\"."),
]
STAGE = ("STAGE-cross-actor-push.png", "Demo stage: operator blocks a reserved vehicle (UC-12 → UC-02 E4)",
         "On the console the operator creates incident INC-0193 on EB-0217, starts handling it and blocks the "
         "vehicle. The panel lists the affected reservation VR-JKDN as moved to EB-0221 (BR-RES-02). On the "
         "phone, without a reload, the server pushes a \"Vehicle replaced\" banner and the ticket now shows "
         "EB-0221 with the same pickup deadline.")


def demonstration(b):
    b.section("Demonstration by Sequence of Screens")
    b.para("The screens below follow our demo script, grouped by use case. Every screenshot was taken from the "
           "running MVP after Reset demo, by a script that walks the demo (`tools/screenshots.mjs`), so the "
           "IDs, times and amounts carry over from one screen to the next. The demo clock starts at Mon "
           "02/11/2026 14:36. Screen IDs S01–S12 and O01–O06 are those of the Submission 2 UI design.")
    b.heading("h2", "2.1 Student main path: find, reserve, pay, pick up, return (UC-01 → 02 → 03 → 07 → 08)")
    b.para("The student finds a Hub, reserves e-bike EB-0217 at H01, pays the reservation fee, picks the "
           "vehicle up, rides and returns it.", keep_next=True)
    for pair in STUDENT_MAIN:
        b.figure_phones(pair)
    b.heading("h2", "2.2 Parking, charging, reporting, bookings and notifications (UC-04, UC-05, UC-06, S11, S12)")
    for pair in STUDENT_MORE:
        b.figure_phones(pair)
    b.heading("h2", "2.3 Operator: monitor, redistribute, charge, handle incidents (UC-09 – UC-12)")
    b.para("The operator console is shown at 1440 px wide unless stated.", keep_next=True)
    for item in OPERATOR:
        b.figure_full(*item)
    b.heading("h2", "2.4 Operator: what-if simulation and applying its recommendations (UC-13, UC-14)")
    for item in SIMULATION:
        b.figure_full(*item)
    b.heading("h2", "2.5 Cross-actor push on the demo stage (UC-12 → UC-02 E4)")
    b.para("The demo stage (`/stage`) shows the student phone and the operator console side by side, both "
           "connected to the same server. This step shows that an operator action reaches the student at once.",
           keep_next=True)
    b.figure_full(*STAGE)


AREAS = [("UC-01", "Search Hubs"), ("UC-02", "Reserve vehicle"), ("UC-03", "Payment"),
         ("UC-04", "Parking reservation"), ("UC-05", "Charging reservation"), ("UC-06", "Report issue"),
         ("UC-07", "Pick up vehicle"), ("UC-08", "Return vehicle"), ("UC-09", "Monitor network"),
         ("UC-10", "Redistribution"), ("UC-11", "Smart charging"), ("UC-12", "Incidents"),
         ("UC-13", "What-if simulation"), ("UC-14", "Apply recommendations")]


def count_tests():
    names = []
    for f in sorted(glob.glob(os.path.join(MVP, "tests", "*.test.ts"))):
        text = open(f, encoding="utf-8").read()
        names += re.findall(r"""\b(?:it|test)\(\s*['"`]((?:TC-UC\d\d|CORE)-\d+)""", text)
    per = Counter(n.rsplit("-", 1)[0] for n in names)
    ids = {n.rsplit("-", 1)[0]: set() for n in names}
    for n in names:
        ids[n.rsplit("-", 1)[0]].add(n)
    return names, per, ids


def testing(b):
    b.section("Testing Summary")
    names, per, ids = count_tests()
    if len(names) != 63:
        raise SystemExit(f"expected 63 labelled tests, found {len(names)}")
    tc = [n for n in names if n.startswith("TC-")]
    b.para(f"The MVP has {len(names)} automated tests written with Vitest. The name of each test starts with "
           f"the ID of the test case it implements from the Submission 3 test cases (for example `TC-UC02-08`), "
           f"so a failing test points straight at a design case. {len(tc)} tests implement "
           f"{len(set(tc))} different test cases; a few cases are checked by two tests. The {per['CORE']} tests "
           "of platform parts that have no test case (configuration, clock, status derivation) are labelled "
           "`CORE-nn`. The tests call the controllers directly, with the demo clock and the simulated "
           "devices, so each timer and failure path can be checked without the user interface.")
    b.para("**Table 3.1 – Tests by area**", keep_next=True, after=60)
    rows = [["Area", "Use case", "Tests", "Test case IDs"]]
    for uc, title in AREAS:
        key = "TC-UC" + uc[3:]
        found = sorted(ids.get(key, []))
        rows.append([uc, title, str(per.get(key, 0)), ", ".join(found)])
    rows.append(["Platform", "Configuration, clock, status rules", str(per["CORE"]), ", ".join(sorted(ids["CORE"]))])
    rows.append(["**Total**", "", f"**{len(names)}**", ""])
    b.table(rows, [9, 22, 7, 62])
    b.para("To run them, from the `mvp` folder:", keep_next=True)
    b.code_block(["npm test"])
    b.para(f"**{TEST_RUN.replace('`', '')}**")
    b.para("The tests do not cover the screens themselves. We checked those by walking the demo in the "
           "browser and comparing each screen with the Submission 2 mockups (section 5).")


def fig_of(b, name):
    return next(n for n, f, _ in b.figures if f == name)


def differences(b):
    b.section("Design vs Implementation")
    b.heading("h2", "4.1 Where the code differs from the design")
    b.bullets([
        "**MVP rules for numbers the design leaves open.** The tariff, the simulation demand model (one pickup "
        "per hour for every four docks in service), the charging durations (shared vehicles use the e-bike "
        "profile) and the Hub peak power (76 % of the installed power) are simple rules we chose so the screens "
        "show real numbers. The design does not fix them.",
        "**Version numbers.** Incident and the charging schedule carry a `version`, used for the \"someone else "
        "changed it\" checks of UC-12 E2 and UC-11 E4. The class diagram has no such attribute.",
        "**Incident faults.** Incident keeps a small set of fault notes for charging points (`faults`), used "
        "by UC-11 E3. It is not in the class diagram.",
        "**Rebalancing suggestions** (UC-10 3a) are computed in RedistributionController from the BR-HUB-01 "
        "flags, not by a separate class.",
        "**Simulation recommendations** (BR-SIM-01) are derived in SimulationController from the scenario "
        "measures: transfers from Hubs with a surplus, charging plans for low-battery vehicles or failed "
        "points, and alternative-Hub advice.",
        "**Package grouping.** ChargingController is placed in `control/operations` instead of a separate "
        "`control.charging` package, and the two `control.support` classes are split: IssueController sits "
        "with booking and IncidentController with operations. The classes and their methods are unchanged.",
        "**Demo infrastructure.** DemoClock, SimulatedDataSource, the event bus, the HTTP/socket layer "
        "(`src/api`) and the demo stage are not design classes; they exist to run and demonstrate the MVP.",
        "**UC-06 E1** (photo upload fails) is not simulated; photos are placeholders."])
    b.heading("h2", "4.2 Known limitations")
    b.bullets([
        "All state is in memory. Restarting the server (which `npm run dev` does on every server-file edit) "
        "returns to the seed data.",
        "There is no login: the app runs as one seeded student and one seeded operator.",
        "In scenario C of the simulation the recommendations are charging plans only; the shortage figures "
        "are still shown.",
        "The time inputs on O05 follow the browser's locale (12-hour format on some machines).",
        "On the charging timeline (O03) the red \"now\" label covers the first time label when the current "
        "time is close to the start of the horizon.",
        f"At 1280 px the third alert banner on O01 sits alone on its row (Figure {fig_of(b, 'O01-network-monitor-1280.png')}).",
        "The demo stage works at about 1000 px but is small; we use a 1366 px or wider screen for the live demo."])


def lessons(b):
    b.section("Lessons Learned")
    b.heading("h2", "5.1 What the design got right")
    b.bullets([
        "**One controller per use case and one class per entity** mapped straight to files. Most methods in "
        "our method descriptions became one TypeScript method with the same name, so the code can be read "
        "next to the sequence diagrams.",
        "**StatusListener and IoTDataGateway** kept the physical world out of the controllers. The simulator "
        "plays the docks, sensors and chargers, and every failure in the Demo tools is just another IoT event. "
        "No controller has a demo mode.",
        "**BR-RES-02 \"move or cancel\"**, written once in ReservationController, served UC-02 E4, UC-04, "
        "UC-07 E3/6a and UC-12 step 7. The cross-actor push (operator blocks, student sees \"Vehicle "
        "replaced\") came from it with no extra code.",
        "**Keeping the Table 2.3-6 parameters in one ConfigurationRegistry** made the timers (pickup window, "
        "payment holds, inspection, unlock, check-in grace) easy to test at their boundaries.",
        "**The detached baseline for UC-13** (`Hub.captureSnapshot`) made \"the simulation never changes live "
        "data\" true by construction and easy to test."])
    b.heading("h2", "5.2 Where the design was not enough")
    b.bullets([
        "**Time.** The design names many timeouts but no clock. We needed one DemoClock for every timer so "
        "the tests can skip ahead and the demo can fast-forward. A real system needs the same idea, a "
        "scheduler that survives restarts, and the design should name it.",
        "**Concurrency.** UC-12 E2 and UC-11 E4 say \"someone else changed it\". We needed an explicit "
        "version number on Incident and on the charging schedule; the class diagram should show it.",
        "**Late bank answers.** BR-PAY-03 covers a late Success for a released hold, but the design did not "
        "say which object owns the refund. We put it in PaymentController, keyed by the request ID, so a "
        "repeated event refunds only once (NIFR-05).",
        "**Numbers left open.** The tariff, the simulation demand model, the charging durations and the Hub "
        "peak power are not fixed in our documents. The MVP uses simple rules (section 4.1); a real build "
        "needs a decision on each.",
        "**UI routing.** Our mockups show screens, not navigation. We had to decide where each push and link "
        "goes, for example that a notification's \"View VR-…\" link opens the ticket."])
    b.heading("h2", "5.3 Process")
    b.bullets([
        "We built the MVP in phases (skeleton, student main path, other student use cases, operator console, "
        "simulation, tests) and checked and committed each phase in the browser. The main path kept working "
        "while the operator side grew.",
        "Labelling tests with the test-case IDs showed quickly which design cases the code covers. Checks in "
        "the browser still found bugs the tests missed: a parking and a charging booking that got the same "
        "short code, and a false \"someone else changed this\" warning after the operator's own save.",
        "Comparing each screen with the mockup by its text, not only by its look, caught missing fields early. "
        "A final visual review at phone and desktop widths fixed layout problems such as clipped cards and "
        "overlapping map labels.",
        "A shared helper that sent a GET request when no body was given caused two \"button does nothing\" "
        "bugs. Small helper functions need the same care as the domain code."])


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "asmt-4-demo.docx")
    b = Builder(os.path.join(HERE, "style-template.docx"))
    front(b)
    overview(b)
    demonstration(b)
    testing(b)
    differences(b)
    lessons(b)
    used = {f for _, f, _ in b.figures}
    missing = sorted(set(os.listdir(SHOTS)) - used)
    if missing or len(b.figures) != 28:
        raise SystemExit(f"figures: {len(b.figures)}, screenshots not used: {missing}")
    normalise(b.doc.element.body)
    b.doc.save(out)
    for n, f, w in b.figures:
        print(f"Figure {n}: {f}  {w} in wide")
    print(f"{len(b.figures)} figures -> {out}")


if __name__ == "__main__":
    main()
