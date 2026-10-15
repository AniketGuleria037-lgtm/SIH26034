import { useCallback, useEffect, useRef, useState } from "react";
import DemoPack from "./DemoPack.jsx";
import { MinusIcon, PlusIcon, ResetIcon } from "./Icons.jsx";

/*
 * The evidence frame.
 *
 * The overlay is the whole point of this screen: it is what connects a value in
 * the table to the pixels it was read from. Getting it right has one subtlety
 * that is easy to miss.
 *
 * OCR reports boxes in the ORIGINAL image's pixel space. The stage has a fixed
 * 4:5 aspect and the media inside it is `object-fit: contain`, so for any image
 * that is not 4:5 the rendered picture is letterboxed — smaller than the stage,
 * and offset within it. Positioning a box as a percentage of the STAGE would
 * therefore drift, badly, on any portrait or landscape photograph. So the
 * letterboxed rectangle is computed explicitly and boxes are placed inside that.
 *
 * Zoom and pan are applied to a wrapper around both the media and the overlay,
 * which keeps them locked together for free.
 */

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
/*
 * The stage takes the shape of the PHOTOGRAPH, within limits.
 *
 * A fixed stage shape letterboxes every frame that does not share it, and the
 * evidence — the one thing on this screen worth looking at — ends up as a
 * postage stamp in a field of dark grey. Phone photographs arrive at 3:4 or
 * 4:3 depending on how the inspector held the handset, so no single shape
 * serves them.
 *
 * The clamp stops a panorama or a thin crop from making the stage unusably
 * wide or tall. Whatever shape results is handed to the overlay too, so boxes
 * stay on the text they point at — the two used to be declared separately and
 * drifted apart, which silently slid every box sideways.
 */
const MIN_STAGE_ASPECT = 0.62;
const MAX_STAGE_ASPECT = 1.9;
const FALLBACK_ASPECT = 5 / 4;

function stageAspect(imageWidth, imageHeight) {
  if (!imageWidth || !imageHeight) return FALLBACK_ASPECT;
  return clamp(imageWidth / imageHeight, MIN_STAGE_ASPECT, MAX_STAGE_ASPECT);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where the letterboxed image actually sits inside the stage, as fractions of
 * the stage. Mirrors what `object-fit: contain` does.
 */
function contentRect(imageWidth, imageHeight, aspect) {
  if (!imageWidth || !imageHeight) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }

  const imageAspect = imageWidth / imageHeight;

  if (imageAspect > aspect) {
    // Wider than the stage: full width, bars top and bottom.
    const height = aspect / imageAspect;
    return { left: 0, top: (1 - height) / 2, width: 1, height };
  }

  const width = imageAspect / aspect;
  return { left: (1 - width) / 2, top: 0, width, height: 1 };
}

export default function EvidenceFrame({
  inspection,
  declarations,
  selectedField,
  onSelectField,
  isDemo,
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const dragStart = useRef(null);

  const image = inspection?.image || {};
  const located = declarations.filter((d) => Array.isArray(d.box));
  const aspect = stageAspect(image.width, image.height);
  const content = contentRect(image.width, image.height, aspect);

  // A new inspection is a new photograph; carrying the old zoom over would
  // leave the inspector looking at an arbitrary corner of it.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [inspection?.id]);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const adjustZoom = useCallback((delta) => {
    setZoom((current) => {
      const next = clamp(Math.round((current + delta) * 100) / 100, MIN_ZOOM, MAX_ZOOM);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  function onPointerDown(event) {
    // Panning an un-zoomed image does nothing useful and only makes the cursor
    // lie about what dragging will do.
    if (zoom === 1 || event.button !== 0) return;
    dragStart.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!panning || !dragStart.current) return;
    setOffset({
      x: event.clientX - dragStart.current.x,
      y: event.clientY - dragStart.current.y,
    });
  }

  function endPan() {
    dragStart.current = null;
    setPanning(false);
  }

  /** Box coordinates -> CSS percentages within the letterboxed content. */
  function boxStyle(box) {
    const width = image.width || 1;
    const height = image.height || 1;
    const [x1, y1, x2, y2] = box;

    const left = content.left + (x1 / width) * content.width;
    const top = content.top + (y1 / height) * content.height;
    const boxWidth = ((x2 - x1) / width) * content.width;
    const boxHeight = ((y2 - y1) / height) * content.height;

    return {
      left: `${left * 100}%`,
      top: `${top * 100}%`,
      width: `${boxWidth * 100}%`,
      height: `${boxHeight * 100}%`,
    };
  }

  const sizeLabel =
    typeof image.bytes === "number" ? `${(image.bytes / (1024 * 1024)).toFixed(1)} MB` : null;

  return (
    <section className="panel" aria-label="Evidence frame">
      <header className="panel-head">
        <div className="panel-head-text">
          <p className="tag">Evidence frame</p>
          <h3>{inspection?.product || image.name || "Unidentified package"}</h3>
        </div>

        <div className="evidence-controls">
          <button
            type="button"
            className="icon-button"
            onClick={() => adjustZoom(-0.25)}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <MinusIcon />
          </button>
          <span className="zoom-level" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => adjustZoom(0.25)}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={resetView}
            disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
            aria-label="Reset the view"
          >
            <ResetIcon />
          </button>
        </div>
      </header>

      <div
        className="stage"
        style={{ aspectRatio: String(aspect) }}
        data-panning={panning}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className="stage-inner"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        >
          {isDemo ? (
            <DemoPack />
          ) : (
            <img className="stage-media" src={image.url} alt={`Evidence for ${inspection?.product || "this package"}`} draggable="false" />
          )}

          <div className="overlay">
            {located.map((declaration) => {
              const selected = declaration.field === selectedField;
              return (
                <button
                  type="button"
                  key={declaration.id}
                  className="overlay-box"
                  style={boxStyle(declaration.box)}
                  data-outcome={declaration.status}
                  data-selected={selected}
                  onClick={() => onSelectField(declaration.field)}
                  aria-pressed={selected}
                  title={`${declaration.label}: ${declaration.value ?? "not read"}`}
                >
                  <span className="box-label">{declaration.short_label}</span>
                  <span className="visually-hidden">
                    {declaration.label}, read as {declaration.value ?? "nothing"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <span className="bracket" data-corner="tl" />
        <span className="bracket" data-corner="tr" />
        <span className="bracket" data-corner="bl" />
        <span className="bracket" data-corner="br" />

        <p className="tag stage-caption">
          {isDemo ? "Demo frame" : `Cam 01 · ${image.width || "?"}×${image.height || "?"}`}
        </p>
      </div>

      <footer className="panel-foot">
        <span className="located">
          <span className="dot" />
          {located.length} of {declarations.length} declarations located
        </span>
        <span className="mono">
          {[image.name, sizeLabel].filter(Boolean).join(" · ") || "no file metadata"}
        </span>
      </footer>
    </section>
  );
}
