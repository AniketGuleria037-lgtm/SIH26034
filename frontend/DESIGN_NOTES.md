# PackCheck — design direction

The visual direction is fixed by the reference screenshots supplied by the team,
so this is a specification of that direction rather than an exploration of
alternatives.

An alternative direction was built and then reverted at the team's request: a
cool paper-and-indigo palette in the register of government stationery, with the
verdict as a strip across the head of the record rather than a card beside the
photograph, and status as a gutter mark rather than a pill. If that is ever
wanted back, the whole of it lived in `tokens.css`, `app.css`, `VerdictPanel.jsx`
and `DemoPack.jsx` — no other module was touched.

Two fixes made during that detour were KEPT, because they are corrections rather
than styling:

- The stage takes its aspect ratio from the photograph (set inline in
  `EvidenceFrame.jsx`) instead of a fixed shape in CSS. A fixed shape
  letterboxed portrait phone frames into a postage stamp. **The aspect must be
  declared in one place only** — when CSS and the component each held their own
  copy, they drifted apart and every overlay box slid sideways off the text it
  was pointing at, silently, because the boxes still looked plausible.
- Values are set with `font-variant-numeric: tabular-nums`, so five
  declarations read down a column with their figures in line. An inspector is
  comparing them against a pack held in their other hand.

## The subject

A Legal Metrology inspector works in the world of **verified weights and
measures**: brass seal presses, verification stamps struck into metal, enamel
gauge plates, calibration certificates, government record forms filled in by
hand. The output of their day is not a dashboard, it is a **record** — a signed
statement of what was found on a particular pack at a particular time, which may
have to stand up later.

So the screen is built as a record being compiled, not a dashboard being
monitored. Two consequences:

- **Data is set like data.** Every measured value is monospaced with tabular
  figures and right-aligned, so five declarations read down a column with their
  decimal points in line. An inspector is comparing them against a pack held in
  their other hand.
- **Colour is evidence, not decoration.** The screen is almost monochrome. The
  one red means a declaration is adverse. Because nothing else is red, it is
  visible across a room and cannot be mistaken for styling.

## Palette

Cool paper and indigo ink — the register of Indian government stationery, and a
deliberate move away from the cream-and-clay cluster.

| Token | Hex | Role |
| --- | --- | --- |
| `--paper` | `#ECEDEA` | workspace ground, cool not cream |
| `--panel` | `#FFFFFF` | record surfaces, plain white and honest |
| `--ink` | `#15212C` | text; blue-black, not tinted near-black |
| `--chrome` | `#1B2A37` | the instrument housing of the sidebar |
| `--indigo` | `#27507F` | actions, and only actions |
| `--stamp` | `#AE3326` | adverse findings, and nothing else |
| `--verified` | `#2E6A48` | a cleared check |
| `--brass` | `#8E7127` | a declaration not found |
| `--rule` | `#D2D5D1` | structure |

## Type

Two families, each with one job, and neither one a default reach.

- **Archivo** for everything read as language. It has a real weight range and
  sits slightly narrow, which is what lets a dense declaration table stay
  legible without shrinking.
- **IBM Plex Mono** for everything read as measurement: values, declaration
  numbers, rule citations, timestamps. Plex's register is engineering and
  documentation rather than code editor, which is the right voice for a
  compliance record.

No display serif. It was doing nothing but signalling taste.

Headings are set tight and large and left-aligned. There are no caps labels
above them: a heading that needs a label above it is not a heading.

## Structure

```
┌──────────┬──────────────────────────────────────────────────────┐
│ PackCheck│ Inspection 042            14 Feb 2025 · demo   [⤓]  │
│          ├──────────────────────────────────────────────────────┤
│ Active   │ NEEDS HUMAN REVIEW ▏ 3 of 5 cleared ▏ 92.1% evidence │
│ Queue  04├──────────────────────────────────────────────────────┤
│ Rules    │ ┌───────────────────────────┐ ┌────────────────────┐ │
│          │ │                           │ │ Two checks need    │ │
│          │ │     the photograph        │ │ attention…         │ │
│          │ │     (the hero)            │ │                    │ │
│          │ │   ▭MRP  ▭NET QTY          │ │ ▎MRP needs a look  │ │
│          │ │                           │ │ ▎No packing date   │ │
│          │ └───────────────────────────┘ └────────────────────┘ │
│ A. Rao   │ Declarations                                         │
│ + New    │ ▏01  MRP              Rule 6(1)(e)   ₹ 85.00  REVIEW │
└──────────┴──────────────────────────────────────────────────────┘
```

The verdict is a **record header strip** across the top of the work area rather
than a card competing with the photograph. It states the outcome once, in words,
at size — then gets out of the way.

Surfaces are separated by rules and by a single step of tone. No shadows
anywhere: a shadow implies a thing floating above another thing, and nothing
here floats. One 3px radius, on panels and controls alike, because the
distinction was never carrying information.

Status is a 3px bar in a fixed left gutter plus the word. A pastel pill for each
of four states turns the table into confetti and makes the one state that
matters no louder than the three that don't.
