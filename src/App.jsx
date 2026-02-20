import React, { useState, useCallback, useEffect, useRef } from "react";
import FolderSetup from "./components/FolderSetup";
import Sidebar from "./components/Sidebar";
import FilterBar from "./components/FilterBar";
import LogViewer from "./components/LogViewer";
import useLogData from "./hooks/useLogData";
import useTail from "./hooks/useTail";
import "./App.css";

const STORAGE_KEY = "logview-folders";

function loadSavedFolders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveFolders(folders) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
}

export default function App() {
  // ─── Folder setup state ─────────────────────────────────────────────────
  const [configuredFolders, setConfiguredFolders] = useState(loadSavedFolders);
  const [showSetup, setShowSetup] = useState(!configuredFolders || configuredFolders.length === 0);
  const [logGroups, setLogGroups] = useState([]);
  const [scanning, setScanning] = useState(false);

  // ─── File viewing state ─────────────────────────────────────────────────
  const [selectedFile, setSelectedFile] = useState(null);
  const [mergedFiles, setMergedFiles] = useState(null); // { paths: [], name: "" }
  const [selectedGroupName, setSelectedGroupName] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    levels: [],
    dateFrom: "",
    dateTo: "",
  });
  const [tailEnabled, setTailEnabled] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizing = useRef(false);

  // Sidebar drag-to-resize
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(200, Math.min(ev.clientX, 700));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Single-file loading
  const { lines, loading, error, fileName, reload } = useLogData(
    mergedFiles ? null : selectedFile
  );

  // Multi-file merged loading
  const [mergedLines, setMergedLines] = useState([]);
  const [mergedLoading, setMergedLoading] = useState(false);
  const [mergedError, setMergedError] = useState(null);
  const [mergedFileName, setMergedFileName] = useState(null);
  const [fileMarkers, setFileMarkers] = useState([]);

  const loadMerged = useCallback(async (paths, name) => {
    setMergedLoading(true);
    setMergedError(null);
    try {
      const res = await fetch("/api/read-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      const data = await res.json();
      if (data.error) {
        setMergedError(data.error);
        setMergedLines([]);
      } else {
        setMergedLines(data.lines || []);
        setMergedFileName(data.fileName || name);
        setFileMarkers(data.fileMarkers || []);
      }
    } catch (err) {
      setMergedError(err.message);
      setMergedLines([]);
    } finally {
      setMergedLoading(false);
    }
  }, []);

  // ─── Scan folders for log groups ──────────────────────────────────────
  const scanFolders = useCallback(async (folders) => {
    if (!folders || folders.length === 0) return;
    setScanning(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folders }),
      });
      const data = await res.json();
      if (data.error) {
        console.error("Scan error:", data.error);
        setLogGroups([]);
      } else {
        setLogGroups(data.groups || []);
      }
    } catch (err) {
      console.error("Scan error:", err);
      setLogGroups([]);
    } finally {
      setScanning(false);
    }
  }, []);

  // Auto-scan on startup when folders are configured
  useEffect(() => {
    if (configuredFolders && configuredFolders.length > 0 && !showSetup) {
      scanFolders(configuredFolders);
    }
  }, [configuredFolders, showSetup, scanFolders]);

  // ─── Setup handlers ──────────────────────────────────────────────────
  const handleSetupSave = useCallback(
    (folders) => {
      setConfiguredFolders(folders);
      saveFolders(folders);
      setShowSetup(false);
      scanFolders(folders);
    },
    [scanFolders]
  );

  const handleSetupCancel = useCallback(() => {
    if (configuredFolders && configuredFolders.length > 0) {
      setShowSetup(false);
    }
  }, [configuredFolders]);

  // ─── Tail ─────────────────────────────────────────────────────────────
  const { tailLines, connected } = useTail(
    tailEnabled ? selectedFile : null,
    () => {
      if (mergedFiles) {
        loadMerged(mergedFiles.paths, mergedFiles.name);
      } else {
        reload();
      }
    }
  );

  const activeLines = mergedFiles ? mergedLines : lines;
  const activeLoading = mergedFiles ? mergedLoading : loading;
  const activeError = mergedFiles ? mergedError : error;
  const activeFileName = mergedFiles ? mergedFileName : fileName;

  const allLines = React.useMemo(() => {
    return [...activeLines, ...tailLines];
  }, [activeLines, tailLines]);

  // ─── Selection handlers ───────────────────────────────────────────────
  const handleFileSelect = useCallback((filePath) => {
    setSelectedFile(filePath);
    setMergedFiles(null);
    setMergedLines([]);
    setFileMarkers([]);
    setTailEnabled(false);
    setSelectedGroupName(null);
  }, []);

  const handleGroupSelect = useCallback(
    (group) => {
      // Open all files in the group as a merged view
      const paths = group.files.map((f) => f.path);
      setMergedFiles({ paths, name: group.groupName });
      setSelectedFile(paths[paths.length - 1]); // tail the newest file
      setSelectedGroupName(group.groupName);
      setTailEnabled(false);
      loadMerged(paths, group.groupName);
    },
    [loadMerged]
  );

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
  }, []);

  const toggleTail = useCallback(() => {
    setTailEnabled((prev) => !prev);
  }, []);

  const handleReload = useCallback(() => {
    if (mergedFiles) {
      loadMerged(mergedFiles.paths, mergedFiles.name);
    } else {
      reload();
    }
  }, [mergedFiles, loadMerged, reload]);

  const handleRescan = useCallback(() => {
    if (configuredFolders && configuredFolders.length > 0) {
      scanFolders(configuredFolders);
    }
  }, [configuredFolders, scanFolders]);

  // ─── Render ───────────────────────────────────────────────────────────

  // Show setup overlay
  if (showSetup) {
    return (
      <FolderSetup
        folders={configuredFolders || []}
        onSave={handleSetupSave}
        onCancel={handleSetupCancel}
      />
    );
  }

  return (
    <div className="app">
      {/* Sidebar */}
      <aside
        className={`sidebar ${sidebarOpen ? "open" : "closed"}`}
        style={sidebarOpen ? { width: sidebarWidth, minWidth: sidebarWidth } : undefined}
      >
        <Sidebar
          logGroups={logGroups}
          scanning={scanning}
          onGroupSelect={handleGroupSelect}
          onFileSelect={handleFileSelect}
          onRescan={handleRescan}
          onSettings={() => setShowSetup(true)}
          selectedGroup={selectedGroupName}
          selectedFile={selectedFile}
        />
      </aside>
      {sidebarOpen && (
        <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />
      )}

      {/* Main Content */}
      <main className="main-content">
        {/* Top Bar */}
        <header className="top-bar">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            {sidebarOpen ? "◀" : "▶"}
          </button>

          <div className="file-info">
            {activeFileName ? (
              <>
                <span className="file-name">{activeFileName}</span>
                <span className="line-count">{allLines.length} lines</span>
                {mergedFiles && (
                  <span className="merged-badge" title={mergedFiles.paths.join('\n')}>
                    ⊞ {mergedFiles.paths.length} files
                  </span>
                )}
              </>
            ) : (
              <span className="no-file">Select a log group to view</span>
            )}
          </div>

          {selectedFile && (
            <div className="top-actions">
              <button
                className={`tail-btn ${tailEnabled ? "active" : ""}`}
                onClick={toggleTail}
                title="Toggle real-time tail"
              >
                {tailEnabled ? "⏹ Stop Tail" : "▶ Tail"}
              </button>
              {tailEnabled && (
                <span className={`ws-status ${connected ? "connected" : ""}`}>
                  {connected ? "● Live" : "○ Disconnected"}
                </span>
              )}
              <button className="reload-btn" onClick={handleReload} title="Reload file">
                ↻ Reload
              </button>
            </div>
          )}
        </header>

        {/* Filters */}
        <FilterBar filters={filters} onChange={handleFilterChange} />

        {/* Log Content */}
        <div className="log-area">
          {activeError && <div className="error-banner">{activeError}</div>}
          {activeLoading && <div className="loading-spinner">Loading…</div>}
          {!activeLoading && !selectedFile && !mergedFiles && (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <h2>Welcome to LogView</h2>
              <p>
                Select a log group from the sidebar to view all related log
                files merged together.
              </p>
              {logGroups.length > 0 && (
                <p className="empty-hint">
                  {logGroups.length} log group{logGroups.length !== 1 ? "s" : ""} found
                  across {configuredFolders.length} folder{configuredFolders.length !== 1 ? "s" : ""}.
                </p>
              )}
            </div>
          )}
          {!activeLoading && (selectedFile || mergedFiles) && (
            <LogViewer
              lines={allLines}
              filters={filters}
              tailEnabled={tailEnabled}
              fileMarkers={fileMarkers}
            />
          )}
        </div>
      </main>
    </div>
  );
}
