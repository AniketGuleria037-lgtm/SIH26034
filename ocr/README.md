# OCR module

Reads a package image and returns text blocks with bounding boxes and confidence, in the exact shape `extraction/` consumes.

```
image bytes  →  [ { text, box: [x1, y1, x2, y2], confidence }, … ]
```

Coordinates are in the **original image's pixel space** regardless of any internal resizing or rotation, so `frontend/` can draw highlight boxes straight onto the photograph the inspector uploaded.

Everything runs offline. Nothing in this module makes a network call.

## Use

```js
const ocr = require("../ocr");
const { extractDeclarations } = require("../extraction");

const blocks = await ocr.recognizeToBlocks("package.jpg");
const declarations = extractDeclarations(blocks);
```

`recognizeToBlocks()` returns only the contract array. `recognize()` returns `{ blocks, meta }` where `meta` carries diagnostics — which preprocessing won, whether the image was rotated, how long it took, and whether the image was legible at all.

### Command line

```sh
node cli.js package.jpg              # readable output
node cli.js package.jpg --json       # the contract array, for piping
node cli.js package.jpg --extract    # run extraction too
node cli.js package.jpg --debug      # per-variant scores and timings
```

### Tests and benchmark

```sh
npm test        # 25 dependency-free checks
npm run bench   # field recovery across ../test-data/images
```

## Results

`npm run bench` measures what actually matters: how many of the five locked declarations survive the full OCR → extraction chain. Character accuracy is not the deliverable; fields recovered is.

| Fixture | Fields | Notes |
|---|---|---|
| compliant_biscuits | 5/5 | |
| compliant_shampoo | 5/5 | different layout and panel size |
| crowded_net_quantity | 5/5 | promotional text abutting the declaration |
| handheld_blurred | 5/5 | blur, rotation, sensor noise |
| missing_mrp | 4/4 | correctly returns `null` for MRP |
| no_consumer_care | 4/4 | correctly returns `null` |
| rotated_90 | 5/5 | orientation detected and corrected |

**33/33 declarations recovered. 100% carry a usable bounding box.** Median 3.4 s, worst case 7.5 s (the rotated image, which pays for the orientation search).

These are synthetic labels with known content. They establish that the pipeline works; they do not substitute for a trial on real packaging.

## How it works

**1 — Several preprocessing recipes, and the best one wins on merit.**
A glossy wrapper under shop lighting needs glare suppression; a faded label needs contrast stretching; a phone shot needs sharpening. Applying the wrong one is worse than doing nothing. So `preprocess.js` builds five candidates and `index.js` runs recognition on each, keeping whichever measurably scored best on that specific image.

**2 — Scoring rewards volume of confident, word-shaped text.**
Mean confidence alone is a trap: a variant finding three words at 0.95 would outrank one finding sixty at 0.88, and the second is plainly the better read. The score sums `confidence × min(length, 8)` over word-shaped tokens only.

This was not decoration. On the crowded label, segmentation mode 6 read `"Net Ot Qty: 100 g"` (score 304) and mode 11 read `"Net Qty: 100 g"` (score 328). The score picked the correct read on its own.

**3 — A two-stage search, not a full grid.**
Stage one finds the best preprocessing at the primary segmentation mode. Stage two re-runs only that winner through the remaining modes. A full variants × modes grid would roughly double runtime to test combinations that almost never win.

**4 — Orientation is tried only when the upright read looks bad.**
A package photographed sideways reads as near-total nonsense, and the symptom is indistinguishable from blur unless you actually try. Rotation costs are paid on the images that need it. The rotated fixture recovers all five fields.

**5 — Output is at line *and* wrapped-declaration granularity.**
This is the fix for the most common integration failure in this project, described below.

**6 — An unreadable image is reported as unreadable.**
`meta.legible` is `false` when two independent signals agree the read failed. See "the safety property".

## Three bugs worth knowing about

These were found by testing against the real `extraction/` module rather than by eyeballing OCR output. Each one produced *plausible-looking* OCR text that silently broke the field downstream.

### Wrapped declarations returned `null`

Indian packaging sets a caption on one line and its value on the next:

```
Manufactured & Packed by:
Sunrise Foods Private Limited
```

`extraction/` matches whole strings — its manufacturer pattern needs the name to follow "by" in the same block. At line granularity that manufacturer is unmatchable and comes back `null`, through no fault of the extractor.

Tesseract's own paragraph grouping did not solve it: it grouped `"Best Before …"` together with `"Manufactured & Packed by:"` and left the company name in a paragraph of its own.

So `lines.js` does the layout analysis itself, on pure geometry: two lines belong to one wrapped declaration when they are vertically adjacent and share a left margin. The boundary between "wrapped continuation" and "new declaration" is found per-image by Otsu clustering on the gap distribution, because a hardcoded threshold will not survive a different font. On the test labels, continuations sit at 0.25–0.74 line heights and declaration breaks at 1.03–1.78; the adaptive threshold lands at 0.885.

Merged blocks are emitted **alongside** the individual lines, never instead of them, so a declaration that fits on one line keeps its tight box for highlighting.

> A first attempt used the single widest jump in the distribution instead of Otsu. It picked 1.37 — splitting two outliers off the top rather than separating the two populations. Otsu weights by cluster size and lands correctly.

### A promotional flash corrupted the net quantity

`"FREE 10% EXTRA"` set in tiny type beside the net quantity shares its baseline. Grouping purely by vertical centre merged them, and the declaration arrived as `"Net et Ot Qty: 100 g FREE 10% ° EXTRA"` — which no extraction pattern can match.

Sharing a baseline is not enough. Text at a markedly different size is a different piece of printing, whatever row it sits on. Words are now only grouped when their heights are within 0.55–1.8× of each other.

### Debris counted as text

A failed read does not return nothing. It returns confident fragments: `"r D"`, `"a"`, `"2."`, `"i AS"`. A raw word count sees ten words and concludes the label was read.

The reliable tell is simpler than any ratio threshold: **a recognised word never contains a space.** Beyond that, three alphanumeric characters is the bar — which keeps `"20.00"` and `"Foods"` while dropping `"2."` and `"a"`.

## The safety property

If OCR recovers nothing, this module says so, rather than returning an empty array that downstream code would read as "a package with every declaration missing."

Turning a bad photograph into a compliance violation is the worst mistake this system could make, so `meta.legible` is only set `false` when two independent signals agree: fewer than five substantive tokens **and** a score below 15. Either alone happens on a sparse but perfectly readable label.

`backend/` should check it:

```js
const { blocks, meta } = await ocr.recognize(imagePath);
if (!meta.legible) {
  return res.status(422).json({
    error: "Image could not be read. Re-shoot with more light and a steadier hand.",
  });
}
```

## Wiring it into the backend

`backend/server.js` currently uses a hardcoded `fakeOcrData` array. Replacing it:

```js
const multer = require("multer");
const ocr = require("../ocr");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20e6 } });

app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const { blocks, meta } = await ocr.recognize(req.file.buffer);
    if (!meta.legible) {
      return res.status(422).json({ error: "Image could not be read. Please re-shoot." });
    }

    const declarations = extractDeclarations(
      blocks.map(({ text, box, confidence }) => ({ text, box, confidence }))
    );
    res.json({ ...evaluateCompliance(declarations), ocr: blocks, ocr_meta: meta });
  } catch (error) {
    console.error("Analysis failed:", error.message);
    res.status(500).json({ error: "Analysis could not be completed" });
  }
});
```

Call `ocr.warmup()` at server start. Worker creation costs one to two seconds, and paying it before the first request keeps that cost off the demo.

## Options

| Option | Default | Purpose |
|---|---|---|
| `variants` | `["normalized","sharpened","binarised"]` | preprocessing recipes to try |
| `granularity` | `"line+wrapped"` | `"line"`, `"wrapped"`, or both |
| `psmLadder` | `["6","11"]` | segmentation modes to search |
| `psm` | `null` | pin one mode and skip the ladder |
| `minConfidence` | `0.3` | drop blocks below this |
| `detectOrientation` | `true` | try rotations when the read looks weak |
| `lang` | `eng` | or `eng+hin` once Hindi data is installed |
| `debug` | `false` | include per-attempt scores in `meta` |

## Setup

```sh
cd ocr && npm install
```

`tessdata/eng.traineddata` (4 MB) is committed so the module works with no network. tesseract.js otherwise fetches it from a CDN, and a demo that needs the internet to read an image is a demo that fails on venue wifi.

### Hindi

Most Indian packaging is bilingual and this module has only been proved on English.

```sh
curl -L -o tessdata/hin.traineddata \
  https://github.com/tesseract-ocr/tessdata/raw/main/hin.traineddata
OCR_LANGS=eng+hin node cli.js package.jpg
```

## Files

| File | Purpose |
|---|---|
| `index.js` | public API, variant search, escalation ladder |
| `engine.js` | Tesseract worker lifecycle, offline language data |
| `preprocess.js` | five preprocessing recipes, resolution normalisation |
| `lines.js` | word → line grouping, wrapped merging, scoring |
| `cli.js` | standalone command line |
| `benchmark.js` | field-recovery measurement |
| `ocr.test.js` | 25 dependency-free checks |

## Known limitations

- **English only, in practice.** Hindi is one command away but untested.
- **Synthetic fixtures.** Recovery is 100% on labels rendered by a script. Real packaging — curved bottles, foil, glare, dense artwork — will be lower.
- **Flat surfaces assumed.** No dewarping for cylindrical packaging; text around a bottle's curve will degrade.
- **First call is slow.** Worker startup is 1–2 s. Use `warmup()`.
- **No handwriting, no unusual display faces.**
