/*
 * Backend client.
 *
 * The one thing this file exists for is turning failures into sentences an
 * inspector can act on. The API already returns typed error codes, so a failed
 * upload should say "crop to the label panel and try again", not "500".
 *
 * The base URL is configurable because the backend also serves the built UI. In
 * development that means two origins; in the packaged demo it means one, and
 * the empty default makes relative requests do the right thing.
 */

const BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:5000").replace(/\/$/, "");

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Messages for codes worth rewording for the person holding the package. */
const MESSAGES = {
  NO_IMAGE: "No image reached the recogniser. Choose a photograph and try again.",
  IMAGE_TOO_LARGE: "That photograph is over 12 MB. Reduce the resolution and try again.",
  UNREADABLE_FILE: "That file could not be opened as an image. Use a JPEG, PNG or WebP photograph.",
  OCR_TIMEOUT: "Reading this image took too long. Crop to the label panel and try again.",
  OCR_LANGDATA_MISSING:
    "The recogniser has no language data installed. Place eng.traineddata in ocr/tessdata/ and restart the backend.",
  ANALYSIS_FAILED: "The inspection could not be completed. The backend logged the reason.",
};

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

async function readError(response) {
  let code = `HTTP_${response.status}`;
  let message = null;

  try {
    const body = await response.json();
    if (body && body.error) {
      code = body.error.code || code;
      message = body.error.message || null;
    }
  } catch (_) {
    /* a non-JSON error body is not worth reporting to the inspector */
  }

  return new ApiError(code, MESSAGES[code] || message || "The backend rejected that request.");
}

function offlineError() {
  return new ApiError(
    "BACKEND_UNREACHABLE",
    `No response from the backend at ${BASE || "this origin"}. Start it with \`npm start\` in backend/.`,
  );
}

/**
 * Validate before uploading. Catching an oversized or wrong-typed file here
 * saves the inspector a round trip over what may be a poor mobile connection.
 */
export function validateFile(file) {
  if (!file) return "Choose a photograph of the package label.";
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "Use a JPEG, PNG or WebP photograph.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "That photograph is over 12 MB. Reduce the resolution and try again.";
  }
  return null;
}

export async function analyze(file, { product } = {}) {
  const params = new URLSearchParams();
  if (file.name) params.set("name", file.name);
  if (product) params.set("product", product);

  let response;
  try {
    response = await fetch(`${BASE}/api/analyze?${params}`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
  } catch (_) {
    throw offlineError();
  }

  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function fetchCatalog() {
  let response;
  try {
    response = await fetch(`${BASE}/api/catalog`);
  } catch (_) {
    throw offlineError();
  }

  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function fetchHealth() {
  try {
    const response = await fetch(`${BASE}/api/health`);
    if (!response.ok) return null;
    return response.json();
  } catch (_) {
    return null;
  }
}

/**
 * Ask the backend for a report and hand it to the browser as a download.
 *
 * The response may be a PDF or, if pdfkit is not installed, printable HTML. The
 * Content-Type decides which, so the caller does not have to care.
 */
export async function downloadReport(screening, context, format = "pdf") {
  let response;
  try {
    response = await fetch(`${BASE}/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screening, context, format }),
    });
  } catch (_) {
    throw offlineError();
  }

  if (!response.ok) throw await readError(response);

  const blob = await response.blob();
  const isPdf = blob.type.includes("pdf");
  const url = URL.createObjectURL(blob);
  const id = String(context?.inspectionId || "report").replace(/[^\w-]+/g, "-");

  if (isPdf) {
    const link = document.createElement("a");
    link.href = url;
    link.download = `packcheck-${id}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } else {
    // HTML reports open in a tab so the inspector can print to PDF themselves.
    window.open(url, "_blank", "noopener");
  }

  // Give the browser a moment to start the download before the blob is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return isPdf ? "pdf" : "html";
}

export const apiBase = BASE;
