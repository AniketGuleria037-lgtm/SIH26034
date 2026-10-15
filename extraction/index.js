"use strict";

/**
 * Declaration extraction.
 *
 * Turns OCR text blocks into the five locked declaration fields. The output
 * contract is fixed and must not change: every field is {value, box}, with
 * null/null when nothing was found. See contracts/extraction.json.
 *
 * Everything below is shaped by what OCR actually returns from photographs of
 * real Indian packaging (test-data/images, scored by test-data/accuracy.js),
 * not by what the labels look like to a human reading the pack. Three findings
 * from that corpus drive most of the design:
 *
 * 1. DECLARATIONS ARE OFTEN IN TABLES. On a printed spec table the label sits
 *    in one cell and the value in the cell beside it, so they arrive as two
 *    separate blocks on the same row. Combining blocks only vertically finds
 *    nothing here. Blocks are therefore combined horizontally too.
 *
 * 2. THE LABEL IS RARELY ADJACENT TO ITS VALUE. Real text reads
 *    "MRP (incl. of all taxes) : 100.00", "Maximum retail price per unit
 *    (Inclusive of all taxes) ₹999.00", "MFD. (M) & Use Before (U): M 10/24".
 *    Rather than enumerate every arrangement, a bounded gap is allowed between
 *    label and value — but the gap may not contain digits, and may not contain
 *    another declaration's keywords. Without the first rule the pattern would
 *    skip over the real value to a later number; without the second it would
 *    happily read a net weight as a price.
 *
 * 3. GLYPHS ARE MISREAD IN PREDICTABLE WAYS. "₹" comes back as "%", "ml" as
 *    "mt", "Mfd" as "Mid", "Ltd" as "LTO". These are not random noise, they are
 *    systematic confusions between similar shapes, and each one costs a whole
 *    declaration if the pattern insists on the correct spelling. Where a
 *    confusion is common and unambiguous in context, it is accepted.
 */

const FIELD_NAMES = [
  "mrp",
  "net_quantity",
  "manufacturer",
  "packing_date",
  "consumer_care",
];

function emptyResult() {
  return Object.fromEntries(
    FIELD_NAMES.map((field) => [field, { value: null, box: null }]),
  );
}

function normalizeText(text) {
  return String(text)
    .replace(/â‚¹/g, "₹")
    .replace(/\s+/g, " ")
    .trim();
}

function validBox(box) {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  );
}

function usableBlocks(ocrBlocks) {
  if (!Array.isArray(ocrBlocks)) return [];

  return ocrBlocks
    .map((item, index) => {
      if (!item || typeof item.text !== "string") return null;

      const text = normalizeText(item.text);

      if (!text) return null;

      return {
        text,
        box: validBox(item.box) ? item.box : null,
        confidence:
          typeof item.confidence === "number" &&
          Number.isFinite(item.confidence)
            ? item.confidence
            : null,
        index,
      };
    })
    .filter(Boolean);
}

function mergeBoxes(a, b) {
  if (!a || !b) return a || b || null;

  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function combinedConfidence(a, b) {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;

  return Math.min(a, b);
}

/* ---------------- shared pattern building ---------------- */

/**
 * A bounded run of characters allowed between a label and its value.
 *
 * Two guards make this safe to use:
 *
 *   - `[^0-9\n]` excludes digits, so the gap can never step OVER a number to
 *     reach a later one. The first number after the label is the one read.
 *   - the negative lookahead rejects any position where another declaration's
 *     keyword begins, so "MRP" cannot reach across to a net weight, and a
 *     packing-date label cannot reach a price.
 *
 * @param {number} max how many characters of slack to allow
 * @param {string[]} forbidden keywords that must not appear in the gap
 */
function gap(max, forbidden) {
  const barrier = forbidden.join("|");
  return `(?:(?!${barrier})[^0-9\\n]){0,${max}}`;
}

// Keywords that mark the start of a DIFFERENT declaration or a nutrition
// figure. Used as gap barriers so labels cannot reach each other's values.
const OTHER_FIELDS = [
  "net",
  "qty",
  "quantity",
  "weight",
  "wt",
  "gross",
  "content",
  "batch",
  "lot",
  "b\\.?no",
  "lic",
  "fssai",
  "energy",
  "protein",
  "sodium",
  "carbohydrate",
  "fat",
  "sugar",
  "serve",
  "barcode",
];

const PRICE_WORDS = ["m\\.?r\\.?p", "price", "rs\\b", "inr"];
const DATE_WORDS = ["mfd", "mfg", "pkd", "expiry", "use\\s*by", "best\\s*before"];

/* ---------------- MRP ---------------- */

/*
 * The currency mark is the single most misread glyph on a pack. "₹" comes back
 * as "%", "?", "z", "F", "€" or "X" depending on print quality — one corpus
 * image reads "Max. Retail Price % 100.00". Since the MRP label has already
 * been matched by the time we look, an unrecognised mark before the number is
 * not ambiguous, so the mark is simply optional rather than enumerated.
 */
const CURRENCY_MARK = /(?:₹|â‚¹|\brs\.?\b|\binr\b)/i;

const PRICE_LABEL =
  "(?:m\\s*\\.?\\s*r\\s*\\.?\\s*p\\s*\\.?|max(?:imum)?\\.?\\s*retail\\s*(?:sale\\s*)?price|retail\\s*sale\\s*price)";

/**
 * A number that is a RATE, not a price: "0.15/g", "1.38/ml", "0.18 Per g".
 *
 * Packs print the per-gram rate right beside the MRP, and it is always the
 * smaller and more precise number, so mistaking it for the price is both easy
 * and badly wrong.
 */
const RATE_SUFFIX = /^\s*(?:\/|per\b)\s*(?:g|gm|kg|ml|l|ltr|litre|unit|pc)\b/i;

/*
 * Prices on a pack that are NOT the retail sale price.
 *
 * A single label can carry three or four figures: the MRP, a discounted offer
 * price, a unit sale price per gram, and a nutrition "per serve" value. Only
 * the MRP is the statutory declaration under Rule 6(1)(e). One corpus pack
 * prints "MRP 140.00" directly above "OFFER PRICE 99.00", and reporting the
 * offer price would be a confident error on the exact field where a confident
 * error is most damaging.
 *
 * Used to veto the unlabelled currency fallback, which has no way of knowing
 * which figure it has found.
 */
const OTHER_PRICES =
  /offer\s*price|unit\s*sale|u\.?s\.?p\b|\bns\s*\/?\s*bv\b|per\s*serve|discount|save\s*\d|\bmop\b/i;

/**
 * Is this number plausibly a retail price?
 *
 * Without this check the currency fallback reads "₹2" and "₹4" out of print
 * noise, and "₹2027" out of a use-by year sitting beside the price. A wrong
 * price is the most damaging output this module can produce — it sends an
 * inspector away satisfied with a false number — so a number has to look like
 * money before it is reported as money.
 *
 * A bare single digit is rejected: real MRPs below ₹10 are printed with paise
 * ("₹5.00"), and a lone digit is almost always a fragment.
 */
function plausiblePrice(raw) {
  const hasPaise = raw.includes(".");
  const rupees = parseFloat(raw);

  if (!Number.isFinite(rupees) || rupees <= 0) return false;
  if (!hasPaise && raw.replace(/^0+/, "").length < 2) return false;

  // A four-digit whole number in the 1900-2099 range beside a date label is a
  // year, not a price. Genuine four-figure prices are printed with paise.
  if (!hasPaise && rupees >= 1900 && rupees <= 2099) return false;

  return true;
}

function matchMrp(text) {
  const labeled = new RegExp(
    `${PRICE_LABEL}${gap(46, [...OTHER_FIELDS, "unit\\s*sale", "u\\.?s\\.?p"])}` +
      `(\\d{1,7}(?:\\.\\d{1,2})?)`,
    "i",
  ).exec(text);

  if (
    labeled &&
    plausiblePrice(labeled[1]) &&
    !RATE_SUFFIX.test(text.slice(labeled.index + labeled[0].length))
  ) {
    return `₹${labeled[1]}`;
  }

  // No label, but an explicit currency mark against a number. Weaker evidence,
  // so it only fills a gap that the labelled pass could not.
  const standalone = /(?:rs\.?|inr|₹|â‚¹)\s*(\d{1,7}(?:\.\d{1,2})?)\b/i.exec(text);

  if (
    standalone &&
    plausiblePrice(standalone[1]) &&
    !RATE_SUFFIX.test(text.slice(standalone.index + standalone[0].length)) &&
    !OTHER_PRICES.test(text.slice(0, standalone.index))
  ) {
    return `₹${standalone[1]}`;
  }

  return null;
}

/* ---------------- NET QUANTITY ---------------- */

/*
 * Unit spellings seen on packaging, plus the OCR confusions that matter.
 *
 * "ml" is read as "mt" or "mi" constantly, because the l is a bare vertical
 * stroke; "kg" becomes "kq". Refusing those spellings means reporting a clearly
 * printed net quantity as absent, which is the failure this system exists to
 * avoid.
 *
 * "unit", "u" and "n" are here because Rule 6 allows quantity to be declared by
 * NUMBER as well as by weight or measure. A cable declaring "Qty 1 Unit" is
 * compliant, and reading it as a missing declaration would be wrong.
 */
const UNIT_SPELLINGS = {
  g: "g", gm: "g", gms: "g", gr: "g", gram: "g", grams: "g", gmss: "g",
  kg: "kg", kgs: "kg", kq: "kg", kgm: "kg",
  ml: "ml", mls: "ml", mt: "ml", mi: "ml", rnl: "ml", mll: "ml",
  l: "l", ltr: "l", ltrs: "l", lit: "l", litre: "l", litres: "l",
  liter: "l", liters: "l",
  unit: "unit", units: "unit", u: "unit", n: "unit", nos: "unit",
  pc: "unit", pcs: "unit", piece: "unit", pieces: "unit",
};

// Longest-first so "gms" is preferred over "g" and "litres" over "l".
const UNIT_PATTERN = Object.keys(UNIT_SPELLINGS)
  .sort((a, b) => b.length - a.length)
  .join("|");

function standardUnit(raw) {
  return UNIT_SPELLINGS[String(raw).toLowerCase()] || String(raw).toLowerCase();
}

/*
 * "Gross Wt." is included deliberately.
 *
 * Declaring gross rather than net weight is itself a compliance problem, and
 * one corpus pack does exactly that. Extracting the value means the inspector
 * sees the declaration and can judge the label wording; refusing to read it
 * would report the field as absent, which tells them less.
 */
const QUANTITY_LABEL =
  "(?:net\\s*(?:weight|wt\\.?|qty\\.?|quantity|content|ory)?|gross\\s*(?:weight|wt\\.?)|qty\\.?|quantity)";

/*
 * Quantity declared by number rather than by weight or measure.
 *
 * Rule 6 permits it, and packs of small goods use it: "1 SET OF 5 COMBS",
 * "5 PIECES", "NET QUANTITY: 2 N". The set form is read as the number of sets
 * rather than the number of items, because that is the declared quantity of
 * the commodity being sold; a reader wanting the item count has the label text.
 *
 * OCR frequently loses the item count anyway. On the corpus pack above it
 * returns "1 SET OF SCOMBS", the 5 read as an S, which is a further reason to
 * anchor on the leading number.
 */
function matchCountedQuantity(text) {
  const set = new RegExp(
    `${QUANTITY_LABEL}${gap(24, [...PRICE_WORDS, ...DATE_WORDS])}(\\d+)\\s*(?:x\\s*)?(?:sets?|pkts?|packets?|pouch(?:es)?)\\b`,
    "i",
  ).exec(text);

  if (set) return `${set[1]} unit`;

  const counted = new RegExp(
    `${QUANTITY_LABEL}${gap(24, [...PRICE_WORDS, ...DATE_WORDS])}(\\d+)\\s*(?:units?|nos?\\.?|pcs?|pieces?|\\bn\\b)(?![a-z])`,
    "i",
  ).exec(text);

  if (counted) return `${counted[1]} unit`;

  return null;
}

function matchNetQuantity(text) {
  const labeled = new RegExp(
    `${QUANTITY_LABEL}${gap(30, [
      ...PRICE_WORDS,
      ...DATE_WORDS,
      "energy",
      "serve",
      "protein",
      "sodium",
    ])}(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\b`,
    "i",
  ).exec(text);

  if (labeled) {
    return `${labeled[1]} ${standardUnit(labeled[2])}`;
  }

  // A unit of weight or measure is preferred, so counted quantities are only
  // consulted once that has failed.
  return matchCountedQuantity(text);
}

/* ---------------- PACKING DATE ---------------- */

const MONTH_NUMBERS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const MONTH_PATTERN = Object.keys(MONTH_NUMBERS).join("|");

/*
 * Date label alternatives.
 *
 * "mf[dgio0]" and "pk[dgio0]" accept the final letter as d, g, i, o or zero.
 * Small ink-jetted capitals on a crumpled seal confuse these constantly — one
 * corpus pack reads "Mid & Pkd By", another "MFO USE BY" — and the misread
 * letter costs the whole declaration if the pattern insists on the right one.
 *
 * "Month & Year of Manufacturing/Import" and "Date of Packaging" are spelled
 * out because both appear on the corpus and neither contains "mfd" or "pkd".
 */
const DATE_LABEL =
  "(?:(?:month|date|dt)\\s*(?:&|and)?\\s*(?:year)?\\s*(?:of)?\\s*)?" +
  "(?:mf[dgio0]|pk[dgio0]|manufactur\\w*|packag\\w*|pack(?:ed|ing)?|import)";

// Separators between date parts. Ink-jet printing drops slashes, so "05.09.23"
// is as common as "05/09/23".
const SEP = "[\\/\\-.]";

/**
 * Two-digit years are read as 2000s.
 *
 * Packaging almost universally prints "23" rather than "2023". Refusing it
 * means reporting a printed, legible date as a missing declaration.
 */
function expandYear(raw) {
  const year = String(raw);
  return year.length === 2 ? `20${year}` : year;
}

function matchPackingDate(text) {
  const slack = gap(34, [...PRICE_WORDS, "net", "qty", "quantity", "batch", "lot", "lic", "fssai"]);

  /*
   * Full day/month/year. The month is the SECOND component: Indian packaging
   * follows DD/MM/YY. A pack printing "MFD & USE BY: 05/09/23 & 02/05/24" gives
   * two dates, and anchoring on the manufacture label means the first — the
   * packing date — is read, not the use-by date.
   *
   * The two-digit year carries a negative lookahead so "08/2026" cannot be
   * misread as August 2020 by matching only its first two digits.
   */
  const fullDate = new RegExp(
    `${DATE_LABEL}${slack}(\\d{1,2})\\s*${SEP}\\s*(\\d{1,2})\\s*${SEP}\\s*(\\d{4}|\\d{2}(?!\\d))`,
    "i",
  ).exec(text);

  if (fullDate) {
    return `${fullDate[2].padStart(2, "0")}/${expandYear(fullDate[3])}`;
  }

  // Month and year only. A single-digit month is accepted and padded, because
  // hand-stamped seals print "4/26".
  const monthYear = new RegExp(
    `${DATE_LABEL}${slack}(0?[1-9]|1[0-2])\\s*${SEP}\\s*(\\d{4}|\\d{2}(?!\\d))`,
    "i",
  ).exec(text);

  if (monthYear) {
    return `${monthYear[1].padStart(2, "0")}/${expandYear(monthYear[2])}`;
  }

  /*
   * A date run together with no separators: "14JUL26", "05SEP2025".
   *
   * Ink-jet coders print this to save characters on a narrow seal, and it is
   * common on snack packaging. Without it a clearly printed date reads as a
   * missing declaration.
   */
  const runTogether = new RegExp(
    `${DATE_LABEL}${slack}(\\d{1,2})\\s*(${MONTH_PATTERN})[a-z]*\\s*(\\d{4}|\\d{2}(?!\\d))`,
    "i",
  ).exec(text);

  if (runTogether) {
    return `${MONTH_NUMBERS[runTogether[2].toLowerCase().slice(0, 3)]}/${expandYear(
      runTogether[3],
    )}`;
  }

  // Month printed as a word: "May 2026", "MFD FEB 25".
  const namedMonth = new RegExp(
    `${DATE_LABEL}${slack}(${MONTH_PATTERN})[a-z]*\\.?\\s*[,\\-]?\\s*(\\d{4}|\\d{2}(?!\\d))`,
    "i",
  ).exec(text);

  if (namedMonth) {
    return `${MONTH_NUMBERS[namedMonth[1].toLowerCase().slice(0, 3)]}/${expandYear(
      namedMonth[2],
    )}`;
  }

  return null;
}

/* ---------------- MANUFACTURER ---------------- */

/*
 * Maker labels chain together in every combination a drafting lawyer could
 * think of: "Manufactured & Packed by", "Mfd & Pkd By", "Processed & Packed
 * by", "Manufactured, Marketed & Packed by". Rather than list the
 * permutations, one or more maker words are matched followed by "by".
 */
const MAKER_WORD =
  "(?:manufactured|manufacturer|manufacture|mf[dgio0]|packed|pkd|pkg|marketed|processed|imported|importer|packer)";

const MAKER_LABEL = `(?:${MAKER_WORD}[\\s.,&/]*(?:and[\\s.,&/]*)?)+by\\b`;

/*
 * Indian company-name endings.
 *
 * This is the fallback when no "…by" label is found, and it is what rescues
 * "Manufactured, HammerLifestyle PVT LTO Sectar-25" — where OCR dropped the
 * "by" entirely and mangled "LTD". Almost every registered packer name on the
 * corpus ends in one of these, which makes the suffix a far more reliable
 * anchor than the label.
 *
 * "lt[do0]" accepts the LTD/LTO confusion.
 */
/*
 * Endings that mark a registered entity name.
 *
 * A bare "co" was in this list and had to come out: it matched "Choco Delight"
 * on a peanut butter jar, which was then reported as the manufacturer of a pack
 * whose maker was not even in the frame. Two letters is not enough evidence of
 * a company, and the cost of being wrong on this field is high.
 */
const COMPANY_SUFFIX =
  "(?:pvt|private|lt[do0]|limited|llp|\\binc\\b|industries|industry|enterprises|enterprise|foods|mills|traders|agro|corporation|company|\\bco\\.)";

/*
 * Matched case-insensitively, because packs set the company name in full caps
 * as often as in title case: "HAMMER LIFESTYLE PVT LTD", "UTTAM SUGAR MILLS
 * LTD.", "SINGLA ENTERPRISES". A case-sensitive suffix list quietly matched
 * only "Pvt" and missed every shouted name on the corpus.
 *
 * The "starts with a capital" signal is still wanted, but a case-insensitive
 * character class cannot express it, so it is checked in code below instead.
 */
const COMPANY_NAME = new RegExp(
  `([A-Za-z][A-Za-z&.'\\-]*(?:\\s+[A-Za-z&.'\\-]+){0,5}\\s*\\.?,?\\s*${COMPANY_SUFFIX}\\b[.,]?(?:\\s*${COMPANY_SUFFIX}\\b[.,]?)?)`,
  "i",
);

/*
 * Lines that begin an ADDRESS rather than a name.
 *
 * The address always follows the company name, and OCR merges the two often
 * enough that a naive label match returns "Trunk Road Panipat, Haryana"
 * instead of "Hammer Lifestyle PVT LTD". Reporting a street as the
 * manufacturer is worse than reporting nothing, because it looks like a real
 * answer.
 */
const ADDRESS_START =
  /^(?:plot|road|street|st\.|sector|sec\b|near|opp|behind|village|post|district|dist|tehsil|floor|survey|khasra|gali|lane|block|phase|area|industrial|trunk|unit|p\.?o\.?\b|no\.?\s*\d)/i;

function cleanName(name) {
  return String(name)
    .trim()
    .replace(/^[,:;\-\s]+/, "")
    // OCR routinely prefixes a line with one or two junk characters picked up
    // from the label's colon or a printing artefact.
    .replace(/^(?:[a-z]{1,2}|[^A-Za-z0-9]{1,3})\s+/, "")
    .replace(/[;,]+$/, "")
    .trim();
}

function looksLikeName(name) {
  if (!name || name.length < 3) return false;
  if (ADDRESS_START.test(name)) return false;

  // At least half the characters should be letters. A capture that is mostly
  // punctuation and stray marks is OCR debris, not a company.
  const letters = (name.match(/[A-Za-z]/g) || []).length;
  return letters >= 3 && letters / name.length > 0.5;
}

function matchManufacturer(text) {
  const labeled = new RegExp(`${MAKER_LABEL}\\s*[:\\-]?\\s*(.+)$`, "i").exec(text);

  if (labeled) {
    const name = cleanName(labeled[1]);
    if (looksLikeName(name)) return name;
  }

  return null;
}

/**
 * Company-name fallback, used only where the labelled match failed.
 *
 * Kept separate from matchManufacturer so it can be applied with a preference
 * for blocks that sit near a maker label, rather than grabbing the first
 * company name on the pack — which is often the packaging-film supplier.
 */
function matchCompanyName(text) {
  const found = COMPANY_NAME.exec(text);
  if (!found) return null;

  const name = cleanName(found[1]);

  if (name.length < 5 || !looksLikeName(name)) return null;

  // A registered name is capitalised. A run of lowercase words that happens to
  // end in "co" or "inc" is prose, not a company.
  if (!/^[A-Z]/.test(name)) return null;

  return name;
}

/* ---------------- CONSUMER CARE ---------------- */

/*
 * Numbers on a pack that must never be read as a phone number: FSSAI licence
 * numbers (14 digits), barcodes (13), batch codes, GST numbers. They sit right
 * next to the care details and are the main source of false positives.
 */
const NOT_A_PHONE = /lic\.?\s*no|fssai|batch|b\.?no|barcode|gstin|\bcin\b|art\.?\s*-?no/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const PHONE_PATTERNS = [
  // Toll-free, the most common consumer-care route on Indian packaging.
  /\b1800[\s-]?\d{2,4}[\s-]?\d{3,4}\b/,
  // Mobile with an optional country code.
  /(?:\+\s*91[\s-]*)?\b[6-9]\d{4}[\s-]?\d{5}\b/,
  // STD code then a landline, with or without a separator between them:
  // "0180-4008081", "(022) 62487999", "0120-4525000".
  /\(?\b0\d{2,4}\)?[\s-]?\d{6,8}\b/,
  // A bare ten-digit mobile, printed without any grouping at all.
  /\b[6-9]\d{9}\b/,
];

/**
 * Is this match sitting inside a longer run of digits?
 *
 * FSSAI licence numbers are 14 digits, barcodes 13, GST numbers 15, and they
 * are printed right beside the consumer-care block. A phone pattern will
 * happily match a ten-digit window inside one of them — the rusk pack returned
 * "0017011004791", a slice of its FSSAI licence, as a care number.
 *
 * The keyword guard above catches these only when the label made it into the
 * same OCR block, which it often does not. So the digit run itself is checked:
 * no telephone number in India is twelve digits long, with or without its
 * country code.
 */
function insideLongerNumber(text, match) {
  const start = text.indexOf(match);
  if (start === -1) return false;

  let from = start;
  while (from > 0 && /[\d]/.test(text[from - 1])) from--;

  let to = start + match.length;
  while (to < text.length && /[\d]/.test(text[to])) to++;

  const run = text.slice(from, to).replace(/\D/g, "");
  return run.length > 12;
}

function matchConsumerCare(text) {
  const email = EMAIL.exec(text);
  if (email) return email[0];

  if (NOT_A_PHONE.test(text)) return null;

  for (const pattern of PHONE_PATTERNS) {
    const found = pattern.exec(text);
    if (!found) continue;
    if (insideLongerNumber(text, found[0])) continue;

    return found[0].replace(/\s+/g, " ").trim();
  }

  return null;
}

const MATCHERS = {
  mrp: matchMrp,
  net_quantity: matchNetQuantity,
  manufacturer: matchManufacturer,
  packing_date: matchPackingDate,
  consumer_care: matchConsumerCare,
};

function bestCandidate(candidates) {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    const bestScore =
      best.block.confidence === null ? -Infinity : best.block.confidence;

    const candidateScore =
      candidate.block.confidence === null
        ? -Infinity
        : candidate.block.confidence;

    return candidateScore > bestScore ? candidate : best;
  });
}

/* ---------------- block combination ---------------- */

function heightOf(box) {
  return box[3] - box[1];
}

/** How much two boxes overlap vertically, as a fraction of the shorter one. */
function rowOverlap(a, b) {
  const top = Math.max(a[1], b[1]);
  const bottom = Math.min(a[3], b[3]);
  const shortest = Math.min(heightOf(a), heightOf(b)) || 1;
  return Math.max(0, bottom - top) / shortest;
}

/**
 * Create combinations of nearby OCR blocks.
 *
 * Two geometries matter, and missing either one loses declarations:
 *
 *   VERTICAL, for a caption above its value:
 *     "Manufactured By:"
 *     "PepsiCo India Holdings Pvt. Ltd."
 *
 *   HORIZONTAL, for a printed spec table, where the label is in one cell and
 *   the value in the next one along:
 *     "Maximum retail price per unit"  |  "₹999.00/-"
 *     "Month & Year of Manufacturing"  |  "May 2026"
 *
 *   Tabular packaging — electronics, cosmetics, anything with a declarations
 *   table — is entirely horizontal, and was invisible before this.
 */
function nearbyCombinations(blocks) {
  const combinations = [];

  for (let i = 0; i < blocks.length; i++) {
    combinations.push({
      text: blocks[i].text,
      box: blocks[i].box,
      confidence: blocks[i].confidence,
      index: blocks[i].index,
    });

    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];

      if (!a.box || !b.box) continue;

      const sameRow = rowOverlap(a.box, b.box) > 0.35;
      const horizontalGap = Math.max(b.box[0] - a.box[2], a.box[0] - b.box[2]);
      const verticalDistance = Math.abs(b.box[1] - a.box[3]);

      // A table cell and its neighbour. The allowance scales with line height
      // so it holds for both a tight cosmetics label and a large poster panel.
      const adjacentCell = sameRow && horizontalGap < Math.max(360, heightOf(a.box) * 14);

      // A caption and the line under it.
      const nextLine = !sameRow && verticalDistance <= 160;

      if (!adjacentCell && !nextLine) continue;

      combinations.push({
        text: `${a.text} ${b.text}`,
        box: mergeBoxes(a.box, b.box),
        confidence: combinedConfidence(a.confidence, b.confidence),
        index: Math.min(a.index, b.index),
      });
    }
  }

  return combinations;
}

/* ---------------- extraction ---------------- */

const MAKER_HINT = new RegExp(`${MAKER_WORD}|packer|\\bby\\b`, "i");

/**
 * Fill the manufacturer from a company-name ending, preferring names that sit
 * near a maker label.
 *
 * Order matters here. A pack names several companies — the packer, the
 * marketer, the packaging-film supplier, sometimes a testing laboratory — and
 * taking the first one found is how you end up reporting the film supplier as
 * the manufacturer. Proximity to a maker label is the tiebreaker.
 */
function manufacturerFromCompanyName(blocks) {
  const candidates = [];

  for (let i = 0; i < blocks.length; i++) {
    const name = matchCompanyName(blocks[i].text);
    if (!name) continue;

    const hasHintHere = MAKER_HINT.test(blocks[i].text);
    const hintAbove =
      i > 0 &&
      MAKER_HINT.test(blocks[i - 1].text) &&
      blocks[i - 1].box &&
      blocks[i].box &&
      Math.abs(blocks[i].box[1] - blocks[i - 1].box[3]) <= 120;

    candidates.push({
      name,
      box: blocks[i].box,
      // Same block as the label beats the line below it, which beats no label
      // anywhere near.
      rank: hasHintHere ? 0 : hintAbove ? 1 : 2,
      confidence: blocks[i].confidence === null ? -Infinity : blocks[i].confidence,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => a.rank - b.rank || b.confidence - a.confidence);
  return candidates[0];
}

function extractDeclarations(ocrBlocks) {
  const result = emptyResult();
  const blocks = usableBlocks(ocrBlocks);

  if (blocks.length === 0) {
    return result;
  }

  /*
   * First pass: each OCR block on its own, for every field.
   *
   * Single-block matches are resolved before any combining, because a combined
   * block can only add surrounding text and so can only make a match less
   * precise. It also stops the split-label fallback below from misfiring: given
   *
   *   "Manufactured & Packed by: Acme Foods Pvt. Ltd."
   *   "Packing Date: 08/2026"
   *
   * the label line matches "packed by", so a fallback that reaches for the NEXT
   * line would report the packing date as the manufacturer — even though the
   * name was sitting on the label line all along.
   */
  for (const field of FIELD_NAMES) {
    const candidates = blocks
      .map((block) => ({
        value: MATCHERS[field](block.text),
        block,
      }))
      .filter((candidate) => candidate.value !== null);

    const candidate = bestCandidate(candidates);

    if (candidate) {
      result[field] = {
        value: candidate.value,
        box: candidate.block.box,
      };
    }
  }

  // A maker label with its name on the line below, which is how most rear
  // panels are set.
  if (result.manufacturer.value === null) {
    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i];
      const next = blocks[i + 1];

      if (!new RegExp(MAKER_LABEL, "i").test(current.text)) {
        continue;
      }

      if (!next.text || next.text.length < 3) {
        continue;
      }

      if (current.box && next.box) {
        const verticalGap = next.box[1] - current.box[3];

        if (verticalGap < -20 || verticalGap > 100) {
          continue;
        }
      }

      const name = cleanName(next.text);
      if (name.length < 3) continue;

      result.manufacturer = {
        value: name,
        box: mergeBoxes(current.box, next.box),
      };

      break;
    }
  }

  // Consumer-care details are spread over several lines more often than not, so
  // the search starts from the label and walks forward.
  if (result.consumer_care.value === null) {
    const labelIndex = blocks.findIndex((block) =>
      /consumer\s+(?:care|feedback|complaint)|customer\s+care|care\s+executive|helpline|toll\s*free|contact\s*us/i.test(
        block.text,
      ),
    );

    if (labelIndex !== -1) {
      for (
        let i = labelIndex;
        i < Math.min(blocks.length, labelIndex + 12);
        i++
      ) {
        const candidate = matchConsumerCare(blocks[i].text);

        if (candidate) {
          result.consumer_care = {
            value: candidate,
            box: blocks[i].box,
          };
          break;
        }
      }
    }
  }

  /*
   * Second pass: nearby blocks together, vertically and horizontally.
   */
  const combinedBlocks = nearbyCombinations(blocks);

  for (const field of FIELD_NAMES) {
    if (result[field].value !== null) continue;

    const candidates = combinedBlocks
      .map((block) => ({
        value: MATCHERS[field](block.text),
        block,
      }))
      .filter((candidate) => candidate.value !== null);

    const candidate = bestCandidate(candidates);

    if (candidate) {
      result[field] = {
        value: candidate.value,
        box: candidate.block.box,
      };
    }
  }

  /*
   * Prefer a registered company name over anything else.
   *
   * A labelled match is good evidence that we found the right LINE, but not
   * that we captured the right part of it: OCR merges a maker label with the
   * address continuation below it often enough that "Marketed Packed by |
   * Trunk Road Panipat" wins the label match while the actual name,
   * "HammerLifestyle PVT LTO", sits in a neighbouring block where OCR dropped
   * the "by" altogether.
   *
   * A name ending in Pvt/Ltd/Industries/Enterprises/Mills is almost certainly
   * the registered packer, so it overrides a labelled capture that has no such
   * ending. Proximity to a maker label still decides between several company
   * names on one pack — a rear panel names the packer, the marketer, and often
   * the packaging-film supplier too.
   */
  const hasSuffix = new RegExp(`${COMPANY_SUFFIX}\\b`, "i");

  if (result.manufacturer.value === null || !hasSuffix.test(result.manufacturer.value)) {
    const named = manufacturerFromCompanyName(blocks);

    /*
     * A company name is only accepted when a maker label sits in the same block
     * or the one above it (rank 0 or 1).
     *
     * Accepting rank 2, a company name found anywhere on the pack, looked like
     * free recall and was actually a confident-error generator: rear panels name
     * the marketer, the testing laboratory and the film supplier alongside the
     * packer, and a pack whose maker is off-frame still names somebody. A miss
     * here sends the inspector to read the panel. A wrong name goes into the
     * record.
     */
    if (named && named.rank <= 1) {
      result.manufacturer = { value: named.name, box: named.box };
    }
  }

  return result;
}

module.exports = {
  extractDeclarations,
};
