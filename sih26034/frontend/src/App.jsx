import { useState } from "react";
import "./App.css";

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  return (
    <div className="app">
      <header className="navbar">
        <div className="brand">
          <div className="brand-icon">📦</div>

          <div>
            <h1>PackCheck</h1>
            <p>Packaged Commodity Inspector</p>
          </div>
        </div>

        <span className="badge">SIH 2026</span>
      </header>

      <main className="hero">
        <div className="hero-content">
          <div className="eyebrow">SMART PACKAGE INSPECTION</div>

          <h2>
            Check a package.
            <br />
            <span>In seconds.</span>
          </h2>

          <p className="description">
            Upload a package image and let PackCheck inspect its required
            declarations automatically.
          </p>

          <div className="upload-card">
            {selectedImage ? (
              <>
                <img
                  src={selectedImage}
                  alt="Selected package"
                  className="image-preview"
                />

                <p className="selected-name">Image selected ✓</p>

                <button
                  className="choose-button"
                  onClick={() => document.getElementById("image-input").click()}
                >
                  Choose Another
                </button>
              </>
            ) : (
              <>
                <div className="upload-icon">📸</div>

                <h3>Upload package image</h3>

                <p>Drop your image here or choose one from your computer.</p>

                <button
                  className="choose-button"
                  onClick={() => document.getElementById("image-input").click()}
                >
                  Choose Image
                </button>

                <small>JPG, PNG or WEBP · Max 10 MB</small>
              </>
            )}

            <input
              id="image-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files[0];

                if (file) {
                  setSelectedFile(file);
                  setSelectedImage(URL.createObjectURL(file));
                  setResult(null);
                }
              }}
            />
          </div>

          <button
            className="analyze-button"
            disabled={!selectedFile || loading}
            onClick={async () => {
              if (!selectedFile) return;

              setLoading(true);
              setResult(null);

              try {
                const response = await fetch("http://localhost:5000/analyze", {
                  method: "POST",
                  headers: {
                    "Content-Type": selectedFile.type,
                  },
                  body: selectedFile,
                });

                if (!response.ok) {
                  throw new Error("Analysis failed");
                }

                const data = await response.json();
                setResult(data);
              } catch (error) {
                console.error(error);
                alert("Could not analyze the image. Is the backend running?");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "🔍 Inspecting package..." : "✨ Analyze Package"}
          </button>
          {result && (
            <div className="result-card">
              <div className="result-header">
                <div>
                  <span className="result-label">INSPECTION RESULT</span>

                  <h2
                    className={
                      result.overall_status === "COMPLIANT"
                        ? "status-good"
                        : "status-bad"
                    }
                  >
                    {result.overall_status === "COMPLIANT"
                      ? "✓ Compliant"
                      : "✕ Non-Compliant"}
                  </h2>
                </div>

                <div
                  className={
                    result.overall_status === "COMPLIANT"
                      ? "status-circle good"
                      : "status-circle bad"
                  }
                >
                  {result.overall_status === "COMPLIANT" ? "✓" : "!"}
                </div>
              </div>

              <div className="fields-list">
                {Object.entries(result.fields).map(([field, data]) => (
                  <div className="field-row" key={field}>
                    <div>
                      <p className="field-name">{field.replace("_", " ")}</p>

                      <p className="field-value">
                        {data.value || "Not detected"}
                      </p>
                    </div>

                    <span
                      className={
                        data.status === "PASS"
                          ? "field-status pass"
                          : "field-status fail"
                      }
                    >
                      {data.status === "PASS" ? "✓ PASS" : "✕ FAIL"}
                    </span>
                  </div>
                ))}
              </div>

              {result.violations.length > 0 && (
                <div className="violations">
                  <h3>⚠ Issues found</h3>

                  {result.violations.map((violation, index) => (
                    <div className="violation" key={index}>
                      <strong>{violation.field.replace("_", " ")}</strong>
                      <span>{violation.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.violations.length === 0 && (
                <div className="all-good">
                  ✓ All required declarations were detected.
                </div>
              )}

              <button
                className="another-button"
                onClick={() => {
                  setResult(null);
                  setSelectedFile(null);
                  setSelectedImage(null);
                }}
              >
                ↻ Analyze Another Package
              </button>
            </div>
          )}
        </div>
      </main>

      <footer>
        <span>Inspection assistance system</span>
        <span>•</span>
        <span>For demonstration purposes</span>
      </footer>
    </div>
  );
}

export default App;
