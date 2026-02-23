import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import fs from "fs";
import path from "path";
import { glob } from "glob";
import chokidar from "chokidar";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(cors());
app.use(express.json());

// Serve static files in production
const distPath = path.resolve("dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ─── API Routes ──────────────────────────────────────────────────────────────

/**
 * POST /api/browse
 * Browse directories. Accepts { path: string }
 * Returns folders and log files in that directory.
 */
app.post("/api/browse", (req, res) => {
  const dirPath = req.body.path || process.cwd();

  try {
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: "Directory not found" });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Path is not a directory" });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });

    const folders = [];
    const files = [];

    // Match: .log, .txt, .log.1, .log.2, ..., .log.N, .pid, .owner, etc.
    const LOG_FILE_REGEX = /\.(log|txt|out|err)(\.[0-9]+)?$|\.log\.[a-z]+$/i;

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // skip hidden

      if (entry.isDirectory()) {
        folders.push({
          name: entry.name,
          path: path.join(resolved, entry.name),
          type: "folder",
        });
      } else if (LOG_FILE_REGEX.test(entry.name)) {
        const filePath = path.join(resolved, entry.name);
        const fileStat = fs.statSync(filePath);
        files.push({
          name: entry.name,
          path: filePath,
          type: "file",
          size: fileStat.size,
          modified: fileStat.mtime,
        });
      }
    }

    // Sort: folders first (alpha), then files (alpha)
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    // Group rolled log files: e.g. foo.log, foo.log.1, foo.log.2 → group under foo.log
    const groups = {};
    const standalone = [];

    for (const file of files) {
      // Check if this is a rolled file: name.log.N
      const rolledMatch = file.name.match(/^(.+\.log)\.([0-9]+)$/i);
      if (rolledMatch) {
        const baseName = rolledMatch[1];
        if (!groups[baseName]) {
          groups[baseName] = { base: null, rolled: [] };
        }
        groups[baseName].rolled.push({
          ...file,
          rollNumber: parseInt(rolledMatch[2], 10),
        });
      } else {
        // Check if this file has rolled siblings
        const hasRolled = files.some((f) =>
          new RegExp(`^${escapeRegex(file.name)}\\.[0-9]+$`, "i").test(f.name)
        );
        if (hasRolled) {
          if (!groups[file.name]) {
            groups[file.name] = { base: null, rolled: [] };
          }
          groups[file.name].base = file;
        } else {
          standalone.push(file);
        }
      }
    }

    // Build grouped result
    const fileGroups = [];
    for (const [baseName, group] of Object.entries(groups)) {
      // Sort rolled files by number (ascending: oldest first)
      group.rolled.sort((a, b) => a.rollNumber - b.rollNumber);
      const allFiles = [
        ...(group.rolled.map(f => ({...f}))).reverse(), // newest rolled first
        ...(group.base ? [group.base] : []),
      ];
      // For display purposes, the "current" log is the base (no number)
      // Rolled files go from highest number (oldest) to lowest, then base (newest)
      const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
      fileGroups.push({
        baseName,
        type: "group",
        files: allFiles,
        fileCount: allFiles.length,
        totalSize,
        // Use base file info if available, otherwise first rolled
        base: group.base || group.rolled[0],
      });
    }

    fileGroups.sort((a, b) => a.baseName.localeCompare(b.baseName));

    res.json({
      current: resolved,
      parent: path.dirname(resolved),
      folders,
      files: standalone,
      fileGroups,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/drives
 * List available drives on Windows, or root on Unix.
 */
app.post("/api/drives", (_req, res) => {
  if (process.platform === "win32") {
    // List common drive letters
    const drives = [];
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      const drivePath = `${letter}:\\`;
      if (fs.existsSync(drivePath)) {
        drives.push({ name: `${letter}:`, path: drivePath });
      }
    }
    res.json({ drives });
  } else {
    res.json({ drives: [{ name: "/", path: "/" }] });
  }
});

/**
 * POST /api/read
 * Read a log file. Accepts { path: string, offset?: number }
 * Returns lines from the file, optionally from a byte offset.
 */
app.post("/api/read", (req, res) => {
  const filePath = req.body.path;
  const offset = req.body.offset || 0;

  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: "Path is a directory" });
    }

    // Read from offset
    const fd = fs.openSync(filePath, "r");
    const bufferSize = stat.size - offset;

    if (bufferSize <= 0) {
      fs.closeSync(fd);
      return res.json({ lines: [], totalSize: stat.size, offset: stat.size });
    }

    // Cap at 10MB per read for safety
    const maxRead = Math.min(bufferSize, 10 * 1024 * 1024);
    const buffer = Buffer.alloc(maxRead);
    fs.readSync(fd, buffer, 0, maxRead, offset);
    fs.closeSync(fd);

    const content = buffer.toString("utf-8");
    const lines = content.split(/\r?\n/);

    // Remove last empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    res.json({
      lines,
      totalSize: stat.size,
      offset: offset + maxRead,
      fileName: path.basename(filePath),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/search-files
 * Recursively search for log files in a directory.
 * Accepts { path: string, pattern?: string }
 */
app.post("/api/search-files", async (req, res) => {
  const dirPath = req.body.path;
  const pattern = req.body.pattern || "**/*.{log,txt}";

  try {
    const resolved = path.resolve(dirPath);
    const files = await glob(pattern, {
      cwd: resolved,
      absolute: true,
      nodir: true,
    });

    const results = files.map((f) => {
      const stat = fs.statSync(f);
      return {
        name: path.basename(f),
        path: f,
        relativePath: path.relative(resolved, f),
        size: stat.size,
        modified: stat.mtime,
      };
    });

    results.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WebSocket for Real-time Tailing ─────────────────────────────────────────

const watchers = new Map();

wss.on("connection", (ws) => {
  let currentWatcher = null;
  let currentFile = null;
  let lastSize = 0;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "tail" && msg.path) {
        // Clean up previous watcher
        if (currentWatcher) {
          currentWatcher.close();
          currentWatcher = null;
        }

        currentFile = msg.path;

        if (!fs.existsSync(currentFile)) {
          ws.send(JSON.stringify({ type: "error", message: "File not found" }));
          return;
        }

        lastSize = fs.statSync(currentFile).size;

        ws.send(
          JSON.stringify({ type: "tail-started", path: currentFile })
        );

        currentWatcher = chokidar.watch(currentFile, {
          persistent: true,
          usePolling: true,
          interval: 1000,
          binaryInterval: 1000,
        });

        currentWatcher.on("change", () => {
          try {
            const stat = fs.statSync(currentFile);
            const newSize = stat.size;

            if (newSize > lastSize) {
              // Read only the new bytes
              const fd = fs.openSync(currentFile, "r");
              const bytesToRead = newSize - lastSize;
              const buffer = Buffer.alloc(bytesToRead);
              fs.readSync(fd, buffer, 0, bytesToRead, lastSize);
              fs.closeSync(fd);

              const content = buffer.toString("utf-8");
              const newLines = content.split(/\r?\n/).filter((l) => l !== "");

              if (newLines.length > 0) {
                ws.send(
                  JSON.stringify({
                    type: "new-lines",
                    lines: newLines,
                  })
                );
              }
            } else if (newSize < lastSize) {
              // File was truncated/rotated — signal to reload
              ws.send(JSON.stringify({ type: "truncated" }));
            }

            lastSize = newSize;
          } catch (err) {
            ws.send(
              JSON.stringify({ type: "error", message: err.message })
            );
          }
        });
      }

      if (msg.type === "stop-tail") {
        if (currentWatcher) {
          currentWatcher.close();
          currentWatcher = null;
          ws.send(JSON.stringify({ type: "tail-stopped" }));
        }
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
    }
  });

  ws.on("close", () => {
    if (currentWatcher) {
      currentWatcher.close();
      currentWatcher = null;
    }
  });
});

// ─── Fallback for SPA ────────────────────────────────────────────────────────

if (fs.existsSync(distPath)) {
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ─── Start Server ────────────────────────────────────────────────────────────

// Helper
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * POST /api/scan
 * Recursively scan one or more folders for all log files.
 * Accepts { folders: string[] }
 * Groups files by their common base filename (e.g. MBC_MortgageFunctionsEJBEAR)
 * across all subdirectories.
 */
app.post("/api/scan", async (req, res) => {
  const folders = req.body.folders;

  if (!folders || !Array.isArray(folders) || folders.length === 0) {
    return res.status(400).json({ error: "folders array is required" });
  }

  try {
    // Match .log, .log.1, .log.2, etc., .txt, .out, .err
    const LOG_FILE_REGEX = /\.(log|txt|out|err)(\.[0-9]+)?$/i;

    const allFiles = [];

    for (const folder of folders) {
      const resolved = path.resolve(folder);
      if (!fs.existsSync(resolved)) continue;

      // Recursively find all log files
      const pattern = "**/*";
      const found = await glob(pattern, {
        cwd: resolved,
        absolute: true,
        nodir: true,
        dot: false,
      });

      for (const filePath of found) {
        const basename = path.basename(filePath);
        if (!LOG_FILE_REGEX.test(basename)) continue;
        // Skip .log.owner files
        if (/\.log\.[a-z]+$/i.test(basename)) continue;

        try {
          const stat = fs.statSync(filePath);
          allFiles.push({
            name: basename,
            path: filePath,
            dir: path.dirname(filePath),
            relativePath: path.relative(resolved, filePath),
            sourceFolder: resolved,
            size: stat.size,
            modified: stat.mtime,
          });
        } catch {
          // skip inaccessible files
        }
      }
    }

    // Group by common base filename:
    // MBC_MortgageFunctionsEJBEAR.log, MBC_MortgageFunctionsEJBEAR.log.1, etc.
    // Strip the extension (.log, .log.1, .txt, etc.) to get the logical name
    const groups = {};

    for (const file of allFiles) {
      // Determine the base group name:
      // foo.log.3 → foo.log → group key "foo"
      // foo.log   → group key "foo"
      // foo.txt   → group key "foo"
      let groupKey;
      const rolledMatch = file.name.match(/^(.+)\.(log|txt|out|err)\.([0-9]+)$/i);
      const baseMatch = file.name.match(/^(.+)\.(log|txt|out|err)$/i);

      if (rolledMatch) {
        groupKey = rolledMatch[1]; // e.g., "MBC_MortgageFunctionsEJBEAR"
      } else if (baseMatch) {
        groupKey = baseMatch[1];
      } else {
        groupKey = file.name;
      }

      if (!groups[groupKey]) {
        groups[groupKey] = {
          groupName: groupKey,
          files: [],
        };
      }
      groups[groupKey].files.push(file);
    }

    // For each group, sort files: rolled files by number (highest/oldest first), then base
    const result = [];
    for (const [groupName, group] of Object.entries(groups)) {
      group.files.sort((a, b) => {
        const aRoll = a.name.match(/\.([0-9]+)$/);
        const bRoll = b.name.match(/\.([0-9]+)$/);
        const aNum = aRoll ? parseInt(aRoll[1], 10) : 0;
        const bNum = bRoll ? parseInt(bRoll[1], 10) : 0;
        // Highest number first (oldest), base file (0) last (newest)
        return bNum - aNum;
      });

      const totalSize = group.files.reduce((sum, f) => sum + f.size, 0);
      const newestMod = group.files.reduce((latest, f) => {
        const t = new Date(f.modified).getTime();
        return t > latest ? t : latest;
      }, 0);

      // Collect unique directories where this group's files live
      const directories = [...new Set(group.files.map(f => f.dir))];

      result.push({
        groupName,
        files: group.files,
        fileCount: group.files.length,
        totalSize,
        lastModified: new Date(newestMod),
        directories,
      });
    }

    // Sort groups alphabetically
    result.sort((a, b) => a.groupName.localeCompare(b.groupName, undefined, { sensitivity: "base" }));

    res.json({
      groups: result,
      totalFiles: allFiles.length,
      totalGroups: result.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/read-multi
 * Read and merge multiple log files (for rolled logs).
 * Accepts { paths: string[] }
 * Reads them in order (oldest rolled → newest/current) and concatenates.
 */
app.post("/api/read-multi", (req, res) => {
  const filePaths = req.body.paths;

  if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    return res.status(400).json({ error: "paths array is required" });
  }

  try {
    let allLines = [];
    let totalSize = 0;
    const fileMarkers = []; // track where each file's lines start

    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) continue;

      const stat = fs.statSync(fp);
      if (stat.isDirectory()) continue;

      const maxRead = Math.min(stat.size, 10 * 1024 * 1024);
      const fd = fs.openSync(fp, "r");
      const buffer = Buffer.alloc(maxRead);
      fs.readSync(fd, buffer, 0, maxRead, 0);
      fs.closeSync(fd);

      const content = buffer.toString("utf-8");
      const lines = content.split(/\r?\n/);
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }

      fileMarkers.push({
        fileName: path.basename(fp),
        path: fp,
        startLine: allLines.length,
        lineCount: lines.length,
      });

      allLines = allLines.concat(lines);
      totalSize += stat.size;
    }

    res.json({
      lines: allLines,
      totalSize,
      fileCount: fileMarkers.length,
      fileMarkers,
      fileName: fileMarkers.length > 0
        ? `${fileMarkers.length} files merged`
        : "(empty)",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 LogView server running at http://localhost:${PORT}`);
  console.log(`   WebSocket available at ws://localhost:${PORT}/ws`);
});
