import { REGIONS, DEMO_IMAGE } from "../demo.js";

/*
 * The demo evidence frame, drawn rather than photographed.
 *
 * A committed JPEG would have been easier, but drawing it buys two things the
 * demo actually needs. First, the printed declarations sit at known coordinates,
 * so the overlay boxes provably land on the right text instead of being
 * eyeballed. Second, the pack is shot square-on with even lighting — which is
 * exactly the advice the system gives an inspector when a frame reads badly, so
 * the example should not contradict it.
 *
 * The packing date is deliberately unreadable: a smudged ink-jet seal is the
 * commonest real cause of a missing date declaration, and it is what makes the
 * demo show a genuine finding rather than a clean pass.
 */

const label = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 21,
  letterSpacing: 1.6,
  fill: "#6b625a",
};

const value = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 38,
  fontWeight: 700,
  fill: "#2a2320",
};

export default function DemoPack() {
  return (
    <svg
      className="stage-media"
      viewBox={`0 0 ${DEMO_IMAGE.width} ${DEMO_IMAGE.height}`}
      role="img"
      aria-label="Demonstration photograph of a snack pack with five printed declarations. The packing date on the seal is smudged and unreadable."
    >
      <defs>
        <linearGradient id="pack-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8853c" />
          <stop offset="52%" stopColor="#d9662a" />
          <stop offset="100%" stopColor="#bf5020" />
        </linearGradient>

        <linearGradient id="pack-sheen" x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.24" />
          <stop offset="38%" stopColor="#fff" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.14" />
        </linearGradient>

        <pattern id="bench" width="46" height="46" patternUnits="userSpaceOnUse">
          <path d="M0 46 46 0" stroke="#22302c" strokeWidth="1.4" />
        </pattern>

        <filter id="smudge" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="4.6" />
        </filter>
      </defs>

      {/* Bench surface */}
      <rect width="100%" height="100%" fill="#16211e" />
      <rect width="100%" height="100%" fill="url(#bench)" opacity="0.5" />

      {/* Pouch body, with crimped top and bottom seals */}
      <g>
        <rect x="130" y="196" width="740" height="52" rx="8" fill="#a8431a" />
        <rect x="130" y="1084" width="740" height="52" rx="8" fill="#a8431a" />
        {Array.from({ length: 24 }, (_, i) => (
          <g key={i} stroke="#8f3813" strokeWidth="3" opacity="0.7">
            <path d={`M${146 + i * 30} 200v44`} />
            <path d={`M${146 + i * 30} 1088v44`} />
          </g>
        ))}

        <rect x="130" y="240" width="740" height="850" fill="url(#pack-face)" />
        <rect x="130" y="240" width="740" height="850" fill="url(#pack-sheen)" />
      </g>

      {/* Brand block */}
      <text
        x="168"
        y="330"
        fontFamily="'Instrument Serif', Georgia, serif"
        fontSize="76"
        fill="#fffaf2"
      >
        grain theory
      </text>
      <text
        x="170"
        y="382"
        fontFamily="'JetBrains Mono', monospace"
        fontSize="25"
        letterSpacing="5"
        fill="#ffe6cd"
      >
        spiced lentil crisps
      </text>

      {/* Declaration panel: a white printed area, as on a real rear panel */}
      <rect x="150" y="430" width="700" height="540" rx="6" fill="#faf6ee" opacity="0.96" />

      {/* Net quantity */}
      <text {...label} x={REGIONS.net_quantity[0]} y={REGIONS.net_quantity[1] + 24}>
        NET QTY
      </text>
      <text {...value} x={REGIONS.net_quantity[0]} y={REGIONS.net_quantity[1] + 68}>
        72 g
      </text>

      {/* MRP: the currency mark is clipped by the panel edge, which is what the
          screening flags for review rather than passing or failing. */}
      <text {...label} x={REGIONS.mrp[0]} y={REGIONS.mrp[1] + 24}>
        M.R.P (INCL. TAXES)
      </text>
      <g>
        <text {...value} x={REGIONS.mrp[0]} y={REGIONS.mrp[1] + 68}>
          ₹ 85.00
        </text>
        <rect
          x={REGIONS.mrp[0] - 4}
          y={REGIONS.mrp[1] + 36}
          width="26"
          height="40"
          fill="#faf6ee"
          opacity="0.82"
        />
      </g>

      {/* Manufacturer */}
      <text {...label} x={REGIONS.manufacturer[0]} y={REGIONS.manufacturer[1] + 22}>
        PACKED BY
      </text>
      <text
        {...value}
        fontSize="30"
        x={REGIONS.manufacturer[0]}
        y={REGIONS.manufacturer[1] + 62}
      >
        Kettle &amp; Grain Foods
      </text>
      <text
        fontFamily="'JetBrains Mono', monospace"
        fontSize="21"
        fill="#5c544d"
        x={REGIONS.manufacturer[0]}
        y={REGIONS.manufacturer[1] + 100}
      >
        Plot 14, Sector 8, Noida 201301
      </text>

      {/* Packing date: printed, but smudged past legibility */}
      <text {...label} x={REGIONS.packing_date[0]} y={REGIONS.packing_date[1] + 22}>
        MFD / PKD
      </text>
      <g filter="url(#smudge)" opacity="0.62">
        <rect
          x={REGIONS.packing_date[0]}
          y={REGIONS.packing_date[1] + 36}
          width="150"
          height="26"
          fill="#3a332e"
        />
        <rect
          x={REGIONS.packing_date[0] + 24}
          y={REGIONS.packing_date[1] + 30}
          width="86"
          height="36"
          fill="#2f2924"
        />
      </g>

      {/* Consumer care */}
      <text {...label} x={REGIONS.consumer_care[0]} y={REGIONS.consumer_care[1] + 22}>
        CONSUMER CARE
      </text>
      <text
        {...value}
        fontSize="32"
        x={REGIONS.consumer_care[0]}
        y={REGIONS.consumer_care[1] + 66}
      >
        1800 22 0417 · care@kgfoods.test
      </text>

      {/* Barcode, bottom right of the pouch */}
      <g transform="translate(636 990)">
        {Array.from({ length: 34 }, (_, i) => (
          <rect
            key={i}
            x={i * 5.6}
            y="0"
            width={i % 4 === 0 ? 3.4 : 1.7}
            height="58"
            fill="#241c18"
            opacity="0.9"
          />
        ))}
      </g>
    </svg>
  );
}
