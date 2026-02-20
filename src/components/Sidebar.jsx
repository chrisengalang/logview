import React, { useState, useMemo } from "react";

export default function Sidebar({
  logGroups,
  scanning,
  onGroupSelect,
  onFileSelect,
  onRescan,
  onSettings,
  selectedGroup,
  selectedFile,
}) {
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const toggleGroup = (groupName) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return logGroups;
    const q = searchQuery.toLowerCase();
    return logGroups.filter(
      (g) =>
        g.groupName.toLowerCase().includes(q) ||
        g.files.some((f) => f.relativePath.toLowerCase().includes(q))
    );
  }, [logGroups, searchQuery]);

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString();
  };

  return (
    <div className="sidebar-content">
      <div className="sidebar-header">
        <h1 className="app-logo">
          <span className="logo-icon">📋</span> LogView
        </h1>
        <div className="sidebar-header-actions">
          <button
            className="sidebar-action-btn"
            onClick={onRescan}
            title="Rescan folders"
            disabled={scanning}
          >
            {scanning ? "⏳" : "🔄"}
          </button>
          <button
            className="sidebar-action-btn"
            onClick={onSettings}
            title="Folder settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Search within groups */}
      <div className="sidebar-search">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter log groups..."
          className="sidebar-search-input"
        />
        {searchQuery && (
          <button
            className="sidebar-search-clear"
            onClick={() => setSearchQuery("")}
          >
            ✕
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="sidebar-summary">
        {scanning
          ? "Scanning folders..."
          : `${filteredGroups.length} log group${filteredGroups.length !== 1 ? "s" : ""}`}
        {searchQuery && !scanning && ` (filtered from ${logGroups.length})`}
      </div>

      {/* Log groups list */}
      <div className="file-list">
        {scanning && (
          <div className="sidebar-loading">
            <div className="scan-spinner">⏳</div>
            Scanning folders for log files...
          </div>
        )}

        {!scanning && filteredGroups.length === 0 && (
          <div className="empty-folder">
            {searchQuery
              ? "No log groups match your filter."
              : "No log files found. Check your folder settings."}
          </div>
        )}

        {!scanning &&
          filteredGroups.map((group) => {
            const isExpanded = expandedGroups.has(group.groupName);
            const isGroupSelected = selectedGroup === group.groupName;

            return (
              <div
                key={group.groupName}
                className={`log-group ${isGroupSelected ? "active-group" : ""}`}
              >
                <div className="log-group-header">
                  <button
                    className="log-group-expand"
                    onClick={() => toggleGroup(group.groupName)}
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? "▾" : "▸"}
                  </button>
                  <button
                    className={`log-group-name ${isGroupSelected ? "selected" : ""}`}
                    onClick={() => onGroupSelect(group)}
                    title={`${group.groupName}\n${group.fileCount} files • ${formatSize(group.totalSize)}\nDirectories: ${group.directories.join("\n")}`}
                  >
                    <div className="log-group-info">
                      <span className="log-group-label">{group.groupName}</span>
                      <span className="log-group-meta">
                        {group.fileCount} file{group.fileCount !== 1 ? "s" : ""} •{" "}
                        {formatSize(group.totalSize)}
                      </span>
                    </div>
                  </button>
                </div>

                {isExpanded && (
                  <div className="log-group-children">
                    {group.files.map((file) => (
                      <button
                        key={file.path}
                        className={`file-item log-item child-item ${
                          selectedFile === file.path ? "selected" : ""
                        }`}
                        onClick={() => onFileSelect(file.path)}
                        title={`${file.path}\n${formatSize(file.size)} • ${formatDate(file.modified)}`}
                      >
                        <span className="item-icon">📄</span>
                        <div className="item-details">
                          <span className="item-name">{file.name}</span>
                          <span className="item-meta">
                            {file.relativePath !== file.name && (
                              <span className="item-relpath">
                                {file.relativePath}
                              </span>
                            )}
                            {formatSize(file.size)} •{" "}
                            {formatDate(file.modified)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
