import React, { useState, useEffect, useCallback } from "react";

export default function FolderSetup({ folders, onSave, onCancel }) {
  const [selectedFolders, setSelectedFolders] = useState(folders || []);
  const [browsePath, setBrowsePath] = useState("");
  const [browseEntries, setBrowseEntries] = useState([]);
  const [drives, setDrives] = useState([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [pathInput, setPathInput] = useState("");

  // Load drives on mount
  useEffect(() => {
    fetch("/api/drives", { method: "POST" })
      .then((r) => r.json())
      .then((data) => setDrives(data.drives || []))
      .catch(() => {});
  }, []);

  const browseTo = useCallback(async (dirPath) => {
    setBrowseLoading(true);
    try {
      const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();
      if (!data.error) {
        setBrowsePath(data.current);
        setPathInput(data.current);
        setBrowseEntries(data.folders || []);
      }
    } catch (err) {
      console.error("Browse error:", err);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const openBrowser = () => {
    setShowBrowser(true);
    if (drives.length > 0 && !browsePath) {
      browseTo(drives[0].path);
    }
  };

  const addCurrentFolder = () => {
    if (browsePath && !selectedFolders.includes(browsePath)) {
      setSelectedFolders((prev) => [...prev, browsePath]);
    }
  };

  const removeFolder = (folder) => {
    setSelectedFolders((prev) => prev.filter((f) => f !== folder));
  };

  const handlePathSubmit = (e) => {
    e.preventDefault();
    if (pathInput.trim()) {
      browseTo(pathInput.trim());
    }
  };

  const goUp = () => {
    const parent = browsePath.replace(/[\\/][^\\/]+$/, "") || browsePath;
    if (parent === browsePath || parent.length <= 3) {
      setBrowsePath("");
      setBrowseEntries([]);
      return;
    }
    browseTo(parent);
  };

  const handleSave = () => {
    onSave(selectedFolders);
  };

  const isAlreadyAdded = selectedFolders.includes(browsePath);

  return (
    <div className="setup-overlay">
      <div className="setup-dialog">
        <div className="setup-header">
          <h2>
            <span className="setup-icon">📋</span> LogView Setup
          </h2>
          <p className="setup-description">
            Configure which folders to scan for log files. All subfolders will
            be searched automatically.
          </p>
        </div>

        {/* Selected folders list */}
        <div className="setup-section">
          <h3 className="setup-section-title">
            Watched Folders ({selectedFolders.length})
          </h3>
          {selectedFolders.length === 0 ? (
            <div className="setup-empty">
              No folders added yet. Use the browser below to add folders.
            </div>
          ) : (
            <div className="setup-folder-list">
              {selectedFolders.map((folder) => (
                <div key={folder} className="setup-folder-item">
                  <span className="setup-folder-icon">📁</span>
                  <span className="setup-folder-path" title={folder}>
                    {folder}
                  </span>
                  <button
                    className="setup-remove-btn"
                    onClick={() => removeFolder(folder)}
                    title="Remove folder"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Folder browser */}
        <div className="setup-section">
          <div className="setup-browser-header">
            <h3 className="setup-section-title">Add Folder</h3>
            {!showBrowser && (
              <button className="setup-browse-btn" onClick={openBrowser}>
                📂 Browse...
              </button>
            )}
          </div>

          {showBrowser && (
            <div className="setup-browser">
              {/* Path input */}
              <form onSubmit={handlePathSubmit} className="setup-path-form">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="Enter directory path..."
                  className="setup-path-input"
                />
                <button type="submit" className="setup-path-go">
                  →
                </button>
              </form>

              {/* Navigation bar */}
              <div className="setup-nav">
                <button onClick={goUp} className="setup-nav-btn" disabled={!browsePath}>
                  ⬆ Up
                </button>
                {drives.map((drive) => (
                  <button
                    key={drive.path}
                    className="setup-nav-btn"
                    onClick={() => browseTo(drive.path)}
                  >
                    💾 {drive.name}
                  </button>
                ))}
              </div>

              {/* Current path + add button */}
              {browsePath && (
                <div className="setup-current-path">
                  <span className="setup-current-label" title={browsePath}>
                    {browsePath}
                  </span>
                  <button
                    className={`setup-add-btn ${isAlreadyAdded ? "disabled" : ""}`}
                    onClick={addCurrentFolder}
                    disabled={isAlreadyAdded}
                  >
                    {isAlreadyAdded ? "✓ Added" : "+ Add This Folder"}
                  </button>
                </div>
              )}

              {/* Directory listing */}
              <div className="setup-dir-list">
                {browseLoading && (
                  <div className="setup-dir-loading">Loading…</div>
                )}
                {!browseLoading && browseEntries.length === 0 && browsePath && (
                  <div className="setup-dir-empty">No subfolders found.</div>
                )}
                {!browseLoading &&
                  browseEntries.map((entry) => (
                    <button
                      key={entry.path}
                      className="setup-dir-item"
                      onClick={() => browseTo(entry.path)}
                      title={entry.path}
                    >
                      <span className="setup-dir-icon">📁</span>
                      <span className="setup-dir-name">{entry.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="setup-actions">
          {onCancel && (
            <button className="setup-cancel-btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            className="setup-save-btn"
            onClick={handleSave}
            disabled={selectedFolders.length === 0}
          >
            {selectedFolders.length === 0
              ? "Add at least one folder"
              : `Scan ${selectedFolders.length} folder${selectedFolders.length > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
