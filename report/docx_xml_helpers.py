"""Low-level XML helpers for the Google-Docs-exported group document.

Adapted from an earlier helper of the Submission 1 fix; this
copy also reads OMML math text (the "≥" in UC-02 is an equation object).
"""
import copy

from docx.oxml.ns import qn

XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
M_T = "{http://schemas.openxmlformats.org/officeDocument/2006/math}t"
YELLOW = "FFF2CC"


def text_of(el):
    """Visible text of a paragraph or table, math text included."""
    return "".join(n.text or "" for n in el.iter() if n.tag in (qn("w:t"), M_T))


def style_of(p_el):
    s = p_el.find(qn("w:pPr") + "/" + qn("w:pStyle"))
    return s.get(qn("w:val")) if s is not None else None


def strip_section_break(p_el):
    ppr = p_el.find(qn("w:pPr"))
    if ppr is not None:
        for s in ppr.findall(qn("w:sectPr")):
            ppr.remove(s)


def set_para_text(p_el, text):
    """Replace the text of a paragraph, keeping the pPr and the rPr of its first text run."""
    first = next((r for r in p_el.iter(qn("w:r")) if r.find(qn("w:t")) is not None), None)
    rpr = first.find(qn("w:rPr")) if first is not None else None
    for child in list(p_el):
        if child.tag != qn("w:pPr"):
            p_el.remove(child)
    run = p_el.makeelement(qn("w:r"), {})
    if rpr is not None:
        run.append(copy.deepcopy(rpr))
    p_el.append(run)
    t = run.makeelement(qn("w:t"), {})
    t.text = text
    t.set(XML_SPACE, "preserve")
    run.append(t)
    return p_el


def clone_para(template, text=None):
    """Deep-copy a paragraph (keeping its style) and optionally set new text."""
    el = copy.deepcopy(template)
    strip_section_break(el)
    for d in list(el.iter(qn("w:drawing"))):
        d.getparent().remove(d)
    if text is not None:
        set_para_text(el, text)
    return el


def blank_like(template):
    el = clone_para(template, "")
    for r in el.findall(qn("w:r")):
        el.remove(r)
    return el


def page_break_para(template):
    el = blank_like(template)
    run = el.makeelement(qn("w:r"), {})
    run.append(run.makeelement(qn("w:br"), {qn("w:type"): "page"}))
    el.append(run)
    return el


def page_break_before(el):
    """Start el on a new page (pageBreakBefore), which never leaves an empty page behind."""
    ppr = el.find(qn("w:pPr"))
    if ppr is None:
        ppr = el.makeelement(qn("w:pPr"), {})
        el.insert(0, ppr)
    if ppr.find(qn("w:pageBreakBefore")) is None:
        pb = ppr.makeelement(qn("w:pageBreakBefore"), {})
        style = ppr.find(qn("w:pStyle"))
        if style is not None:
            style.addnext(pb)
        else:
            ppr.insert(0, pb)
    return el


def highlight_runs(p_el, fill=YELLOW):
    """Shade every run of a paragraph (marks text the member must fill in)."""
    for r in p_el.findall(qn("w:r")):
        rpr = r.find(qn("w:rPr"))
        if rpr is None:
            rpr = r.makeelement(qn("w:rPr"), {})
            r.insert(0, rpr)
        shd = rpr.makeelement(qn("w:shd"), {qn("w:val"): "clear", qn("w:color"): "auto",
                                            qn("w:fill"): fill})
        rpr.append(shd)


def shade_cell(tc, fill=YELLOW):
    tcpr = tc.find(qn("w:tcPr"))
    if tcpr is None:
        tcpr = tc.makeelement(qn("w:tcPr"), {})
        tc.insert(0, tcpr)
    for old in tcpr.findall(qn("w:shd")):
        tcpr.remove(old)
    tcpr.append(tcpr.makeelement(qn("w:shd"), {qn("w:val"): "clear", qn("w:color"): "auto",
                                               qn("w:fill"): fill}))


def fill_cell(tc, lines, template_p=None):
    """Put one paragraph per line in a table cell, cloned from its first paragraph."""
    paras = tc.findall(qn("w:p"))
    tpl = template_p if template_p is not None else paras[0]
    tpl = copy.deepcopy(tpl)
    for p in paras:
        tc.remove(p)
    for line in lines or [""]:
        tc.append(clone_para(tpl, line))
