import os
import pptx
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

def build_deck():
    prs = pptx.Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Colors
    DARK_BG = RGBColor(15, 23, 42)        # Slate 900
    LIGHT_BG = RGBColor(248, 250, 252)    # Slate 50
    CARD_BG = RGBColor(255, 255, 255)     # White
    DARK_CARD = RGBColor(30, 41, 59)      # Slate 800
    BORDER_COLOR = RGBColor(226, 232, 240)# Slate 200
    
    TEXT_DARK = RGBColor(15, 23, 42)      # Slate 900
    TEXT_MUTED = RGBColor(71, 85, 105)    # Slate 600
    TEXT_LIGHT = RGBColor(248, 250, 252)  # Slate 50
    TEXT_LIGHT_MUTED = RGBColor(148, 163, 184) # Slate 400
    
    BLUE_ACCENT = RGBColor(37, 99, 235)   # Blue 600
    CYAN_ACCENT = RGBColor(14, 165, 233)  # Cyan 500
    GREEN_ACCENT = RGBColor(16, 185, 129) # Emerald 500
    PURPLE_ACCENT = RGBColor(147, 51, 234)# Purple 600
    RED_ACCENT = RGBColor(239, 68, 68)    # Red 500

    def add_bg(slide, color):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = color
        bg.line.color.rgb = color
        return bg

    def add_header(slide, tag, title, subtitle=None, dark=False):
        tb_tag = slide.shapes.add_textbox(Inches(0.8), Inches(0.45), Inches(11.5), Inches(0.35))
        p_tag = tb_tag.text_frame.paragraphs[0]
        p_tag.text = tag.upper()
        p_tag.font.name = "Arial"
        p_tag.font.size = Pt(11)
        p_tag.font.bold = True
        p_tag.font.color.rgb = CYAN_ACCENT if dark else BLUE_ACCENT

        tb_title = slide.shapes.add_textbox(Inches(0.8), Inches(0.75), Inches(11.5), Inches(0.75))
        p_title = tb_title.text_frame.paragraphs[0]
        p_title.text = title
        p_title.font.name = "Arial"
        p_title.font.size = Pt(23)
        p_title.font.bold = True
        p_title.font.color.rgb = TEXT_LIGHT if dark else TEXT_DARK

        if subtitle:
            tb_sub = slide.shapes.add_textbox(Inches(0.8), Inches(1.35), Inches(11.5), Inches(0.45))
            p_sub = tb_sub.text_frame.paragraphs[0]
            p_sub.text = subtitle
            p_sub.font.name = "Arial"
            p_sub.font.size = Pt(13)
            p_sub.font.color.rgb = TEXT_LIGHT_MUTED if dark else TEXT_MUTED

    def add_card(slide, left, top, width, height, title, items, badge=None, badge_color=GREEN_ACCENT, dark=False):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
        card.fill.solid()
        card.fill.fore_color.rgb = DARK_CARD if dark else CARD_BG
        card.line.color.rgb = DARK_CARD if dark else BORDER_COLOR
        card.line.width = Pt(1.2)

        tbox = slide.shapes.add_textbox(Inches(left + 0.25), Inches(top + 0.2), Inches(width - 0.5), Inches(0.5))
        tf = tbox.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = title
        p.font.name = "Arial"
        p.font.size = Pt(15)
        p.font.bold = True
        p.font.color.rgb = TEXT_LIGHT if dark else TEXT_DARK

        if badge:
            run_b = p.add_run()
            run_b.text = f"  [{badge}]"
            run_b.font.size = Pt(10)
            run_b.font.bold = True
            run_b.font.color.rgb = badge_color

        cbox = slide.shapes.add_textbox(Inches(left + 0.25), Inches(top + 0.65), Inches(width - 0.5), Inches(height - 0.8))
        ctf = cbox.text_frame
        ctf.word_wrap = True

        for i, (bold_txt, regular_txt) in enumerate(items):
            cp = ctf.add_paragraph() if i > 0 else ctf.paragraphs[0]
            cp.space_before = Pt(6)
            cp.space_after = Pt(2)
            
            rb = cp.add_run()
            rb.text = "• "
            rb.font.bold = True
            rb.font.color.rgb = CYAN_ACCENT if dark else BLUE_ACCENT
            rb.font.size = Pt(11)

            rbold = cp.add_run()
            rbold.text = bold_txt + ": "
            rbold.font.bold = True
            rbold.font.size = Pt(11.5)
            rbold.font.color.rgb = TEXT_LIGHT if dark else TEXT_DARK

            rreg = cp.add_run()
            rreg.text = regular_txt
            rreg.font.size = Pt(11)
            rreg.font.color.rgb = TEXT_LIGHT_MUTED if dark else TEXT_MUTED

    # SLIDE 1: Title Slide
    s1 = prs.slides.add_slide(blank_layout)
    add_bg(s1, DARK_BG)

    pill = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.2), Inches(3.2), Inches(0.4))
    pill.fill.solid()
    pill.fill.fore_color.rgb = RGBColor(30, 41, 59)
    pill.line.color.rgb = CYAN_ACCENT
    pp = pill.text_frame.paragraphs[0]
    pp.text = "PROJECT PRESENTATION • OCT 2026"
    pp.font.bold = True
    pp.font.size = Pt(10)
    pp.font.color.rgb = CYAN_ACCENT
    pp.alignment = PP_ALIGN.CENTER

    tbox = s1.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(6.5), Inches(2.2))
    ttf = tbox.text_frame
    ttf.word_wrap = True
    tp = ttf.paragraphs[0]
    tp.text = "AndarKaCode"
    tp.font.size = Pt(46)
    tp.font.bold = True
    tp.font.color.rgb = TEXT_LIGHT

    tp2 = ttf.add_paragraph()
    tp2.space_before = Pt(10)
    tp2.text = "Screenshot in, working full-stack app out."
    tp2.font.size = Pt(20)
    tp2.font.color.rgb = CYAN_ACCENT

    tp3 = ttf.add_paragraph()
    tp3.space_before = Pt(8)
    tp3.text = "Deterministic full-stack code generation backed by visible UI evidence."
    tp3.font.size = Pt(13)
    tp3.font.color.rgb = TEXT_LIGHT_MUTED

    sbox = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(4.5), Inches(6.2), Inches(1.8))
    sbox.fill.solid()
    sbox.fill.fore_color.rgb = DARK_CARD
    sbox.line.color.rgb = RGBColor(51, 65, 85)
    stf = sbox.text_frame
    stf.word_wrap = True
    stp1 = stf.paragraphs[0]
    stp1.text = "Current Milestones Completed"
    stp1.font.bold = True
    stp1.font.size = Pt(13)
    stp1.font.color.rgb = GREEN_ACCENT

    for bold_t, reg_t in [
        ("Steps 1–12 & 15", "All core services, templates, auth & runtime wirer built"),
        ("UI v1 Dashboard", "Live Metro-line visual tracking with ZIP export"),
        ("Test Verification", "195 unit tests + 47 integration tests passing green")
    ]:
        stp = stf.add_paragraph()
        stp.space_before = Pt(4)
        r1 = stp.add_run()
        r1.text = "✓ " + bold_t + " — "
        r1.font.bold = True
        r1.font.size = Pt(11)
        r1.font.color.rgb = TEXT_LIGHT
        r2 = stp.add_run()
        r2.text = reg_t
        r2.font.size = Pt(10.5)
        r2.font.color.rgb = TEXT_LIGHT_MUTED

    img_card = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(7.5), Inches(1.2), Inches(5.0), Inches(5.1))
    img_card.fill.solid()
    img_card.fill.fore_color.rgb = CARD_BG
    img_card.line.color.rgb = RGBColor(51, 65, 85)

    img_title = s1.shapes.add_textbox(Inches(7.7), Inches(1.3), Inches(4.6), Inches(0.4))
    itp = img_title.text_frame.paragraphs[0]
    itp.text = "INPUT: Raw UI Screenshot"
    itp.font.bold = True
    itp.font.size = Pt(11)
    itp.font.color.rgb = BLUE_ACCENT

    if os.path.exists("samples/employees.png"):
        s1.shapes.add_picture("samples/employees.png", Inches(7.7), Inches(1.75), width=Inches(4.6))

    # SLIDE 2: Problem Statement & Guiding Rule
    s2 = prs.slides.add_slide(blank_layout)
    add_bg(s2, LIGHT_BG)
    add_header(s2, "The Problem & The Guiding Rule", "Why Existing LLM Generators Fail vs. Our Solution", "Pure AI guesses; AndarKaCode derives deterministic code strictly from visual evidence.")

    add_card(s2, 0.8, 1.9, 5.6, 3.4, "The LLM Hallucination Trap", [
        ("Ghost Endpoints", "LLMs invent unrequested database tables, roles, and endpoints not shown on screen."),
        ("Broken Integration", "Frontend form fields and backend route names desynchronize, causing broken buttons."),
        ("No Ground Truth", "Minor prompt changes produce completely different APIs and database structures.")
    ], badge="BROKEN", badge_color=RED_ACCENT)

    add_card(s2, 6.9, 1.9, 5.6, 3.4, "Our Solution: 'No Evidence, No Code'", [
        ("Traceable Ground Truth", "Every model, route, and validator points to an exact visual element on the screenshot."),
        ("Deterministic Rule Table", "Fixed derivation rules convert visible UI widgets into an App Spec (no AI guessing)."),
        ("Dual-Direction Rule", "Every visible control has a backend route; no backend route exists without a control.")
    ], badge="DETERMINISTIC", badge_color=GREEN_ACCENT)

    bb = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.5), Inches(11.7), Inches(1.4))
    bb.fill.solid()
    bb.fill.fore_color.rgb = DARK_CARD
    bb.line.color.rgb = BORDER_COLOR
    bbtf = bb.text_frame
    bbtf.word_wrap = True
    bbp = bbtf.paragraphs[0]
    bbp.text = "HOW EVIDENCE WORKS IN PRACTICE:"
    bbp.font.bold = True
    bbp.font.size = Pt(11)
    bbp.font.color.rgb = CYAN_ACCENT

    bbp2 = bbtf.add_paragraph()
    bbp2.space_before = Pt(4)
    bbp2.text = "• Table of employees with Edit/Delete ➔ List, Update, Delete for employee (Create is excluded if no Add button is visible).\n• 'Add Employee' button + search box ➔ Adds Create endpoint, schema validation, and text search filtering.\n• Login form visible ➔ Adds Account model, scrypt password hashing, session tokens, and route protection (zero auth code if omitted)."
    bbp2.font.size = Pt(11)
    bbp2.font.color.rgb = TEXT_LIGHT

    # SLIDE 3: Flowchart
    s3 = prs.slides.add_slide(blank_layout)
    add_bg(s3, LIGHT_BG)
    add_header(s3, "Architecture Flowchart", "End-to-End Pipeline: From Image to Running App", "The 5-stage transformation pipeline coordinated by the state machine.")

    steps = [
        ("1. Upload & Scale", "SHA-256 hash\nScale ≤ 1280px\nRun workspace", BLUE_ACCENT),
        ("2. Vision Inventory", "Ollama / Gemini\nDetects tables, buttons\ninputs & stat cards", CYAN_ACCENT),
        ("3. Spec Deriver", "Rule table mapping\nAttaches UI evidence\nGenerates contract", PURPLE_ACCENT),
        ("4. Dual Generation", "Frontend (GPU)\nBackend (Templates)\nSync Barrier check", BLUE_ACCENT),
        ("5. Wire & Package", "Runtime app.js binder\napi-map.json\nDownloadable ZIP", GREEN_ACCENT),
    ]

    box_w = 2.1
    box_gap = 0.3
    start_x = 0.8
    y_top = 2.0
    h_box = 3.2

    for i, (stitle, sdesc, scolor) in enumerate(steps):
        bx = start_x + i * (box_w + box_gap)
        box = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(bx), Inches(y_top), Inches(box_w), Inches(h_box))
        box.fill.solid()
        box.fill.fore_color.rgb = CARD_BG
        box.line.color.rgb = scolor
        box.line.width = Pt(2.0)

        s_tag = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(bx + 0.15), Inches(y_top + 0.15), Inches(box_w - 0.3), Inches(0.45))
        s_tag.fill.solid()
        s_tag.fill.fore_color.rgb = scolor
        s_tag.line.color.rgb = scolor
        stp = s_tag.text_frame.paragraphs[0]
        stp.text = f"STAGE {i+1}"
        stp.font.bold = True
        stp.font.size = Pt(11)
        stp.font.color.rgb = TEXT_LIGHT
        stp.alignment = PP_ALIGN.CENTER

        tb_t = s3.shapes.add_textbox(Inches(bx + 0.1), Inches(y_top + 0.7), Inches(box_w - 0.2), Inches(0.7))
        pt = tb_t.text_frame.paragraphs[0]
        pt.text = stitle
        pt.font.bold = True
        pt.font.size = Pt(12)
        pt.font.color.rgb = TEXT_DARK
        pt.alignment = PP_ALIGN.CENTER

        tb_d = s3.shapes.add_textbox(Inches(bx + 0.1), Inches(y_top + 1.45), Inches(box_w - 0.2), Inches(1.5))
        pd = tb_d.text_frame.paragraphs[0]
        pd.text = sdesc
        pd.font.size = Pt(11)
        pd.font.color.rgb = TEXT_MUTED
        pd.alignment = PP_ALIGN.CENTER

        if i < 4:
            arrow = s3.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(bx + box_w + 0.05), Inches(y_top + 1.4), Inches(0.2), Inches(0.3))
            arrow.fill.solid()
            arrow.fill.fore_color.rgb = RGBColor(148, 163, 184)
            arrow.line.color.rgb = RGBColor(148, 163, 184)

    callout = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.5), Inches(11.7), Inches(1.4))
    callout.fill.solid()
    callout.fill.fore_color.rgb = DARK_CARD
    callout.line.color.rgb = BORDER_COLOR
    ctf = callout.text_frame
    ctf.word_wrap = True
    cp1 = ctf.paragraphs[0]
    cp1.text = "CORE GUARANTEE: THE SYNC BARRIER"
    cp1.font.bold = True
    cp1.font.size = Pt(11)
    cp1.font.color.rgb = GREEN_ACCENT

    cp2 = ctf.add_paragraph()
    cp2.space_before = Pt(4)
    cp2.text = "Stage 4 runs as two asynchronous branches: the frontend runs on the GPU while the backend is generated from templates. Stage 5 (Wiring & Delivery) is physically blocked by the Sync Barrier until both sides carry the exact same Contract SHA-256 fingerprint."
    cp2.font.size = Pt(11)
    cp2.font.color.rgb = TEXT_LIGHT

    # SLIDE 4: Microservices
    s4 = prs.slides.add_slide(blank_layout)
    add_bg(s4, LIGHT_BG)
    add_header(s4, "Distributed Topology", "Dual-Laptop Microservices Architecture", "Decoupling GPU vision workloads from the orchestrator and state machine.")

    add_card(s4, 0.8, 1.9, 5.4, 4.9, "Laptop A: Orchestrator (Mac)", [
        ("Builder API (:4000)", "Express 5 state machine managing project lifecycles (`UPLOADED` ➔ `SYNCED`)."),
        ("Database Layer", "MongoDB `builder_db` storing immutable contract revisions, jobs, and specs."),
        ("UI Inventory & Spec Deriver", "Vision pass & rule engine compiling the App Spec with visible evidence."),
        ("Template Code Generator", "Compiles production-ready Express + Mongoose CRUD controllers in <1s."),
        ("Web Presentation UI (:5173)", "React / Vite live Metro-line pipeline tracker and ZIP packager.")
    ], badge="ORCHESTRATOR", badge_color=BLUE_ACCENT)

    conn = s4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.35), Inches(3.2), Inches(0.65), Inches(2.2))
    conn.fill.solid()
    conn.fill.fore_color.rgb = DARK_CARD
    conn.line.color.rgb = CYAN_ACCENT
    ctf = conn.text_frame
    ctp = ctf.paragraphs[0]
    ctp.text = "T\nA\nI\nL\nS\nC\nA\nL\nE"
    ctp.font.bold = True
    ctp.font.size = Pt(10)
    ctp.font.color.rgb = CYAN_ACCENT
    ctp.alignment = PP_ALIGN.CENTER

    add_card(s4, 7.15, 1.9, 5.4, 4.9, "Laptop B: GPU Worker (Windows 11)", [
        ("Ollama (:11434)", "Runs `qwen3-vl:8b` fully on GPU with 16k context window for image understanding."),
        ("Screenshot-to-Code (:7001)", "Specialized engine redrawing screenshots into clean HTML + Tailwind CSS."),
        ("Gateway REST Queue (:8787)", "Lightweight Express front-door enforcing strict single-concurrency queue."),
        ("Security Header", "Private Tailscale IP access secured by mandatory `X-API-Key` authentication."),
        ("Cloud Auto-Fallback", "Automatic switchover to Gemini 3 Flash Preview if local VRAM saturates.")
    ], badge="GPU WORKER", badge_color=PURPLE_ACCENT)

    # SLIDE 5: S2C Patches
    s5 = prs.slides.add_slide(blank_layout)
    add_bg(s5, LIGHT_BG)
    add_header(s5, "Engine Improvements", "Key Patches Made to Screenshot-to-Code (S2C)", "Real engineering fixes applied to make S2C reliable, fast, and deterministic.")

    add_card(s5, 0.8, 1.9, 5.6, 2.4, "1. Bounded Agent Loops (max_steps: 6)", [
        ("Problem", "Default S2C ran for 30 steps and continued executing indefinitely after client disconnects."),
        ("Fix", "Capped `max_steps = 6` and added early completion acceptance 60s after `</html>` appears.")
    ], badge="STABILITY")

    add_card(s5, 6.9, 1.9, 5.6, 2.4, "2. Single Variant Mode (NUM_VARIANTS: 1)", [
        ("Problem", "Default S2C generated 4 variants simultaneously, overflowing 8 GB GPU VRAM."),
        ("Fix", "Set `NUM_VARIANTS = 1`, cutting generation time from >5 minutes down to ~110 seconds.")
    ], badge="PERFORMANCE")

    add_card(s5, 0.8, 4.5, 5.6, 2.4, "3. Windows OS & Platform Fixes", [
        ("UTF-8 Logging", "Forced UTF-8 on Windows stdout/stderr to eliminate crashes on CP1252 character prints."),
        ("Proactor Event Loop", "Configured `loop='none'` on Windows uvicorn, enabling subprocesses (Playwright).")
    ], badge="COMPATIBILITY")

    add_card(s5, 6.9, 4.5, 5.6, 2.4, "4. Ollama & Contract Marker Support", [
        ("Ollama Fallback", "Automatically detects and strips unsupported `reasoning` payloads from local models."),
        ("Injected HTML Markers", "Instructs vision generation to output explicit `data-field` and `data-action` tags.")
    ], badge="INTEGRATION")

    # SLIDE 6: Sync Barrier
    s6 = prs.slides.add_slide(blank_layout)
    add_bg(s6, LIGHT_BG)
    add_header(s6, "Consistency Engine", "Dual-Branch Synchronization & The Sync Barrier", "Preventing race conditions when frontend and backend generation run at vastly different speeds.")

    add_card(s6, 0.8, 1.9, 5.6, 2.5, "Branch A: Frontend (GPU)", [
        ("Execution Time", "~2.5 to 4 minutes per page on GPU."),
        ("Output", "HTML + Tailwind CSS with `data-field` markers."),
        ("Fingerprint", "Stamped with source `contractHash`.")
    ], badge="SLOW BRANCH")

    add_card(s6, 6.9, 1.9, 5.6, 2.5, "Branch B: Backend (Templates)", [
        ("Execution Time", "< 100 milliseconds from deterministic templates."),
        ("Output", "Express routes, Mongoose models, and test suites."),
        ("Fingerprint", "Stamped with source `contractHash`.")
    ], badge="FAST BRANCH")

    sb_card = s6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(4.6), Inches(11.7), Inches(2.3))
    sb_card.fill.solid()
    sb_card.fill.fore_color.rgb = DARK_CARD
    sb_card.line.color.rgb = GREEN_ACCENT
    sb_card.line.width = Pt(1.5)

    stf = sb_card.text_frame
    stf.word_wrap = True
    sp1 = stf.paragraphs[0]
    sp1.text = "HOW THE SYNC BARRIER ENFORCES CONSISTENCY:"
    sp1.font.bold = True
    sp1.font.size = Pt(12)
    sp1.font.color.rgb = GREEN_ACCENT

    items = [
        ("Immutable Hash Stamping", "Every artifact carries the 64-character SHA-256 hash of the exact spec it was built from."),
        ("Barrier Gatekeeping", "The project state machine refuses to enter `SYNCED` until every page and the backend share the exact same hash."),
        ("Automated Superseding", "If the user modifies an input label while building, obsolete GPU jobs are marked `cancelled`, and new builds re-sync."),
        ("Instant Cache Replay", "Re-running a previously built screenshot + contract hash returns the cached page in ~2 seconds.")
    ]
    for b_txt, r_txt in items:
        sp = stf.add_paragraph()
        sp.space_before = Pt(4)
        r1 = sp.add_run()
        r1.text = "• " + b_txt + ": "
        r1.font.bold = True
        r1.font.size = Pt(11)
        r1.font.color.rgb = TEXT_LIGHT
        r2 = sp.add_run()
        r2.text = r_txt
        r2.font.size = Pt(10.5)
        r2.font.color.rgb = TEXT_LIGHT_MUTED

    # SLIDE 7: Templates & Auth
    s7 = prs.slides.add_slide(blank_layout)
    add_bg(s7, LIGHT_BG)
    add_header(s7, "Backend Engine", "Deterministic Templates & Adaptive Authentication", "Instant code compilation with conditional auth generation.")

    add_card(s7, 0.8, 1.9, 5.6, 4.9, "Template Generation (Step 11)", [
        ("Instant Compilation", "Generates models, validation, controllers, and tests in milliseconds."),
        ("Evidence-Based Routes", "Search, filter, pagination, and status toggles (`setStatus`) only generated if shown on screen."),
        ("CSV Export & Stats", "Exports and summary statistics cards generated only when visible."),
        ("501 Isolation", "Unmatched buttons generate clean 501 'Not Available Yet' handlers."),
        ("Automated Tests", "Every generated backend includes complete mocha/node test suites.")
    ], badge="STEP 11")

    auth_card = s7.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.9), Inches(1.9), Inches(5.6), Inches(4.9))
    auth_card.fill.solid()
    auth_card.fill.fore_color.rgb = CARD_BG
    auth_card.line.color.rgb = BORDER_COLOR

    atf = s7.shapes.add_textbox(Inches(7.15), Inches(2.0), Inches(5.1), Inches(0.4)).text_frame
    ap = atf.paragraphs[0]
    ap.text = "Adaptive Authentication (Step 12)"
    ap.font.bold = True
    ap.font.size = Pt(14)
    ap.font.color.rgb = TEXT_DARK

    if os.path.exists("samples/mocks/m4-login.png"):
        s7.shapes.add_picture("samples/mocks/m4-login.png", Inches(7.15), Inches(2.45), width=Inches(5.1))

    atf2 = s7.shapes.add_textbox(Inches(7.15), Inches(5.4), Inches(5.1), Inches(1.3)).text_frame
    atf2.word_wrap = True
    ap2 = atf2.paragraphs[0]
    ap2.text = "• Login screen visible ➔ Generates Account model, scrypt password hashing, session tokens, 5-try lockout, and route protection.\n• NO login screen visible ➔ ZERO authentication code is generated."
    ap2.font.size = Pt(11)
    ap2.font.color.rgb = TEXT_MUTED

    # SLIDE 8: The Runtime Wirer
    s8 = prs.slides.add_slide(blank_layout)
    add_bg(s8, LIGHT_BG)
    add_header(s8, "Frontend Integration", "Step 15: The Runtime Wirer (`frontend/app.js`)", "Zero-dependency client-side runtime connecting HTML controls to backend APIs.")

    w_card = s8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.9), Inches(5.6), Inches(4.9))
    w_card.fill.solid()
    w_card.fill.fore_color.rgb = CARD_BG
    w_card.line.color.rgb = BORDER_COLOR

    wtf = s8.shapes.add_textbox(Inches(1.0), Inches(2.0), Inches(5.2), Inches(0.4)).text_frame
    wp = wtf.paragraphs[0]
    wp.text = "Target Page: Products Dashboard (m2)"
    wp.font.bold = True
    wp.font.size = Pt(14)
    wp.font.color.rgb = TEXT_DARK

    if os.path.exists("samples/mocks/m2-add-search-page.png"):
        s8.shapes.add_picture("samples/mocks/m2-add-search-page.png", Inches(1.0), Inches(2.45), width=Inches(5.2))

    wtf2 = s8.shapes.add_textbox(Inches(1.0), Inches(5.5), Inches(5.2), Inches(1.2)).text_frame
    wtf2.word_wrap = True
    wp2 = wtf2.paragraphs[0]
    wp2.text = "Verified in Real Headless Chrome:\n• Products (7/7 Pass): In-row edit, new row add, search, delete.\n• Staff + Auth (6/6 Pass): Login gate, Bearer token, persistent DB records."
    wp2.font.size = Pt(11)
    wp2.font.color.rgb = TEXT_MUTED

    add_card(s8, 6.9, 1.9, 5.6, 4.9, "How the Binder Works", [
        ("Zero Build Dependencies", "Plain vanilla JavaScript (`frontend/app.js`) added to the zip at download time; no webpack or npm build needed."),
        ("Preserves Designer CSS", "Clones the original sample row for new entries, retaining exact Tailwind borders, spacing, and styles."),
        ("Format Matching", "Preserves currency styles (e.g. `$2.50`) and status badge colors (green/red) based on sample data patterns."),
        ("Event Interception", "Intercepts form submits and clicks in the capture phase to disable dummy mock scripts."),
        ("In-Row Editing", "When an Add button has no modal, opens an inline editable row with Enter/Save and Escape.")
    ], badge="STEP 15 VERIFIED")

    # SLIDE 9: React Dashboard
    s9 = prs.slides.add_slide(blank_layout)
    add_bg(s9, LIGHT_BG)
    add_header(s9, "Developer Experience", "UI v1: Interactive Metro-Line Pipeline View", "A transparent transit-style dashboard giving developers real-time visibility.")

    u_card = s9.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.9), Inches(5.6), Inches(4.9))
    u_card.fill.solid()
    u_card.fill.fore_color.rgb = CARD_BG
    u_card.line.color.rgb = BORDER_COLOR

    utf = s9.shapes.add_textbox(Inches(1.0), Inches(2.0), Inches(5.2), Inches(0.4)).text_frame
    up = utf.paragraphs[0]
    up.text = "Multi-Station Project Tracker"
    up.font.bold = True
    up.font.size = Pt(14)
    up.font.color.rgb = TEXT_DARK

    if os.path.exists("samples/mocks/m3-dashboard.png"):
        s9.shapes.add_picture("samples/mocks/m3-dashboard.png", Inches(1.0), Inches(2.45), width=Inches(5.2))

    utf2 = s9.shapes.add_textbox(Inches(1.0), Inches(5.5), Inches(5.2), Inches(1.2)).text_frame
    utf2.word_wrap = True
    up2 = utf2.paragraphs[0]
    up2.text = "Pipeline Stations:\n[Upload] ➔ [Read] ➔ [Plan] ➔ [Pages] ➔ [Backend] ➔ [Sync] ➔ [Wire] ➔ [Ready]\nEach station shows live duration, host machine, and model stats."
    up2.font.size = Pt(11)
    up2.font.color.rgb = TEXT_MUTED

    add_card(s9, 6.9, 1.9, 5.6, 4.9, "Dashboard Capabilities", [
        ("Visual Subway Stations", "Live transit view pulses while active, turns green on completion, and shows real-time elapsed seconds."),
        ("Plain-English Explanations", "Clicking any station reveals transparent explanations of what executed and on which machine."),
        ("App Spec Inspector", "Interactive tab allowing developers to audit derived entities, routes, and screenshot evidence citations."),
        ("Code Inspection Tabs", "Side-by-side tabs to preview generated HTML pages, Express controllers, and database schemas."),
        ("One-Click ZIP Export", "Instant download of the fully wired, ready-to-run application as soon as the Sync Barrier passes.")
    ], badge="UI v1 READY")

    # SLIDE 10: Milestones & Roadmap
    s10 = prs.slides.add_slide(blank_layout)
    add_bg(s10, DARK_BG)
    add_header(s10, "Summary & Roadmap", "Project Status & Immediate Next Step", "Solid foundations established with clear next steps toward production.", dark=True)

    add_card(s10, 0.8, 1.9, 5.6, 4.9, "Accomplished Milestones", [
        ("Full Pipeline Operational", "Screenshots reliably transform into tested, wired, running full-stack apps."),
        ("Zero Evidence Hallucinations", "Guaranteed 100% correlation between visible UI elements and generated code."),
        ("High Test Health", "195 unit tests and 47 integration tests passing green across services."),
        ("Real Browser Verification", "Wired applications verified end-to-end in real Google Chrome."),
        ("Presentation UI Ready", "Interactive Metro-line dashboard operational in `web/` with live ZIP download.")
    ], badge="STEPS 1-12, 15 COMPLETE", badge_color=GREEN_ACCENT, dark=True)

    add_card(s10, 6.9, 1.9, 5.6, 4.9, "Next Engineering Steps", [
        ("Immediate Next Step: Step 16", "Verifier + Repair Loop: Headless robot checking that every button is backed, auto-triggering Gateway repairs if markers are missing."),
        ("Step 13: AI Layer", "Code generation model for bespoke buttons that templates cannot cover, with AST and Docker sandboxing."),
        ("Step 14: Project Memory", "Image dHash and vector embeddings enabling instant cache replay for duplicate or similar screens."),
        ("Step 19: GitHub Publish", "One-click OAuth export directly to a user's GitHub repository with passing CI.")
    ], badge="ROADMAP", badge_color=CYAN_ACCENT, dark=True)

    output_path = "D:\\Desktop\\ImageToapp\\AndarKaCode_Presentation_v2.pptx"
    prs.save(output_path)
    print(f"Presentation script successfully created and saved to {output_path}")

if __name__ == "__main__":
    build_deck()
