import { useAuth } from "@clerk/expo";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_AVATAR_EMOJI,
  normalizeAvatarEmoji,
  type AvatarEmoji,
} from "@/constants/avatarEmojis";

interface AppContextValue {
  userId: string;
  username: string;
  avatarEmoji: AvatarEmoji;
  isAdmin: boolean;
  /** Re-reads the signed-in account's moderator role from the server. */
  refreshAdminAccess: () => Promise<void>;
  /** Stores a moderator role the server pushed to this account. */
  applyAdminAccess: (isAdmin: boolean) => void;
  setUsername: (name: string) => Promise<void>;
  setAvatarEmoji: (emoji: AvatarEmoji) => Promise<void>;
  isReady: boolean;
  accessStatus: "loading" | "ready" | "banned" | "unverified";
  setAccessStatus: (
    status: "loading" | "ready" | "banned" | "unverified",
  ) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function apiBaseUrl(): string {
  const domain = process.env["EXPO_PUBLIC_DOMAIN"];
  return domain ? `https://${domain}` : "http://localhost:5000";
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId: clerkUserId } = useAuth();
  const getTokenRef = useRef(getToken);
  const [userId, setUserId] = useState("");
  const [username, setUsernameState] = useState("");
  const [avatarEmoji, setAvatarEmojiState] = useState<AvatarEmoji>(DEFAULT_AVATAR_EMOJI);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [accessStatus, setAccessStatus] = useState<
    "loading" | "ready" | "banned" | "unverified"
  >("loading");

  // Counts role checks so their answers can only be applied in the order the
  // checks were started. Overlapping checks are ordinary here: a periodic
  // re-check, a refused request and a sign-in can all be in flight at once,
  // and a slow earlier answer must not put back access that a later one
  // found removed -- nor may an answer about the account that just signed
  // out land on the account that just signed in.
  const roleCheckRef = useRef(0);

  /**
   * Opens a role check and returns the writer for its answer. The writer does
   * nothing once a later check has started.
   */
  const beginRoleCheck = useCallback(() => {
    const checkId = ++roleCheckRef.current;
    return (admin: boolean) => {
      if (checkId !== roleCheckRef.current) return;
      setIsAdmin(admin);
    };
  }, []);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isLoaded) {
        setIsReady(false);
        return;
      }
      const commitRole = beginRoleCheck();
      if (!isSignedIn || !clerkUserId) {
        if (!cancelled) {
          setUserId("");
          setUsernameState("");
          setAvatarEmojiState(DEFAULT_AVATAR_EMOJI);
          commitRole(false);
          setAccessStatus("ready");
          setIsReady(true);
        }
        return;
      }

      setIsReady(false);
      setUserId("");
      setUsernameState("");
      setAvatarEmojiState(DEFAULT_AVATAR_EMOJI);

      try {
        const token = await getTokenRef.current();
        const response = await fetch(`${apiBaseUrl()}/api/profile`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!response.ok) {
          const error = (await response.json().catch(() => null)) as {
            code?: string;
          } | null;
          if (!cancelled && error?.code === "BANNED") {
            setAccessStatus("banned");
            setUserId(clerkUserId);
            setUsernameState("");
            setAvatarEmojiState(DEFAULT_AVATAR_EMOJI);
            commitRole(false);
            setIsReady(true);
            return;
          }
          if (!cancelled && error?.code === "EMAIL_UNVERIFIED") {
            setAccessStatus("unverified");
            setUserId(clerkUserId);
            setUsernameState("");
            setAvatarEmojiState(DEFAULT_AVATAR_EMOJI);
            commitRole(false);
            setIsReady(true);
            return;
          }
          throw new Error("Unable to load your account profile.");
        }
        const data = (await response.json()) as {
          profile: { username: string; avatarEmoji: AvatarEmoji };
          isAdmin?: boolean;
        };
        const savedAvatarEmoji = normalizeAvatarEmoji(data.profile.avatarEmoji);
        if (!cancelled) {
          setUserId(clerkUserId);
          setUsernameState(data.profile.username);
          setAvatarEmojiState(savedAvatarEmoji);
          commitRole(data.isAdmin === true);
          setAccessStatus("ready");
          setIsReady(true);
        }
      } catch {
        if (!cancelled) {
          setUserId(clerkUserId);
          setUsernameState("");
          setAvatarEmojiState(DEFAULT_AVATAR_EMOJI);
          commitRole(false);
          setAccessStatus("ready");
          setIsReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [beginRoleCheck, clerkUserId, isLoaded, isSignedIn]);

  /**
   * Re-reads the moderator role the server derives for this account.
   *
   * The role is otherwise read once, when the app loads: an administrator who
   * grants or removes moderator access while someone has the app open would
   * not reach that person's copy until they reloaded. Screens that gate on the
   * role call this when they come back into view, and after the server refuses
   * a moderation request, so the change lands without a reload.
   *
   * Only a successful profile response moves the flag. A network failure or a
   * server error leaves the last known role in place rather than hiding
   * controls the account may still be entitled to.
   */
  const refreshAdminAccess = useCallback(async () => {
    if (!isSignedIn || !clerkUserId) return;
    const commitRole = beginRoleCheck();
    try {
      const token = await getTokenRef.current();
      const response = await fetch(`${apiBaseUrl()}/api/profile`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!response.ok) return;
      const data = (await response.json()) as { isAdmin?: boolean };
      commitRole(data.isAdmin === true);
    } catch {
      // Keep the role already on screen: a failed check is not a revocation.
    }
  }, [beginRoleCheck, clerkUserId, isSignedIn]);

  /**
   * Stores the role the server pushed after an administrator granted or
   * removed moderator access for this account.
   *
   * The server only sends this once the change is written, which makes it the
   * newest thing known about the role: it is recorded as a completed check so
   * that a re-read already in flight, started before the change, cannot
   * answer afterwards and put back what was just taken away.
   */
  const applyAdminAccess = useCallback(
    (admin: boolean) => {
      beginRoleCheck()(admin);
    },
    [beginRoleCheck],
  );

  const setUsername = useCallback(async (name: string) => {
    if (!clerkUserId) throw new Error("You must be signed in to update your profile.");
    const profile = await saveProfile({ username: name });
    setUsernameState(profile.username);
    setAvatarEmojiState(normalizeAvatarEmoji(profile.avatarEmoji));
  }, [clerkUserId, getToken]);

  const setAvatarEmoji = useCallback(async (emoji: AvatarEmoji) => {
    if (!clerkUserId) throw new Error("You must be signed in to update your profile.");
    const profile = await saveProfile({ avatarEmoji: emoji });
    setUsernameState(profile.username);
    setAvatarEmojiState(normalizeAvatarEmoji(profile.avatarEmoji));
  }, [clerkUserId, getToken]);

  async function saveProfile(update: Partial<{
    username: string;
    avatarEmoji: AvatarEmoji;
  }>) {
    const token = await getToken();
    const response = await fetch(
      `${apiBaseUrl()}/api/profile`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(update),
      },
    );
    if (!response.ok) throw new Error("Unable to save your profile.");
    const data = (await response.json()) as {
      profile: { username: string; avatarEmoji: AvatarEmoji };
    };
    return data.profile;
  }

  return (
    <AppContext.Provider
      value={{
        userId,
        username,
        avatarEmoji,
        isAdmin,
        refreshAdminAccess,
        applyAdminAccess,
        setUsername,
        setAvatarEmoji,
        isReady,
        accessStatus,
        setAccessStatus,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
