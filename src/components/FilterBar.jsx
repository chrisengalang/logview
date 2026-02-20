import React from "react";

const LOG_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

export default function FilterBar({ filters, onChange }) {
  const handleSearchChange = (e) => {
    onChange({ ...filters, search: e.target.value });
  };

  const toggleLevel = (level) => {
    const current = filters.levels || [];
    const next = current.includes(level)
      ? current.filter((l) => l !== level)
      : [...current, level];
    onChange({ ...filters, levels: next });
  };

  const clearFilters = () => {
    onChange({ search: "", levels: [], dateFrom: "", dateTo: "" });
  };

  const hasActiveFilters =
    filters.search ||
    filters.levels.length > 0 ||
    filters.dateFrom ||
    filters.dateTo;

  return (
    <div className="filter-bar">
      {/* Search */}
      <div className="filter-group search-group">
        <span className="filter-icon">🔍</span>
        <input
          type="text"
          value={filters.search}
          onChange={handleSearchChange}
          placeholder="Search logs… (supports regex with /pattern/)"
          className="search-input"
        />
      </div>

      {/* Log Level Toggles */}
      <div className="filter-group level-group">
        <span className="filter-label">Level:</span>
        {LOG_LEVELS.map((level) => (
          <button
            key={level}
            className={`level-btn level-${level.toLowerCase()} ${
              filters.levels.includes(level) ? "active" : ""
            }`}
            onClick={() => toggleLevel(level)}
            title={`Toggle ${level} filter`}
          >
            {level}
          </button>
        ))}
      </div>

      {/* Date Range */}
      <div className="filter-group date-group">
        <span className="filter-label">From:</span>
        <input
          type="datetime-local"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          className="date-input"
        />
        <span className="filter-label">To:</span>
        <input
          type="datetime-local"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          className="date-input"
        />
      </div>

      {/* Clear */}
      {hasActiveFilters && (
        <button className="clear-filters-btn" onClick={clearFilters}>
          ✕ Clear
        </button>
      )}
    </div>
  );
}
