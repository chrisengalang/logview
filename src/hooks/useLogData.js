import { useState, useEffect, useCallback } from "react";

/**
 * Hook to load a log file from the backend.
 * Returns { lines, loading, error, fileName, reload }
 */
export default function useLogData(filePath) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);

  const load = useCallback(async () => {
    if (!filePath) {
      setLines([]);
      setFileName(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setLines([]);
      } else {
        setLines(data.lines || []);
        setFileName(data.fileName || filePath);
      }
    } catch (err) {
      setError(`Failed to load file: ${err.message}`);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    load();
  }, [load]);

  return { lines, loading, error, fileName, reload: load };
}
