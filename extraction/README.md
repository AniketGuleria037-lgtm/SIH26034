# Declaration extraction

This module deterministically converts OCR text blocks into the five locked
declaration fields: `mrp`, `net_quantity`, `manufacturer`, `packing_date`, and
`consumer_care`. It has no OCR, API, LLM, or compliance-rule dependency.

## Use

```js
const { extractDeclarations } = require("./index");

const declarations = extractDeclarations([
  { text: "MRP Rs. 50", box: [120, 300, 250, 340], confidence: 0.94 },
]);
```

The returned object always has exactly the five locked top-level fields. A
field without supported OCR evidence is `{ value: null, box: null }`.

Run the dependency-free checks with:

```sh
node extraction.test.js
```

## Matching and duplicate rule

Matching uses normalization, fixed keywords, and regular expressions. When
multiple blocks match one field, the block with the highest numeric
`confidence` is selected. Ties, or candidates without confidence, use the
first matching OCR block in input order. A valid source box is returned
unchanged; a malformed source box is returned as `null` while the evidenced
value is retained.
