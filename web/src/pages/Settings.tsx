import { useState, useEffect } from "react";
import { useConfig, useUpdateConfig } from "../api/hooks.js";

export function Settings() {
  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  const [autoAccept, setAutoAccept] = useState(0.9);
  const [review, setReview] = useState(0.7);
  const [formats, setFormats] = useState("flac, mp3");
  const [minBitrate, setMinBitrate] = useState(320);
  const [concurrency, setConcurrency] = useState(3);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setAutoAccept(config.matching.autoAcceptThreshold);
      setReview(config.matching.reviewThreshold);
      setFormats(config.download.formats.join(", "));
      setMinBitrate(config.download.minBitrate);
      setConcurrency(config.download.concurrency);
    }
  }, [config]);

  const handleSave = async () => {
    await updateConfig.mutateAsync({
      matching: { autoAcceptThreshold: autoAccept, reviewThreshold: review },
      download: {
        formats: formats.split(",").map((f) => f.trim()).filter(Boolean),
        minBitrate,
        concurrency,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (isLoading) return <p className="text-muted">Loading settings...</p>;

  return (
    <>
      <h2>Settings</h2>

      <div className="card">
        <h3 style={{ marginBottom: "0.5rem" }}>Matching Thresholds</h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", maxWidth: 500 }}>
          <div>
            <label className="text-muted text-sm">Auto-Accept Threshold</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={autoAccept}
              onChange={(e) => setAutoAccept(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
          </div>
          <div>
            <label className="text-muted text-sm">Review Threshold</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={review}
              onChange={(e) => setReview(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.5rem" }}>Download Settings</h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", maxWidth: 700 }}>
          <div>
            <label className="text-muted text-sm">Formats</label>
            <input
              type="text"
              value={formats}
              onChange={(e) => setFormats(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
          </div>
          <div>
            <label className="text-muted text-sm">Min Bitrate (kbps)</label>
            <input
              type="number"
              min={0}
              value={minBitrate}
              onChange={(e) => setMinBitrate(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
          </div>
          <div>
            <label className="text-muted text-sm">Concurrency</label>
            <input
              type="number"
              min={1}
              max={10}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
          </div>
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <button className="primary" onClick={handleSave} disabled={updateConfig.isPending}>
          {updateConfig.isPending ? "Saving..." : "Save Settings"}
        </button>
        {saved && <span className="text-sm" style={{ marginLeft: "0.75rem", color: "var(--accent)" }}>Saved!</span>}
      </div>
    </>
  );
}
