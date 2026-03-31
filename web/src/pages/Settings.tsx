import { useState, useEffect } from "react";
import { useConfig, useUpdateConfig } from "../api/hooks.js";

export function Settings() {
  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  const [autoAccept, setAutoAccept] = useState(0.9);
  const [review, setReview] = useState(0.7);
  const [notFound, setNotFound] = useState(0.4);
  const [formats, setFormats] = useState("flac, mp3");
  const [minBitrate, setMinBitrate] = useState(320);
  const [concurrency, setConcurrency] = useState(3);
  const [jobConcurrency, setJobConcurrency] = useState(3);
  const [jobRetentionDays, setJobRetentionDays] = useState(7);
  const [validationStrictness, setValidationStrictness] = useState("moderate");
  const [downloadTimeoutMin, setDownloadTimeoutMin] = useState(30);
  const [logLevel, setLogLevel] = useState("info");
  const [logFile, setLogFile] = useState(true);
  const [lexW, setLexW] = useState({ title: 0.3, artist: 0.3, album: 0.15, duration: 0.25 });
  const [slskW, setSlskW] = useState({ title: 0.3, artist: 0.25, album: 0.1, duration: 0.35 });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setAutoAccept(config.matching.autoAcceptThreshold);
      setReview(config.matching.reviewThreshold);
      setNotFound(config.matching.notFoundThreshold ?? 0.4);
      setFormats(config.download.formats.join(", "));
      setMinBitrate(config.download.minBitrate);
      setConcurrency(config.download.concurrency);
      setValidationStrictness(config.download.validationStrictness);
      if (config.soulseek?.downloadTimeoutMs) {
        setDownloadTimeoutMin(Math.round(config.soulseek.downloadTimeoutMs / 60_000));
      }
      if (config.jobRunner) {
        setJobConcurrency(config.jobRunner.concurrency ?? 3);
        setJobRetentionDays(config.jobRunner.retentionDays ?? 7);
      }
      if (config.logging) {
        setLogLevel(config.logging.level);
        setLogFile(config.logging.file);
      }
      if (config.matching.lexiconWeights) setLexW(config.matching.lexiconWeights);
      if (config.matching.soulseekWeights) setSlskW(config.matching.soulseekWeights);
    }
  }, [config]);

  const handleSave = async () => {
    await updateConfig.mutateAsync({
      matching: {
        autoAcceptThreshold: autoAccept,
        reviewThreshold: review,
        notFoundThreshold: notFound,
        lexiconWeights: lexW,
        soulseekWeights: slskW,
      },
      download: {
        formats: formats.split(",").map((f) => f.trim()).filter(Boolean),
        minBitrate,
        concurrency,
        validationStrictness,
      },
      soulseek: {
        downloadTimeoutMs: downloadTimeoutMin * 60_000,
      },
      jobRunner: { concurrency: jobConcurrency, retentionDays: jobRetentionDays },
      logging: { level: logLevel, file: logFile },
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", maxWidth: 600 }}>
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
          <div>
            <label className="text-muted text-sm">Not-Found Threshold</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={notFound}
              onChange={(e) => setNotFound(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
            <span className="text-muted" style={{ fontSize: "0.7rem" }}>Below this → download. Above → review.</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.5rem" }}>Download Settings</h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr 1fr", gap: "1rem", maxWidth: 1200 }}>
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
            <label className="text-muted text-sm">Download Concurrency</label>
            <input
              type="number"
              min={1}
              max={10}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
          </div>
          <div>
            <label className="text-muted text-sm">Job Concurrency</label>
            <input
              type="number"
              min={1}
              max={20}
              value={jobConcurrency}
              onChange={(e) => setJobConcurrency(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
          </div>
          <div>
            <label className="text-muted text-sm">Job Retention (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={jobRetentionDays}
              onChange={(e) => setJobRetentionDays(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
            <span className="text-muted" style={{ fontSize: "0.7rem" }}>Auto-purge done/failed jobs.</span>
          </div>
          <div>
            <label className="text-muted text-sm">Validation Strictness</label>
            <select
              value={validationStrictness}
              onChange={(e) => setValidationStrictness(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            >
              <option value="strict">Strict</option>
              <option value="normal">Normal</option>
              <option value="relaxed">Relaxed</option>
            </select>
          </div>
          <div>
            <label className="text-muted text-sm">Download Timeout (min)</label>
            <input
              type="number"
              min={1}
              max={120}
              value={downloadTimeoutMin}
              onChange={(e) => setDownloadTimeoutMin(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
            <span className="text-muted" style={{ fontSize: "0.7rem" }}>Auto-retry after this.</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.5rem" }}>Matching Weights — Lexicon</h3>
        <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
          Weights for matching Spotify tracks against your Lexicon library. Must sum to 1.0.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem", maxWidth: 600 }}>
          {(["title", "artist", "album", "duration"] as const).map((field) => (
            <div key={field}>
              <label className="text-muted text-sm" style={{ textTransform: "capitalize" }}>{field}</label>
              <input
                type="number" min={0} max={1} step={0.05}
                value={lexW[field]}
                onChange={(e) => setLexW({ ...lexW, [field]: Number(e.target.value) })}
                style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.5rem" }}>Matching Weights — Soulseek</h3>
        <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
          Weights for ranking Soulseek search results. Must sum to 1.0.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem", maxWidth: 600 }}>
          {(["title", "artist", "album", "duration"] as const).map((field) => (
            <div key={field}>
              <label className="text-muted text-sm" style={{ textTransform: "capitalize" }}>{field}</label>
              <input
                type="number" min={0} max={1} step={0.05}
                value={slskW[field]}
                onChange={(e) => setSlskW({ ...slskW, [field]: Number(e.target.value) })}
                style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.5rem" }}>Logging</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", maxWidth: 400 }}>
          <div>
            <label className="text-muted text-sm">Log Level</label>
            <select
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div>
            <label className="text-muted text-sm">Log to File</label>
            <div style={{ marginTop: "0.5rem" }}>
              <label>
                <input
                  type="checkbox"
                  checked={logFile}
                  onChange={(e) => setLogFile(e.target.checked)}
                  style={{ marginRight: "0.5rem" }}
                />
                data/crate-sync.log
              </label>
            </div>
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
