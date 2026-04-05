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
  const [sourcePriority, setSourcePriority] = useState("soulseek");
  const [localSources, setLocalSources] = useState<Array<{
    name: string; path: string; structure: string; formats: string; fileOp: string;
  }>>([]);

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
      if (config.sources) {
        setSourcePriority(config.sources.priority?.join(", ") ?? "soulseek");
        const local = config.sources.local ?? {};
        setLocalSources(Object.entries(local).map(([name, cfg]: [string, any]) => ({
          name,
          path: cfg.path ?? "",
          structure: cfg.structure ?? "artist-album",
          formats: (cfg.formats ?? ["flac", "mp3"]).join(", "),
          fileOp: cfg.fileOp ?? "copy",
        })));
      }
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
      sources: {
        priority: sourcePriority.split(",").map((s) => s.trim()).filter(Boolean),
        local: Object.fromEntries(localSources.map((s) => [s.name, {
          path: s.path,
          structure: s.structure,
          formats: s.formats.split(",").map((f) => f.trim()).filter(Boolean),
          fileOp: s.fileOp,
        }])),
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (isLoading) return <p className="text-muted">Loading settings...</p>;

  return (
    <>
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <div className="card">
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Matching Thresholds</h3>

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
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Download Settings</h3>

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
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Matching Weights — Lexicon</h3>
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
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Matching Weights — Soulseek</h3>
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
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Track Sources</h3>
        <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
          Priority order (comma-separated). Local sources checked first, Soulseek last.
        </p>
        <div style={{ marginBottom: "0.75rem" }}>
          <label className="text-muted text-sm">Priority</label>
          <input
            type="text"
            value={sourcePriority}
            onChange={(e) => setSourcePriority(e.target.value)}
            placeholder="local:lossless, local:swinsian, soulseek"
            style={{ display: "block", width: "100%", maxWidth: 500, marginTop: "0.25rem" }}
          />
          <span className="text-muted" style={{ fontSize: "0.7rem" }}>e.g. local:lossless, local:swinsian, soulseek</span>
        </div>

        <h4 style={{ marginBottom: "0.25rem", fontSize: "0.9rem" }}>Local Sources</h4>
        {localSources.map((src, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr auto", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "end" }}>
            <div>
              <label className="text-muted" style={{ fontSize: "0.7rem" }}>Name</label>
              <input type="text" value={src.name} onChange={(e) => {
                const next = [...localSources]; next[i] = { ...src, name: e.target.value }; setLocalSources(next);
              }} style={{ width: "100%" }} />
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: "0.7rem" }}>Path</label>
              <input type="text" value={src.path} onChange={(e) => {
                const next = [...localSources]; next[i] = { ...src, path: e.target.value }; setLocalSources(next);
              }} style={{ width: "100%" }} />
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: "0.7rem" }}>Structure</label>
              <select value={src.structure} onChange={(e) => {
                const next = [...localSources]; next[i] = { ...src, structure: e.target.value }; setLocalSources(next);
              }} style={{ width: "100%" }}>
                <option value="artist-album">Artist/Album</option>
                <option value="letter-artist-album">Letter/Artist/Album</option>
                <option value="flat">Flat</option>
                <option value="year-playlist">Year/Playlist</option>
              </select>
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: "0.7rem" }}>Formats</label>
              <input type="text" value={src.formats} onChange={(e) => {
                const next = [...localSources]; next[i] = { ...src, formats: e.target.value }; setLocalSources(next);
              }} style={{ width: "100%" }} placeholder="flac, mp3" />
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: "0.7rem" }}>File Op</label>
              <select value={src.fileOp} onChange={(e) => {
                const next = [...localSources]; next[i] = { ...src, fileOp: e.target.value }; setLocalSources(next);
              }} style={{ width: "100%" }}>
                <option value="copy">Copy</option>
                <option value="move">Move</option>
              </select>
            </div>
            <button className="danger" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }} onClick={() => {
              setLocalSources(localSources.filter((_, j) => j !== i));
            }}>×</button>
          </div>
        ))}
        <button onClick={() => setLocalSources([...localSources, { name: "", path: "", structure: "artist-album", formats: "flac, mp3", fileOp: "copy" }])} style={{ fontSize: "0.8rem" }}>
          + Add Local Source
        </button>
      </div>

      <div className="card">
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Logging</h3>
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
