import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Hook for real-time tailing of a log file via WebSocket.
 * When `filePath` is non-null, connects and starts tailing.
 * Returns { tailLines, connected }
 */
export default function useTail(filePath, onTruncate) {
  const [tailLines, setTailLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const onTruncateRef = useRef(onTruncate);

  useEffect(() => {
    onTruncateRef.current = onTruncate;
  }, [onTruncate]);

  useEffect(() => {
    // Reset tail lines when file changes
    setTailLines([]);

    if (!filePath) {
      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      return;
    }

    // Determine WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Send tail command
      ws.send(JSON.stringify({ type: "tail", path: filePath }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "new-lines") {
          setTailLines((prev) => [...prev, ...msg.lines]);
        }

        if (msg.type === "truncated") {
          // File was truncated/rotated — trigger reload
          setTailLines([]);
          if (onTruncateRef.current) {
            onTruncateRef.current();
          }
        }

        if (msg.type === "error") {
          console.error("Tail error:", msg.message);
        }
      } catch (err) {
        console.error("WS message parse error:", err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [filePath]);

  return { tailLines, connected };
}
