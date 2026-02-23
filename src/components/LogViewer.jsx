import React, { useMemo, useRef, useEffect, useCallback } from "react";
import { VariableSizeList } from "react-window";

// Approximate char width for monospace font at 12.5px
const CHAR_WIDTH = 7.7;
// Fixed space taken by line-number (50) + level badge (56) + padding (32)
const LINE_OVERHEAD = 138;
const MIN_ROW_HEIGHT = 24;
const LINE_HEIGHT = 20;

// Common log timestamp patterns
const TIMESTAMP_PATTERNS = [
  // WebSphere classic: [10/16/25 8:58:30:253 EDT] or [2/20/26 8:00:01:123 EST]
  /\[(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}:\d{2}:\d{2}:\d{3})\s+\w+\]/,
  // ISO 8601: 2024-01-15T10:30:00.000Z or "Timestamp":"2025-12-08T14:27:31Z"
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
  // Common: 2024-01-15 10:30:00
  /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/,
  // Brackets: [2024-01-15 10:30:00]
  /\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/,
  // US style: 01/15/2024 10:30:00
  /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/,
  // Mon DD HH:MM:SS (syslog)
  /[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/,
];

// JSON "SeverityText":"LEVEL" (for EAR application logs)
const JSON_SEVERITY_REGEX = /"SeverityText"\s*:\s*"(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE|CRITICAL)"/i;

// WebSphere classic single-char level codes: [timestamp] threadid ComponentName X   MSG
const WS_CLASSIC_LEVEL_REGEX = /\]\s+[0-9a-f]+\s+\S+\s+([AIWEDFC])\s/;

// Standard keyword levels
const LEVEL_REGEX =
  /\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE|CRITICAL|AUDIT)\b/i;

function detectLevel(line) {
  // 1. Try JSON SeverityText (most specific for EAR logs)
  const jsonMatch = line.match(JSON_SEVERITY_REGEX);
  if (jsonMatch) {
    const level = jsonMatch[1].toUpperCase();
    if (level === "WARNING") return "WARN";
    if (level === "SEVERE" || level === "CRITICAL") return "FATAL";
    return level;
  }

  // 2. Try WebSphere classic single-char level
  const wsMatch = line.match(WS_CLASSIC_LEVEL_REGEX);
  if (wsMatch) {
    const code = wsMatch[1].toUpperCase();
    switch (code) {
      case "I": return "INFO";
      case "A": return "INFO";     // Audit
      case "W": return "WARN";
      case "E": return "ERROR";
      case "D": return "DEBUG";
      case "F": return "FATAL";
      case "C": return "FATAL";
      default: return null;
    }
  }

  // 3. Fall back to standard keyword matching
  const match = line.match(LEVEL_REGEX);
  if (match) {
    const level = match[1].toUpperCase();
    if (level === "WARNING") return "WARN";
    if (level === "SEVERE" || level === "CRITICAL") return "FATAL";
    if (level === "AUDIT") return "INFO";
    return level;
  }

  return null;
}

function extractTimestamp(line) {
  // Try JSON "Timestamp":"2025-12-08T14:27:31Z"
  const jsonTsMatch = line.match(/"Timestamp"\s*:\s*"([^"]+)"/);
  if (jsonTsMatch) {
    const date = new Date(jsonTsMatch[1]);
    if (!isNaN(date.getTime())) return date;
  }

  // Try WebSphere classic format: [M/D/YY H:mm:ss:SSS TZ]
  const wsMatch = line.match(TIMESTAMP_PATTERNS[0]);
  if (wsMatch) {
    const month = parseInt(wsMatch[1], 10) - 1;
    const day = parseInt(wsMatch[2], 10);
    let year = parseInt(wsMatch[3], 10);
    if (year < 100) year += 2000;
    const timeParts = wsMatch[4].split(":");
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const seconds = parseInt(timeParts[2], 10);
    const ms = parseInt(timeParts[3], 10);
    const date = new Date(year, month, day, hours, minutes, seconds, ms);
    if (!isNaN(date.getTime())) return date;
  }

  // Try other patterns
  for (let i = 1; i < TIMESTAMP_PATTERNS.length; i++) {
    const match = line.match(TIMESTAMP_PATTERNS[i]);
    if (match) {
      let raw = match[1] || match[0];
      raw = raw.replace(/^\[/, "");
      const date = new Date(raw);
      if (!isNaN(date.getTime())) return date;
    }
  }
  return null;
}

function buildSearchRegex(search) {
  if (!search) return null;
  // Check if the user provided a regex pattern: /pattern/flags
  const regexMatch = search.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1], regexMatch[2] || "i");
    } catch {
      return null;
    }
  }
  // Plain text search (case insensitive)
  try {
    return new RegExp(escapeRegex(search), "i");
  } catch {
    return null;
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Highlights matching text in a line
function highlightMatches(text, regex) {
  if (!regex) return [text];
  const parts = [];
  let lastIndex = 0;
  // Reset regex state
  const globalRegex = new RegExp(regex.source, "gi");
  let match;
  while ((match = globalRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <mark key={match.index} className="search-highlight">
        {match[0]}
      </mark>
    );
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) break; // prevent infinite loop
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

export default function LogViewer({ lines, filters, tailEnabled, fileMarkers = [] }) {
  const listRef = useRef(null);
  const outerRef = useRef(null);
  const shouldAutoScroll = useRef(tailEnabled);
  const containerWidthRef = useRef(800);

  const searchRegex = useMemo(
    () => buildSearchRegex(filters.search),
    [filters.search]
  );

  // Build a set of line indices that are file boundaries (for merged view)
  const fileStartLines = useMemo(() => {
    const map = new Map();
    for (const marker of fileMarkers) {
      map.set(marker.startLine, marker.fileName);
    }
    return map;
  }, [fileMarkers]);

  // Parse and filter lines
  const processedLines = useMemo(() => {
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : null;
    const activeLevels =
      filters.levels && filters.levels.length > 0
        ? new Set(filters.levels)
        : null;

    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      const level = detectLevel(text);
      const timestamp = extractTimestamp(text);

      // Filter by level
      if (activeLevels && level && !activeLevels.has(level)) {
        continue;
      }

      // Filter by search
      if (searchRegex && !searchRegex.test(text)) {
        continue;
      }

      // Filter by date
      if (timestamp) {
        if (dateFrom && timestamp < dateFrom) continue;
        if (dateTo && timestamp > dateTo) continue;
      }

      result.push({
        index: i,
        text,
        level,
        timestamp,
      });
    }

    return result;
  }, [lines, filters, searchRegex]);

  // Auto-scroll to bottom when tailing
  useEffect(() => {
    shouldAutoScroll.current = tailEnabled;
  }, [tailEnabled]);

  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current && processedLines.length > 0) {
      listRef.current.scrollToItem(processedLines.length - 1, "end");
    }
  }, [processedLines.length]);

  // Reset VariableSizeList cache when data changes
  useEffect(() => {
    if (listRef.current && listRef.current.resetAfterIndex) {
      listRef.current.resetAfterIndex(0, true);
    }
  }, [processedLines]);

  // Estimate row height for wrap mode based on text length and container width
  const getItemSize = useCallback(
    (index) => {
      const line = processedLines[index];
      if (!line) return MIN_ROW_HEIGHT;
      const availableWidth = containerWidthRef.current - LINE_OVERHEAD;
      if (availableWidth <= 0) return MIN_ROW_HEIGHT;
      const charsPerRow = Math.floor(availableWidth / CHAR_WIDTH);
      if (charsPerRow <= 0) return MIN_ROW_HEIGHT;
      const numWrappedLines = Math.ceil(line.text.length / charsPerRow) || 1;
      const fileLabel = fileStartLines.get(line.index);
      const markerExtra = fileLabel ? MIN_ROW_HEIGHT : 0;
      return Math.max(MIN_ROW_HEIGHT, numWrappedLines * LINE_HEIGHT + 4 + markerExtra);
    },
    [processedLines, fileStartLines]
  );

  // Row renderer (wrap mode)
  const WrapRow = useCallback(
    ({ index, style }) => {
      const line = processedLines[index];
      if (!line) return null;

      const levelClass = line.level ? `log-level-${line.level.toLowerCase()}` : "";
      const parts = highlightMatches(line.text, searchRegex);
      const fileLabel = fileStartLines.get(line.index);

      return (
        <div style={style}>
          <div className={`log-line log-line-wrap ${levelClass}`}>
            {fileLabel && (
              <div className="file-marker-wrap" title={fileLabel}>
                ▸ {fileLabel}
              </div>
            )}
            <span className="line-number">{line.index + 1}</span>
            {line.level && (
              <span className={`level-badge ${levelClass}`}>{line.level}</span>
            )}
            <span className="line-text">{parts}</span>
          </div>
        </div>
      );
    },
    [processedLines, searchRegex, fileStartLines]
  );

  if (processedLines.length === 0 && lines.length > 0) {
    return (
      <div className="no-results">
        <div className="no-results-icon">🔍</div>
        <p>No lines match the current filters.</p>
        <p className="no-results-hint">
          {lines.length} total lines in file — try adjusting your filters.
        </p>
      </div>
    );
  }

  return (
    <div className="log-viewer wrap-mode">
      <div className="log-viewer-info">
        <span>
          Showing {processedLines.length} of {lines.length} lines
          {tailEnabled && <span className="tail-indicator"> — ● Tailing</span>}
        </span>
      </div>
      <div className="log-viewer-container">
        <AutoSizedList
          listRef={listRef}
          outerRef={outerRef}
          itemCount={processedLines.length}
          itemSize={getItemSize}
          Row={WrapRow}
          onWidthChange={(w) => { containerWidthRef.current = w; }}
        />
      </div>
    </div>
  );
}

/**
 * Uses a ResizeObserver to automatically size the virtual list
 * to fill its container.
 */
function AutoSizedList({ listRef, outerRef, itemCount, itemSize, Row, onWidthChange }) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = React.useState({ width: 800, height: 400 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        setDimensions({ width: w, height: h });
        if (onWidthChange) onWidthChange(w);
        // Reset variable list cache when width changes
        if (listRef.current && listRef.current.resetAfterIndex) {
          listRef.current.resetAfterIndex(0, true);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [listRef, onWidthChange]);

  return (
    <div ref={containerRef} className="auto-sized-list">
      <VariableSizeList
        ref={listRef}
        outerRef={outerRef}
        height={dimensions.height}
        width={dimensions.width}
        itemCount={itemCount}
        itemSize={itemSize}
        overscanCount={20}
      >
        {Row}
      </VariableSizeList>
    </div>
  );
}
