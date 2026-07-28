import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import { useIsFocused } from "@react-navigation/native";

import { TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { useAuth } from "@/src/context/AuthContext";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

function wsUrl(token: string): string {
  // Convert the http(s) backend origin to a ws(s) WebSocket URL.
  const origin = BASE_URL.replace(/^http/i, "ws");
  return `${origin}/api/ws?token=${encodeURIComponent(token)}`;
}

type RealtimeContextValue = {
  /** Monotonic counter bumped on every server `invalidate` broadcast. */
  rev: number;
  connected: boolean;
};

const RealtimeContext = createContext<RealtimeContextValue>({ rev: 0, connected: false });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [rev, setRev] = useState(0);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);

  const clearReconnect = () => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  };

  const connect = useCallback(async () => {
    if (!user) return;
    // Avoid stacking sockets.
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    if (!token || typeof token !== "string") return;

    closedByUs.current = false;
    try {
      const ws = new WebSocket(wsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
      };
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse((evt as any).data);
          if (data && data.type === "invalidate") {
            setRev((r) => r + 1);
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!closedByUs.current && user) {
          scheduleReconnect();
        }
      };
      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    } catch {
      scheduleReconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const scheduleReconnect = useCallback(() => {
    clearReconnect();
    const attempt = retryRef.current + 1;
    retryRef.current = attempt;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)); // 2s..30s
    reconnectTimer.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  // Connect when authenticated; tear down on sign-out.
  useEffect(() => {
    if (user) {
      connect();
    } else {
      closedByUs.current = true;
      clearReconnect();
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
      setConnected(false);
    }
    return () => {
      clearReconnect();
    };
  }, [user, connect]);

  // Reconnect when the app returns to the foreground (mobile) and the socket died.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && user) {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          retryRef.current = 0;
          connect();
        }
      }
    });
    return () => sub.remove();
  }, [user, connect]);

  return (
    <RealtimeContext.Provider value={{ rev, connected }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/**
 * Re-run `callback` whenever the server broadcasts an `invalidate` event AND
 * this screen is currently focused. Pairs with the existing `useFocusEffect`
 * data loaders — screens live-update without manual pull-to-refresh.
 */
export function useRealtimeRefetch(callback: () => void) {
  const { rev } = useRealtime();
  const isFocused = useIsFocused();
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const lastHandled = useRef(rev);

  useEffect(() => {
    if (rev === lastHandled.current) return; // initial mount, no change
    lastHandled.current = rev;
    if (isFocused) {
      cbRef.current();
    }
    // When not focused, the screen's own useFocusEffect refetches on next focus.
  }, [rev, isFocused]);
}
