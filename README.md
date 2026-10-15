# SIH26034 — Compliance checker for packaged commodities

Reads a photograph of a packaged commodity, finds the declarations required by
the **Legal Metrology (Packaged Commodities) Rules, 2011**, and tells a field
inspector which ones need their attention.

It does not decide compliance. That distinction runs through the whole codebase
and is the most important thing to understand about it — see
[What the system refuses to do](#what-the-system-refuses-to-do).

## Running it

One install at the root wires every module (npm workspaces):

```bash
npm install
```

Then either run the two halves separately for development:

```bash
npm run dev:backend     # API on :5000, recogniser warms at boot
npm run dev:frontend    # UI on :5173
```

…or build once and serve the whole thing from the API, which is what to do at
demo time — one process, one URL, nothing to forget:

```bash
npm run demo            # builds the UI, serves it from http://localhost:5000
```

Everything runs offline. The recogniser's language data is committed under
`ocr/tessdata/`, so nothing reaches for a CDN mid-demo. The UI's webfonts load
from Google Fonts but have a full local fallback stack, so a venue with no wifi
costs you the typeface and nothing else.

```bash
npm test                # every module
npm run test:backend    # one module
npm run accuracy        # score the pipeline against the labelled corpus
```

## Measuring accuracy

`npm run accuracy` runs the real pipeline over the labelled photographs in
`test-data/images` and scores each declaration against
`test-data/ground-truth.json`. Use it before and after any change to `ocr/` or
`extraction/`; unit tests tell you nothing about whether a real pack reads.

It reports four outcomes, and they are not equally bad:

| | meaning |
| --- | --- |
| `+` correct | read, and it matches the pack |
| `X` **wrong** | read, but it does not match — **the worst outcome** |
| `-` missed | not read, though it was legible in this frame |
| `.` n/a | not read, and genuinely not there — not a failure |

Watch the `WRONG` column, not the percentage. A missing declaration sends the
inspector to look at the pack; a confidently wrong MRP sends them away
satisfied with a false number.

Current state on the twelve-image corpus: **43% correct, 8 wrong**, from a
starting point of 12% correct and 9 wrong. Most remaining wrongs are
near-misses — a truncated but recognisable company name, a single misread
digit — which is the case for building the inspector-correction flow rather
than chasing the recogniser.

Ground truth was labelled from the photographs, and entries marked `uncertain`
(hand-stamped prices, smudged ink-jet seals) need checking against the physical
packs before they are trusted as a benchmark.

## Modules

| Folder | Job |
| --- | --- |
| `frontend/` | Inspector workspace. See `frontend/DESIGN_NOTES.md`. |
| `backend/` | API and orchestration. `app.js` is the app, `server.js` binds the port. |
| `ocr/` | Image → text blocks with boxes and confidence. |
| `extraction/` | Text blocks → the five declaration fields. |
| `rules/` | Declaration catalogue and the screening engine. |
| `report/` | Printable HTML and PDF compliance reports. |
| `contracts/` | Shared JSON formats between modules. |
| `test-data/` | Sample package images. |

## Data flow

```
photograph
   → ocr.recognize()            blocks + frame-quality metadata
   → extractDetailed()          five declarations + per-field confidence
   → screenPackage()            per-declaration outcome, findings, verdict
   → frontend / report
```

## Locked declaration fields

Unchanged, and depended on across every module:

`mrp` · `net_quantity` · `manufacturer` · `packing_date` · `consumer_care`

Each maps to a catalogue entry in `rules/catalog.json` carrying an ID
(`DECL-01`…`DECL-05`) and a clause reference, which travel together all the way
into the generated PDF.

> Clause references follow Rule 6(1) and are screening aids. Verify them against
> the notified text and the latest amendment before relying on a generated
> report as evidence.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service state, recogniser warmth, catalogue version. |
| `GET` | `/api/catalog` | The declaration catalogue the engine is applying. |
| `POST` | `/api/analyze` | Raw image bytes in, screening result out. |
| `POST` | `/api/report` | Screening result in, PDF (or HTML) out. |

`/analyze` and `/health` still answer on their original paths.

`POST /api/analyze` takes the image as the **raw request body** with a
`Content-Type` of `image/jpeg`, `image/png` or `image/webp` — not multipart.
Optional query parameters: `name`, `product`, `blocks=1` (include the full OCR
block list), `debug=1` (include the recogniser's attempt ladder).

Errors are typed so the UI can turn them into something actionable:

```json
{ "error": { "code": "OCR_TIMEOUT", "message": "Reading this image took too long…" } }
```

Codes: `NO_IMAGE`, `IMAGE_TOO_LARGE`, `UNREADABLE_FILE`, `OCR_TIMEOUT`,
`OCR_LANGDATA_MISSING`, `ANALYSIS_FAILED`, `NO_SCREENING`, `BAD_JSON`,
`NOT_FOUND`.

### Response shape

```jsonc
{
  "inspection": { "id": "042", "created_at": "…", "image": { "width": 1080, "height": 1440 } },
  "verdict": {
    "status": "NON_COMPLIANT",      // COMPLIANT | NEEDS_REVIEW | NON_COMPLIANT | INCONCLUSIVE
    "headline": "Needs human review",
    "checks_passed": 3, "checks_total": 5,
    "evidence_confidence": 0.921
  },
  "declarations": [
    {
      "id": "DECL-01", "field": "mrp", "label": "MRP",
      "status": "REVIEW",             // PASS | REVIEW | MISSING | FAIL
      "code": "LEGIBILITY",
      "value": "₹85.00",
      "note": "Printed price is visible, but the currency mark is partially obscured.",
      "box": [524, 470, 832, 546],    // original image pixels
      "citation": "Rule 6(1)(e)"
    }
  ],
  "findings": [],                     // only the declarations needing attention
  "advisory": "Suggested outcome only. Confirm against the physical pack…",
  "ocr": { "meta": { "legible": true, "variant": "sharpened" } },
  "legacy": { "overall_status": "…", "fields": {}, "violations": [] }
}
```

`legacy` is the original PASS/FAIL result, carried alongside so anything written
against the first version of the API keeps working.

### Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `5000` | API port. |
| `CORS_ORIGINS` | the two `localhost:5173` forms | Comma-separated allowlist, or `*`. |
| `OCR_TIMEOUT_MS` | `45000` | Ceiling on one recognition. |
| `VITE_API_BASE` | `http://localhost:5000` | Where the UI looks for the API. Set empty for same-origin. |

## What the system refuses to do

These behaviours are deliberate and there are tests holding each of them in
place. Please do not "simplify" them away.

**An unreadable photograph is never a violation.** A failed read does not come
back empty — it comes back as a handful of confident nonsense fragments.
Reporting that as five missing declarations would turn a glare spot or a
sideways photo into a prosecution. When `ocr` reports the frame illegible, the
verdict is `INCONCLUSIVE` and the inspector is asked for a re-shoot.

**A weak reading is reviewed, not failed.** A declaration read below its
confidence floor gets `REVIEW`, not `FAIL`. A missing declaration gets
`MISSING`. These are different problems for the inspector and the vocabulary
keeps them apart.

**A printed date is not a missing date.** Packaging prints `05/09/23`,
`MFD FEB 25` and `08/2026`. All three are read, because reporting a legible
printed declaration as absent is the same error class as the two above.

**Nothing is decided automatically.** The verdict is labelled a *screening
verdict*, the advisory sits above the action rather than below it, and the
inspector records the decision of record themselves.

## What the corpus taught us

Four findings from `test-data/images` that are not obvious from reading the
code, and that cost accuracy badly when ignored.

**Phone photographs are stored sideways.** Eight of the twelve images carry an
EXIF orientation flag of 6 or 8 — a quarter turn. Cameras keep the sensor image
in landscape and record "rotate me" as metadata rather than rotating pixels.
`sharp` returns the unrotated pixels unless asked, so Tesseract was reading
three quarters of the corpus sideways, and the reads came back looking like bad
photographs rather than a bug. `preprocess.autoOrient` fixes it and is the
single highest-value line in `ocr/`. Browsers honour the tag too, so this also
keeps the overlay boxes landing where the inspector sees the text.

**One scale is not enough.** The same photograph gives up different
declarations at different resolutions: the sugar pack yields its net weight and
care number at 2600px and its price only at 3600px. Neither wins outright, so
`ocr.recognize` returns *every* read it made and `extractAcrossReads` assembles
the five declarations from whichever read got each one best. The passes are
already paid for, so this is nearly free — and it was worth 11 points.

**Glyph confusions are systematic, not random.** `₹` reads as `%`, `ml` as
`mt`, `Mfd` as `Mid`, `Ltd` as `LTO`, `1kg` as `Ika`. Each one costs a whole
declaration if the pattern insists on correct spelling, so the common and
unambiguous ones are accepted. Every such allowance has a regression test
quoting the real OCR string that motivated it.

**Declarations are often in tables.** On a printed spec table the label sits in
one cell and the value in the next one along, arriving as two separate blocks on
the same row. Combining blocks only vertically finds nothing there, and tabular
packaging — electronics, cosmetics — was entirely invisible before
`nearbyCombinations` learned to combine horizontally.

## Notes for the team

- `rules/index.js` still exports `evaluateCompliance` with its original
  behaviour, byte for byte. `screenPackage` is the richer path and is additive.
- `extraction/index.js` keeps its exact `{value, box}` contract.
  `extraction/detailed.js` wraps it to add per-field confidence and evidence.
- The frontend opens on a demo inspection shaped identically to a real API
  response, so the demo path cannot drift away from the real one.
- Recognition now takes roughly 20s on a large photograph and up to a minute on
  the hardest, which is why `OCR_TIMEOUT_MS` defaults to 120s. This is the main
  outstanding problem. The fix is to stop running the full variant search at
  working resolution: pick the preprocessing recipe on a cheap downscaled scout
  pass, then spend the expensive passes on that one recipe. Measure with
  `npm run accuracy` before and after — the point is to lose no accuracy.
