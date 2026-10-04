import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAuth } from "@clerk/expo";
import { io, Socket } from "socket.io-client";
import { useApp } from "./AppContext";

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  connectionError: string | null;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  connectionError: null,
});

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, getToken } = useAuth();
  const {
    username,
    avatarEmoji,
    setAccessStatus,
    applyAdminAccess,
    refreshAdminAccess,
  } = useApp();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const getTokenRef = React.useRef(getToken);
  // Held in refs, like the token getter above, so that a change of role or a
  // re-read does not become a reason to tear the connection down and build a
  // new one: these are what the live connection reports to, not part of what
  // it is made of.
  const applyAdminAccessRef = React.useRef(applyAdminAccess);
  const refreshAdminAccessRef = React.useRef(refreshAdminAccess);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    applyAdminAccessRef.current = applyAdminAccess;
    refreshAdminAccessRef.current = refreshAdminAccess;
  }, [applyAdminAccess, refreshAdminAccess]);

  useEffect(() => {
    if (!isSignedIn || !username) {
      setSocket(null);
      setIsConnected(false);
      setConnectionError(null);
      return;
    }
    const domain = process.env["EXPO_PUBLIC_DOMAIN"];
    const url = domain ? `https://${domain}` : "http://localhost:5000";

    const s = io(url, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 15,
      reconnectionDelay: 1500,
      auth: async (callback) => {
        try {
          callback({ token: await getTokenRef.current() });
        } catch {
          callback({ token: null });
        }
      },
    });

    // A change to the moderator role is pushed down this connection. While
    // the connection was gone there was nowhere to push it to, so a restored
    // connection re-reads the role once rather than trusting what the app
    // still has on screen. The first connect is not one of those: the app
    // has just read the profile, role included.
    let connectedBefore = false;
    s.on("connect", () => {
      setIsConnected(true);
      setConnectionError(null);
      if (connectedBefore) void refreshAdminAccessRef.current();
      connectedBefore = true;
    });
    s.on("disconnect", () => setIsConnected(false));
    s.on("access-revoked", (payload: { reason?: string }) => {
      if (payload.reason === "banned") {
        setAccessStatus("banned");
      }
    });
    // An administrator granted or removed this account's moderator access.
    // Every screen reads the role from the app context, so applying it here
    // moves the controls wherever the member happens to be -- in a room, on
    // the profile screen -- without them asking for it.
    s.on("moderator-access-changed", (payload: { isAdmin?: boolean }) => {
      applyAdminAccessRef.current(payload?.isAdmin === true);
    });
    s.on("connect_error", (error) => {
      setIsConnected(false);
      setConnectionError(error.message || "Unable to connect to chat.");
    });
    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [avatarEmoji, isSignedIn, setAccessStatus, username]);

  return (
    <SocketContext.Provider value={{ socket, isConnected, connectionError }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
