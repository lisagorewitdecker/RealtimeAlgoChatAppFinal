import { Feather } from "@expo/vector-icons";
import { useAuth, useClerk } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TouchableOpacityProps,
  type ViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AVATAR_EMOJIS, type AvatarEmoji } from "@/constants/avatarEmojis";
import { PRODUCT_NAME } from "@/constants/branding";
import { useApp } from "@/contexts/AppContext";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSocket } from "@/contexts/SocketContext";
import { useColors } from "@/hooks/useColors";
import { useModeratorRoleRecheck } from "@/hooks/useModeratorRoleRecheck";
import { useTabBarClearance } from "@/hooks/useTabBarClearance";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Gap between the last control and the tab bar. */
const CONTENT_TRAILING_SPACING = 24;

type ModerationFeedback = {
  kind: "success" | "error";
  message: string;
};

type AccountSearchResult = {
  userId: string;
  username: string;
  avatarEmoji: string;
  email: string | null;
  banned: boolean;
};

type ModerationAction =
  "ban" | "restore" | "grant-moderator" | "revoke-moderator";

type Moderator = {
  userId: string;
  username: string | null;
  email: string | null;
  /** "configured" access comes from ADMIN_USER_IDS and cannot be revoked here. */
  source: "configured" | "granted";
  grantedBy: string | null;
  grantedAt: string | null;
};

type ModerationHistoryEntry = {
  id: number;
  action: ModerationAction;
  actorUserId: string;
  actorUsername: string;
  targetUserId: string;
  targetUsername: string;
  targetEmail: string | null;
  createdAt: string;
};

function historyActionPhrase(action: ModerationAction): string {
  switch (action) {
    case "ban":
      return " banned ";
    case "restore":
      return " restored ";
    case "grant-moderator":
      return " granted moderator access to ";
    default:
      return " removed moderator access from ";
  }
}

type ModerationHistoryRowProps = {
  entry: ModerationHistoryEntry;
  /**
   * Palette values arrive one by one rather than as the palette object:
   * useColors() returns a new object on every render, so a row comparing it
   * against the previous one would never find its props unchanged.
   */
  cardColor: string;
  cardEdgeColor: string;
  borderColor: string;
  foregroundColor: string;
  mutedColor: string;
  linkColor: string;
  onFilterActor: (userId: string) => void;
  onFilterTarget: (userId: string) => void;
};
function apiBaseUrl(): string {
  const domain = process.env["EXPO_PUBLIC_DOMAIN"];
  return domain ? `https://${domain}` : "http://localhost:5000";
}

/**
 * As much of a browser element as the administrator picker needs: whether
 * focus can be put back on it, and whether another element sits inside it.
 * react-native-web hands these nodes through from the DOM untouched.
 */
type WebFocusNode = {
  focus?: () => void;
  contains?: (node: WebFocusNode) => boolean;
};

/**
 * A key press, as the browser reports it to a react-native-web view.
 * `target` is the element the key reached, which is the focused one.
 */
type WebKeyEvent = {
  key?: string;
  nativeEvent?: { key?: string } | null;
  preventDefault?: () => void;
  target?: { click?: () => void } | null;
};

/**
 * Focus leaving an element. `relatedTarget` is where focus is going, and
 * `currentTarget` the element this handler is attached to.
 */
type WebFocusOutEvent = {
  relatedTarget?: WebFocusNode | null;
  currentTarget?: WebFocusNode | null;
  nativeEvent?: { relatedTarget?: WebFocusNode | null } | null;
};

/** A step through the open administrator list. */
type ActorOptionMove = "next" | "previous" | "first" | "last";

/**
 * A press beginning on an element. One press travels outwards through
 * every element it lands in, so `nativeEvent` -- the press itself, which
 * each of those elements is handed -- is what tells two handlers they are
 * looking at the same press rather than two of them.
 */
type PressStartEvent = {
  nativeEvent?: unknown;
};

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tabBarClearance = useTabBarClearance(CONTENT_TRAILING_SPACING);
  const {
    username,
    avatarEmoji,
    userId,
    isAdmin,
    refreshAdminAccess,
    setUsername,
    setAvatarEmoji,
  } = useApp();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { clearLocalKeys } = useCrypto();
  const { isConnected, connectionError } = useSocket();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(username);
  const [saved, setSaved] = useState(false);
  const [moderationUserId, setModerationUserId] = useState("");
  const [moderationFeedback, setModerationFeedback] =
    useState<ModerationFeedback | null>(null);
  const [isModerating, setIsModerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AccountSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedAccount, setSelectedAccount] =
    useState<AccountSearchResult | null>(null);
  const [moderators, setModerators] = useState<Moderator[]>([]);
  const [moderatorsError, setModeratorsError] = useState<string | null>(null);
  const [isLoadingModerators, setIsLoadingModerators] = useState(false);
  const [moderatorFeedback, setModeratorFeedback] =
    useState<ModerationFeedback | null>(null);
  const [isGrantingModerator, setIsGrantingModerator] = useState(false);
  const [revokingModeratorId, setRevokingModeratorId] = useState<string | null>(
    null,
  );
  const [historyEntries, setHistoryEntries] = useState<
    ModerationHistoryEntry[]
  >([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [historyNextCursor, setHistoryNextCursor] = useState<number | null>(
    null,
  );
  const [historyTargetFilter, setHistoryTargetFilter] = useState("");
  const [historyActorFilter, setHistoryActorFilter] = useState("");
  const [isActorPickerOpen, setIsActorPickerOpen] = useState(false);
  /** The picker's toggle, so a keyboard dismissal can hand focus back. */
  const actorPickerToggleRef = useRef<View>(null);
  /**
   * The press the picker has claimed as its own, which the screen around
   * it then lets be. Holding the press itself rather than a "this one was
   * mine" flag keeps a claim that the screen never heard about from being
   * spent on the next press instead.
   */
  const actorPickerPressRef = useRef<unknown>(null);
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState<{
    targetUserId?: string;
    actorUserId?: string;
  }>({});
  // Tracks the most recently started history request. Any older,
  // still-in-flight request's response is discarded on arrival so that a
  // slow initial/filtered/load-more request can never clobber the result of
  // a request the admin triggered afterward (e.g. changing filters while a
  // "Load more" fetch is still pending).
  const historyRequestIdRef = useRef(0);
  /** The screen's scrolling list, whose items are the history rows. */
  const historyListRef = useRef<FlatList<ModerationHistoryEntry>>(null);
  /**
   * How far down the content the newest entry sits, measured whenever the
   * profile content above the log lays out. Scrolling straight back to it
   * is what saves an administrator several pages deep the whole way up.
   */
  const newestEntryOffsetRef = useRef(0);
  const [isBelowNewestEntry, setIsBelowNewestEntry] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState<
    string | null
  >(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const accountActionRef = useRef(false);

  // The panel follows the account's current moderator role: the shared
  // re-check reads it as the screen comes into view and rarely while it stays
  // there, under the change the chat connection normally pushes down.
  useModeratorRoleRecheck();

  /**
   * Every moderation request goes through here so that a refusal re-checks
   * this account's role. Access removed mid-session then takes the panel away
   * instead of leaving controls that only produce permission errors.
   */
  async function moderationFetch(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    if (response.status === 403) void refreshAdminAccess();
    return response;
  }

  async function handleSignOut() {
    if (accountActionRef.current) return;
    accountActionRef.current = true;
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      // The root auth guard redirects when Clerk clears the session.
      // Keep persisted encryption keys so signing back in preserves room access.
      await signOut();
    } catch {
      setSignOutError("Unable to sign out. Please try again.");
      accountActionRef.current = false;
      setIsSigningOut(false);
    }
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  async function handleSave() {
    const trimmed = draft.trim();
    if (trimmed.length < 2) {
      Alert.alert("Name too short", "Please enter at least 2 characters.");
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await setUsername(trimmed);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleEmojiSelect(emoji: AvatarEmoji) {
    if (emoji === avatarEmoji) return;
    await Haptics.selectionAsync();
    await setAvatarEmoji(emoji);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSearch() {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchError("Enter at least 2 characters to search.");
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const token = await getToken();
      const base = apiBaseUrl();
      const response = await moderationFetch(
        `${base}/api/moderation/search?query=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${token ?? ""}` } },
      );
      const result = (await response.json().catch(() => null)) as {
        results?: AccountSearchResult[];
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Unable to search accounts.");
      }
      setSearchResults(result?.results ?? []);
    } catch (error) {
      setSearchResults([]);
      setSearchError(
        error instanceof Error ? error.message : "Unable to search accounts.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  async function fetchModerators() {
    setIsLoadingModerators(true);
    try {
      const token = await getToken();
      const response = await moderationFetch(
        `${apiBaseUrl()}/api/moderation/moderators`,
        { headers: { Authorization: `Bearer ${token ?? ""}` } },
      );
      const result = (await response.json().catch(() => null)) as {
        moderators?: Moderator[];
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Unable to load the moderator list.");
      }
      setModerators(result?.moderators ?? []);
      setModeratorsError(null);
    } catch (error) {
      // Keep any previously loaded moderators on screen: an out-of-date list
      // with a visible warning is more useful than an empty one that reads
      // as "nobody moderates this app".
      setModeratorsError(
        error instanceof Error
          ? error.message
          : "Unable to load the moderator list.",
      );
    } finally {
      setIsLoadingModerators(false);
    }
  }

  async function grantModeratorAccess() {
    const targetId = moderationUserId.trim();
    if (!targetId) {
      setModeratorFeedback({
        kind: "error",
        message: "Enter an account user ID before changing moderator access.",
      });
      return;
    }

    setIsGrantingModerator(true);
    setModeratorFeedback(null);
    try {
      const token = await getToken();
      const response = await moderationFetch(
        `${apiBaseUrl()}/api/moderation/moderators`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId: targetId }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        username?: string;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Unable to grant moderator access.");
      }
      const label = result?.username
        ? `${result.username} (${targetId})`
        : targetId;
      setModeratorFeedback({
        kind: "success",
        message: `${label} can now moderate ${PRODUCT_NAME}.`,
      });
      await fetchModerators();
      void fetchHistory({
        targetUserId: appliedHistoryFilters.targetUserId,
        actorUserId: appliedHistoryFilters.actorUserId,
      });
    } catch (error) {
      setModeratorFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to grant moderator access.",
      });
    } finally {
      setIsGrantingModerator(false);
    }
  }

  async function revokeModeratorAccess(moderator: Moderator) {
    setRevokingModeratorId(moderator.userId);
    setModeratorFeedback(null);
    try {
      const token = await getToken();
      const response = await moderationFetch(
        `${apiBaseUrl()}/api/moderation/moderators/${encodeURIComponent(moderator.userId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token ?? ""}` },
        },
      );
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Unable to remove moderator access.");
      }
      setModeratorFeedback({
        kind: "success",
        message: `${moderator.username ?? moderator.userId} can no longer moderate ${PRODUCT_NAME}.`,
      });
      await fetchModerators();
      void fetchHistory({
        targetUserId: appliedHistoryFilters.targetUserId,
        actorUserId: appliedHistoryFilters.actorUserId,
      });
    } catch (error) {
      setModeratorFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to remove moderator access.",
      });
    } finally {
      setRevokingModeratorId(null);
    }
  }

  async function fetchHistory(options?: {
    cursor?: number;
    append?: boolean;
    targetUserId?: string;
    actorUserId?: string;
  }) {
    const append = options?.append ?? false;
    const requestId = ++historyRequestIdRef.current;
    if (append) {
      setIsLoadingMoreHistory(true);
    } else {
      setIsLoadingHistory(true);
      // A fresh (non-append) request supersedes any in-flight "load more"
      // request. That older request's own `finally` will see its request id
      // is stale and skip cleanup, so clear its loading state here --
      // otherwise the Load more button could stay stuck disabled forever.
      setIsLoadingMoreHistory(false);
    }
    setHistoryError(null);
    try {
      const token = await getToken();
      const base = apiBaseUrl();
      // Callers must pass the complete desired filter set explicitly (including
      // `undefined` to mean "no filter") -- merging with `appliedHistoryFilters`
      // state here would read a stale closure when a caller updates that state
      // and calls fetchHistory in the same synchronous handler (e.g. Clear).
      const targetUserId = options?.targetUserId;
      const actorUserId = options?.actorUserId;
      const params = new URLSearchParams();
      if (options?.cursor !== undefined)
        params.set("cursor", String(options.cursor));
      if (targetUserId) params.set("targetUserId", targetUserId);
      if (actorUserId) params.set("actorUserId", actorUserId);
      const queryString = params.toString();
      const response = await moderationFetch(
        `${base}/api/moderation/history${queryString ? `?${queryString}` : ""}`,
        { headers: { Authorization: `Bearer ${token ?? ""}` } },
      );
      const result = (await response.json().catch(() => null)) as {
        actions?: ModerationHistoryEntry[];
        nextCursor?: number | null;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Unable to load moderation history.");
      }
      // A newer request (fresh reload, filter change, or another load-more)
      // has since started -- this response is stale, so drop it instead of
      // mixing results from two different query sets.
      if (historyRequestIdRef.current !== requestId) return;
      setHistoryEntries((current) =>
        append
          ? [...current, ...(result?.actions ?? [])]
          : (result?.actions ?? []),
      );
      setHistoryNextCursor(result?.nextCursor ?? null);
    } catch (error) {
      if (historyRequestIdRef.current !== requestId) return;
      if (!append) {
        // Nothing on screen answers the query that just failed: those rows
        // came from the previous filter set, so keeping them would read as
        // this query's result. A failed "load more" is the opposite case --
        // the rows already shown are still this query's first page, so they
        // stay put and the button stays available for another attempt.
        setHistoryEntries([]);
        setHistoryNextCursor(null);
      }
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Unable to load moderation history.",
      );
    } finally {
      if (historyRequestIdRef.current === requestId) {
        if (append) {
          setIsLoadingMoreHistory(false);
        } else {
          setIsLoadingHistory(false);
        }
      }
    }
  }

  function handleApplyHistoryFilters() {
    const targetUserId = historyTargetFilter.trim() || undefined;
    const actorUserId = historyActorFilter.trim() || undefined;
    setAppliedHistoryFilters({ targetUserId, actorUserId });
    void fetchHistory({ targetUserId, actorUserId });
  }

  // One-tap filtering from a search result, the selected account, or a
  // history row: fills in the matching filter field and re-runs the query
  // immediately, without disturbing whatever is currently in the other field.
  //
  // Held steady across renders because every row on screen is handed these:
  // a new function each time would be a changed prop for all of them.
  // `fetchHistory` is deliberately not a dependency -- it is rebuilt on every
  // render, and the copy captured here reads nothing that goes stale (the
  // query is passed in, and the rest is state setters and refs).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filterHistoryByTarget = useCallback(
    (userId: string) => {
      setHistoryTargetFilter(userId);
      const actorUserId = historyActorFilter.trim() || undefined;
      setAppliedHistoryFilters({ targetUserId: userId, actorUserId });
      void fetchHistory({ targetUserId: userId, actorUserId });
    },
    [historyActorFilter],
  );

  // An empty id means "any administrator", which the picker offers so a
  // chosen administrator can be dropped without clearing the account
  // filter alongside it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filterHistoryByActor = useCallback(
    (userId: string) => {
      setHistoryActorFilter(userId);
      const targetUserId = historyTargetFilter.trim() || undefined;
      const actorUserId = userId.trim() || undefined;
      setAppliedHistoryFilters({ targetUserId, actorUserId });
      void fetchHistory({ targetUserId, actorUserId });
    },
    [historyTargetFilter],
  );

  function handlePickHistoryActor(userId: string) {
    closeActorPicker();
    filterHistoryByActor(userId);
  }

  /**
   * The picker's options in the order they are rendered: the empty id that
   * drops the filter, then every administrator on the list.
   */
  const actorOptionIds = useMemo(
    () => ["", ...moderators.map((moderator) => moderator.userId)],
    [moderators],
  );
  /** The rendered option rows, so a key press can move focus between them. */
  const actorOptionRefs = useRef(new Map<string, View>());
  /**
   * Which option the walk is on, or null while focus is elsewhere -- on
   * the toggle, most often. Held in state rather than a ref because the
   * list's one stop in the tab order is drawn from it: the stop is the row
   * the walk is on, so it has to move as the walk does.
   */
  const [focusedActorOption, setFocusedActorOption] = useState<string | null>(
    null,
  );

  function registerActorOption(userId: string, row: View | null) {
    if (row === null) actorOptionRefs.current.delete(userId);
    else actorOptionRefs.current.set(userId, row);
  }

  function focusActorOption(index: number) {
    const userId = actorOptionIds[index];
    if (userId === undefined) return;
    setFocusedActorOption(userId);
    actorOptionRefs.current.get(userId)?.focus();
  }

  // The list closing takes its rows with it, so nothing in it holds focus
  // any more.
  function closeActorPicker() {
    setIsActorPickerOpen(false);
    setFocusedActorOption(null);
  }

  function toggleActorPicker() {
    setIsActorPickerOpen((open) => !open);
    setFocusedActorOption(null);
  }

  /**
   * The keys the picker has to answer for itself.
   *
   * Escape backs out of the open list, the way it dismisses a menu
   * elsewhere on the web. Focus returns to the toggle because the row it
   * was on is about to be removed, and focus left on a removed element
   * falls back to the top of the page.
   *
   * The arrow keys, Home and End walk the open list. Tab is a single press
   * past the whole list rather than one per administrator -- the list is
   * one stop in the tab order, as it is elsewhere on the web -- so these
   * keys are what move inside it: Down and Up step between the options,
   * Home and End jump to the ends, and Enter picks whatever the walk
   * landed on. The row the walk reaches answers Enter itself in a browser
   * -- react-native-web presses a focused element on that key whatever
   * kind of element it is, and keeps the key from travelling any further
   * -- so this answers the key wherever it does arrive here, and lands on
   * the same option either way.
   *
   * Space presses whatever is focused in a browser, but only where the
   * element is a button. Naming the toggle and its rows as a list of
   * choices -- which is what a screen reader has to hear -- leaves them as
   * plain elements the browser does nothing for, and react-native-web
   * gives a pressable no way to take the key back: it fills in its own key
   * handling last and drops any passed to it. The press is therefore made
   * here, on the element the key reached, in the one way that element
   * already answers: a click.
   */
  function handleActorPickerKeyDown(event: WebKeyEvent) {
    // "Esc" is what browsers predating the current key names report.
    const key = event.nativeEvent?.key ?? event.key;
    if (key === "Escape" || key === "Esc") {
      if (!isActorPickerOpen) return;
      closeActorPicker();
      actorPickerToggleRef.current?.focus();
      return;
    }
    if (isActorPickerOpen) {
      const focused = focusedActorOption;
      // An administrator dropped from the list while their row was focused
      // leaves nothing to move on from or pick, so the walk starts over.
      const focusedIndex =
        focused === null ? -1 : actorOptionIds.indexOf(focused);
      const move = actorOptionMove(key);
      if (move !== null) {
        // These keys scroll the page by default, which would carry the
        // list being walked off the screen.
        event.preventDefault?.();
        focusActorOption(
          movedActorOptionIndex(move, focusedIndex, actorOptionIds.length - 1),
        );
        return;
      }
      if (key === "Enter" && focused !== null && focusedIndex >= 0) {
        event.preventDefault?.();
        handlePickHistoryActor(focused);
        return;
      }
    }
    if (key !== " " && key !== "Spacebar") return;
    const focused = event.target;
    if (!focused?.click) return;
    // Space scrolls the page by default, which would carry the list the
    // press just acted on off the screen.
    event.preventDefault?.();
    focused.click();
  }

  /**
   * Tabbing past the picker would otherwise leave the list open on top of
   * the filter row below it. The browser names where focus is going: a move
   * between the toggle and its own rows keeps the list open, and anything
   * outside the picker closes it. A move the browser cannot name -- a click
   * on unfocusable page furniture, or the window losing focus altogether --
   * leaves the list alone, so a row cannot disappear from under a press
   * that is still on its way.
   */
  function handleActorPickerFocusOut(event: WebFocusOutEvent) {
    if (!isActorPickerOpen) return;
    const nextFocus = event.relatedTarget ?? event.nativeEvent?.relatedTarget;
    if (!nextFocus) return;
    if (event.currentTarget?.contains?.(nextFocus)) return;
    closeActorPicker();
  }

  /**
   * Claims a press that begins anywhere in the picker, on its way out to
   * the screen. The claim is what keeps the row under the press from being
   * taken away before the press lands on it; see the rule below.
   */
  function handleActorPickerPressStart(event: PressStartEvent) {
    actorPickerPressRef.current = event.nativeEvent ?? event;
  }

  /**
   * Clicking away is the ordinary way to dismiss a menu, and the rule
   * above cannot do it: a click on a heading, on the card, or on empty
   * space moves focus nowhere the browser can name, so it leaves the list
   * open over the filter row below.
   *
   * Every press on the screen passes through here, including the ones that
   * began inside the picker and claimed themselves on the way. Those are
   * left alone -- a row taken away now would never receive the press still
   * on its way to it -- and every other press closes the list.
   */
  function handlePressStartOutsideActorPicker(event: PressStartEvent) {
    const press = event.nativeEvent ?? event;
    const startedInPicker = actorPickerPressRef.current === press;
    actorPickerPressRef.current = null;
    if (startedInPicker) return;
    if (!isActorPickerOpen) return;
    setIsActorPickerOpen(false);
  }

  /**
   * react-native-web forwards both handlers to the DOM node, where the
   * browser's key and focus events reach them. React Native describes
   * neither in the shape a browser sends -- a phone has no key events, and
   * its blur event carries no `relatedTarget` -- so the pair is converted
   * once here rather than at the view that uses them.
   */
  const actorPickerKeyboardProps = {
    onKeyDown: handleActorPickerKeyDown,
    onBlur: handleActorPickerFocusOut,
  } as unknown as ViewProps;

  function handleClearHistoryFilters() {
    setHistoryTargetFilter("");
    setHistoryActorFilter("");
    setAppliedHistoryFilters({});
    void fetchHistory({});
  }

  function handleLoadMoreHistory() {
    if (historyNextCursor === null) return;
    void fetchHistory({
      cursor: historyNextCursor,
      append: true,
      targetUserId: appliedHistoryFilters.targetUserId,
      actorUserId: appliedHistoryFilters.actorUserId,
    });
  }

  // Only re-fetch when admin status changes -- `getToken` from Clerk is not
  // guaranteed to be referentially stable across renders, so depending on it
  // here would cause a fetch loop instead of a one-time load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isAdmin) {
      // Access can be taken away while this screen is open. Everything the
      // log has already read goes with the panel, and a reply still on its
      // way is disowned here so it cannot refill the log behind it.
      historyRequestIdRef.current += 1;
      setHistoryEntries((current) => (current.length === 0 ? current : []));
      setHistoryNextCursor(null);
      setHistoryError(null);
      setIsLoadingHistory(false);
      setIsLoadingMoreHistory(false);
      setIsBelowNewestEntry(false);
      return;
    }
    void fetchHistory();
    void fetchModerators();
  }, [isAdmin]);

  function handleSelectAccount(account: AccountSearchResult) {
    setSelectedAccount(account);
    setModerationUserId(account.userId);
    setModerationFeedback(null);
  }

  function handleModerationUserIdChange(value: string) {
    setModerationUserId(value);
    if (selectedAccount && value !== selectedAccount.userId) {
      setSelectedAccount(null);
    }
  }

  async function setBanState(banned: boolean) {
    const targetId = moderationUserId.trim();
    if (!targetId) {
      setModerationFeedback({
        kind: "error",
        message: "Enter an account user ID before changing access.",
      });
      return;
    }

    setIsModerating(true);
    setModerationFeedback(null);
    try {
      const token = await getToken();
      const base = apiBaseUrl();
      const response = await moderationFetch(
        banned
          ? `${base}/api/moderation/ban`
          : `${base}/api/moderation/ban/${encodeURIComponent(targetId)}`,
        {
          method: banned ? "POST" : "DELETE",
          headers: {
            Authorization: `Bearer ${token ?? ""}`,
            ...(banned ? { "Content-Type": "application/json" } : {}),
          },
          ...(banned ? { body: JSON.stringify({ userId: targetId }) } : {}),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Unable to update this account.");
      }
      const label =
        selectedAccount && selectedAccount.userId === targetId
          ? `${selectedAccount.username} (${targetId})`
          : targetId;
      setModerationFeedback({
        kind: "success",
        message: banned
          ? `Account ${label} is banned and can no longer access ${PRODUCT_NAME}.`
          : `Account ${label} has been restored and can access ${PRODUCT_NAME} again.`,
      });
      setSearchResults((results) =>
        results.map((result) =>
          result.userId === targetId ? { ...result, banned } : result,
        ),
      );
      setSelectedAccount((current) =>
        current && current.userId === targetId
          ? { ...current, banned }
          : current,
      );
      void fetchHistory({
        targetUserId: appliedHistoryFilters.targetUserId,
        actorUserId: appliedHistoryFilters.actorUserId,
      });
    } catch (error) {
      setModerationFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to update this account.",
      });
    } finally {
      setIsModerating(false);
    }
  }

  async function deleteAccount() {
    if (accountActionRef.current) return;
    accountActionRef.current = true;
    setIsDeletingAccount(true);
    setAccountDeletionError(null);
    try {
      const token = await getToken();
      const response = await fetch(`${apiBaseUrl()}/api/profile`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(result?.error ?? "Unable to delete your account.");
      }
      await clearLocalKeys();
      await signOut();
    } catch (error) {
      setAccountDeletionError(
        error instanceof Error
          ? error.message
          : "Unable to delete your account.",
      );
    } finally {
      accountActionRef.current = false;
      setIsDeletingAccount(false);
    }
  }

  function confirmAccountDeletion() {
    const message =
      "This permanently deletes your account and removes your access to encrypted rooms. Shared room history will remain available to other members.";
    if (Platform.OS === "web" && typeof globalThis.confirm === "function") {
      if (globalThis.confirm(`${message}\n\nDelete your account?`)) {
        void deleteAccount();
      }
      return;
    }
    Alert.alert("Delete your account?", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete account",
        style: "destructive",
        onPress: () => void deleteAccount(),
      },
    ]);
  }

  const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    newestEntryOffsetRef.current = event.nativeEvent.layout.height;
  }, []);

  // The newest entry sits directly below everything else on the screen, so
  // the log has scrolled past it once the offset clears that block.
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const newestEntryOffset = newestEntryOffsetRef.current;
      const belowNewest =
        newestEntryOffset > 0 &&
        event.nativeEvent.contentOffset.y > newestEntryOffset;
      setIsBelowNewestEntry((current) =>
        current === belowNewest ? current : belowNewest,
      );
    },
    [],
  );

  const handleJumpToNewest = useCallback(() => {
    historyListRef.current?.scrollToOffset({
      offset: newestEntryOffsetRef.current,
      animated: true,
    });
    setIsBelowNewestEntry(false);
  }, []);

  const historyEntryKey = useCallback(
    (entry: ModerationHistoryEntry) => String(entry.id),
    [],
  );

  // Palette values go in one by one: useColors() hands back a new object on
  // every render, which a row comparing its props would never see as equal.
  const renderHistoryEntry = useCallback(
    ({ item }: ListRenderItemInfo<ModerationHistoryEntry>) => (
      <ModerationHistoryRow
        entry={item}
        cardColor={colors.card}
        cardEdgeColor={colors.destructive}
        borderColor={colors.border}
        foregroundColor={colors.foreground}
        mutedColor={colors.mutedForeground}
        linkColor={colors.primary}
        onFilterActor={filterHistoryByActor}
        onFilterTarget={filterHistoryByTarget}
      />
    ),
    [
      colors.border,
      colors.card,
      colors.destructive,
      colors.foreground,
      colors.mutedForeground,
      colors.primary,
      filterHistoryByActor,
      filterHistoryByTarget,
    ],
  );

  const renderHistorySeparator = useCallback(
    () => (
      <View
        style={[
          styles.historyRowSeparator,
          { backgroundColor: colors.card, borderColor: colors.destructive },
        ]}
      />
    ),
    [colors.card, colors.destructive],
  );

  const historyListFooter = (
    <View
      style={[
        styles.historyCardFooter,
        {
          backgroundColor: colors.card,
          borderColor: colors.destructive,
          borderBottomLeftRadius: colors.radius,
          borderBottomRightRadius: colors.radius,
        },
      ]}
    >
      {historyNextCursor !== null ? (
        <TouchableOpacity
          testID="moderation-history-load-more"
          style={[
            styles.historyLoadMore,
            {
              borderColor: colors.border,
              borderRadius: colors.radius - 2,
              opacity: isLoadingMoreHistory ? 0.6 : 1,
            },
          ]}
          onPress={handleLoadMoreHistory}
          disabled={isLoadingMoreHistory}
          accessibilityRole="button"
          accessibilityLabel="Load more moderation history"
        >
          <Text
            style={[
              styles.historyFilterButtonText,
              { color: colors.foreground },
            ]}
          >
            {isLoadingMoreHistory ? "Loading\u2026" : "Load more"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  // The rows are the screen list's own items now, which puts them outside
  // the panel they belong to. Access can be taken away while the screen is
  // open, so they are gated in their own right: the rows, the button under
  // them and the way back to the newest of them leave in the same render as
  // the panel, without waiting for the state holding them to be cleared.
  const visibleHistoryEntries = isAdmin ? historyEntries : [];

  // The administrator filter is stored as the account id the query takes,
  // but an administrator is recognised by name, so the picker reads the
  // name out of the moderator list already loaded for this panel. An id
  // typed by hand, or one belonging to an account that no longer
  // moderates, is shown as itself rather than replaced by a wrong name.
  const historyActorFilterId = historyActorFilter.trim();
  const pickedHistoryActor =
    moderators.find((moderator) => moderator.userId === historyActorFilterId) ??
    null;
  const historyActorLabel = historyActorFilterId
    ? (pickedHistoryActor?.username ?? historyActorFilterId)
    : "Any administrator";

  // The open list is one stop in the tab order rather than one per
  // administrator: this row is the one Tab reaches, and every other row is
  // stepped over on the way past while staying reachable by the walking
  // keys and the pointer. That is how a list of choices behaves elsewhere
  // on the web, and it is what the arrow keys were added to replace Tab
  // with. The walk carries the stop with it; before it has started -- and
  // so wherever focus arrives from outside -- the stop sits on the
  // administrator in effect, falling back to the row at the top of the
  // list when the field names nobody on it.
  const actorTabStopId =
    focusedActorOption !== null && actorOptionIds.includes(focusedActorOption)
      ? focusedActorOption
      : actorOptionIds.includes(historyActorFilterId)
        ? historyActorFilterId
        : (actorOptionIds[0] ?? "");

  /**
   * Where one option row sits in that order, as the browser reads it: 0 is
   * the stop Tab lands on, and -1 a row it steps over -- still reachable
   * by the walking keys, by a press, and by a screen reader, which has its
   * own way through a list and never consults this.
   *
   * A phone is left exactly as it was, with every row reachable by a
   * hardware keyboard: React Native gives this prop to a view rather than
   * to a touchable, and the touchable drops it on the way to one. Saying
   * the same thing with `focusable` would instead cross to the phone and
   * take that reach away, which nothing there restores -- the keys that
   * replace Tab in a browser are a browser's key events. The prop is
   * spread in because the touchable's types describe the phone's props
   * only.
   */
  function actorOptionTabOrder(userId: string) {
    return {
      tabIndex: actorTabStopId === userId ? 0 : -1,
    } as unknown as TouchableOpacityProps;
  }

  // Everything above the moderation log. The log is the list's data rather
  // than more content inside a single scrolling view, so only the rows near
  // the viewport stay mounted however many pages have been loaded, and this
  // block becomes the header above them.
  const profileContent = (
    <View testID="profile-content-header" onLayout={handleHeaderLayout}>
      <View
        style={[
          styles.avatarRing,
          { backgroundColor: colors.primary + "20", borderRadius: 60 },
        ]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${username || "Your"} profile avatar: ${avatarEmoji}`}
        testID="current-profile-avatar"
      >
        <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          PROFILE AVATAR
        </Text>
        <Text style={[styles.emojiHint, { color: colors.mutedForeground }]}>
          Choose the avatar your teammates will see in chat.
        </Text>
        <View style={styles.emojiGrid}>
          {AVATAR_EMOJIS.map((emoji) => {
            const selected = emoji === avatarEmoji;
            return (
              <TouchableOpacity
                key={emoji}
                style={[
                  styles.emojiOption,
                  {
                    backgroundColor: selected
                      ? colors.primary + "20"
                      : colors.background,
                    borderColor: selected ? colors.primary : colors.border,
                    borderRadius: colors.radius - 2,
                  },
                ]}
                onPress={() => handleEmojiSelect(emoji)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${emoji} as your profile emoji`}
                accessibilityState={{ selected }}
                testID={`avatar-emoji-${emoji}`}
              >
                <Text style={styles.emojiOptionText}>{emoji}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          DISPLAY NAME
        </Text>
        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  borderRadius: colors.radius - 2,
                },
              ]}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              maxLength={30}
              returnKeyType="done"
              onSubmitEditing={handleSave}
              placeholderTextColor={colors.mutedForeground}
            />
            <TouchableOpacity
              style={[
                styles.saveBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius - 2,
                },
              ]}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <Feather
                name="check"
                size={18}
                color={colors.primaryForeground}
              />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.nameRow}
            onPress={() => {
              setDraft(username);
              setEditing(true);
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.name, { color: colors.foreground }]}>
              {username || "Tap to set name"}
            </Text>
            <Feather name="edit-2" size={16} color={colors.primary} />
          </TouchableOpacity>
        )}
        {saved && (
          <Text style={[styles.saved, { color: colors.online }]}>Saved!</Text>
        )}
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          USER ID
        </Text>
        <Text
          style={[styles.uid, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {userId}
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <TouchableOpacity
          testID="sign-out-button"
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          accessibilityState={{
            disabled: isSigningOut || isDeletingAccount,
            busy: isSigningOut,
          }}
          disabled={isSigningOut || isDeletingAccount}
          onPress={() => void handleSignOut()}
          style={[
            styles.deleteAccountButton,
            {
              minHeight: 48,
              backgroundColor: colors.primary,
              borderRadius: colors.radius - 2,
              opacity: isSigningOut || isDeletingAccount ? 0.6 : 1,
            },
          ]}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.moderationButtonText,
              { color: colors.primaryForeground },
            ]}
          >
            {isSigningOut ? "Signing out…" : "Sign out"}
          </Text>
        </TouchableOpacity>
        {signOutError && (
          <Text
            testID="sign-out-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.accountDeletionHint, { color: colors.destructive }]}
          >
            {signOutError}
          </Text>
        )}
      </View>

      <View
        testID="account-deletion-panel"
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.destructive,
            borderRadius: colors.radius,
          },
        ]}
      >
        <Text style={[styles.sectionLabel, { color: colors.destructive }]}>
          DELETE ACCOUNT
        </Text>
        <Text
          style={[
            styles.accountDeletionHint,
            { color: colors.mutedForeground },
          ]}
        >
          Permanently remove your profile, room access, and encryption keys.
          Messages shared with other room members will remain in their encrypted
          history.
        </Text>
        <TouchableOpacity
          testID="delete-account-button"
          style={[
            styles.deleteAccountButton,
            {
              backgroundColor: colors.destructive,
              borderRadius: colors.radius - 2,
              opacity: isDeletingAccount ? 0.6 : 1,
            },
          ]}
          onPress={confirmAccountDeletion}
          disabled={isDeletingAccount || isSigningOut}
          accessibilityRole="button"
          accessibilityLabel="Delete account permanently"
          accessibilityState={{
            disabled: isDeletingAccount || isSigningOut,
            busy: isDeletingAccount,
          }}
        >
          <Text
            style={[
              styles.moderationButtonText,
              { color: colors.primaryForeground },
            ]}
          >
            {isDeletingAccount ? "Deleting account…" : "Delete account"}
          </Text>
        </TouchableOpacity>
        {accountDeletionError ? (
          <Text
            testID="account-deletion-error"
            accessibilityRole="alert"
            style={[styles.moderationFeedback, { color: colors.destructive }]}
          >
            {accountDeletionError}
          </Text>
        ) : null}
      </View>

      {/* The room manager opens over this screen and is dismissed again,
          so it has no tab of its own: this is the only way into it from
          inside the app, and it is here because it is an administrator's
          own control, next to the moderation panel below. */}
      {isAdmin ? (
        <View
          testID="room-management-panel"
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View style={styles.moderationHeading}>
            <Feather name="grid" size={16} color={colors.primary} />
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>
              ROOM MANAGEMENT
            </Text>
          </View>
          <Text
            style={[styles.moderationHint, { color: colors.mutedForeground }]}
          >
            Review every {PRODUCT_NAME} room with its members and activity,
            and close or delete one of them.
          </Text>
          <TouchableOpacity
            testID="open-room-manager-button"
            accessibilityRole="button"
            accessibilityLabel="Open the room manager"
            onPress={() => router.push("/admin-rooms")}
            style={[
              styles.deleteAccountButton,
              {
                minHeight: 48,
                backgroundColor: colors.primary,
                borderRadius: colors.radius - 2,
              },
            ]}
          >
            <Text
              style={[
                styles.moderationButtonText,
                { color: colors.primaryForeground },
              ]}
            >
              Open room manager
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isAdmin ? (
        <View
          testID="moderation-panel"
          style={[
            styles.card,
            styles.moderationCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.destructive,
              borderRadius: colors.radius,
            },
            // The rows below are the list's own items, so the card is left
            // open at the bottom for them to continue and for the footer to
            // close: together the three pieces read as the one card they
            // were before the log was handed to the list.
            visibleHistoryEntries.length > 0
              ? styles.moderationCardOpenBottom
              : null,
          ]}
        >
          <View style={styles.moderationHeading}>
            <Feather name="shield" size={16} color={colors.destructive} />
            <Text style={[styles.sectionLabel, { color: colors.destructive }]}>
              ACCOUNT MODERATION
            </Text>
          </View>
          <Text
            style={[styles.moderationHint, { color: colors.mutedForeground }]}
          >
            Ban immediately removes room, call, sandbox, and assistant access.
            Restore returns access to verified accounts.
          </Text>

          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            FIND AN ACCOUNT
          </Text>
          <View style={styles.searchRow}>
            <TextInput
              testID="moderation-search-input"
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  borderRadius: colors.radius - 2,
                },
              ]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Search by display name or email"
              placeholderTextColor={colors.mutedForeground}
              returnKeyType="search"
              onSubmitEditing={() => void handleSearch()}
            />
            <TouchableOpacity
              testID="moderation-search-button"
              style={[
                styles.searchBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius - 2,
                  opacity: isSearching ? 0.6 : 1,
                },
              ]}
              onPress={() => void handleSearch()}
              disabled={isSearching}
              accessibilityRole="button"
              accessibilityLabel="Search accounts"
            >
              <Feather
                name={isSearching ? "loader" : "search"}
                size={18}
                color={colors.primaryForeground}
              />
            </TouchableOpacity>
          </View>
          {searchError ? (
            <Text
              testID="moderation-search-error"
              accessibilityRole="alert"
              style={[styles.moderationHint, { color: colors.destructive }]}
            >
              {searchError}
            </Text>
          ) : null}
          {searchResults.length > 0 ? (
            <View
              testID="moderation-search-results"
              style={[styles.searchResults, { borderColor: colors.border }]}
              // Only one of these accounts can be staged for a ban, restore,
              // or moderator grant at a time, so the rows are one set of
              // choices rather than a run of unrelated buttons.
              accessibilityRole="radiogroup"
              accessibilityLabel="Accounts matching your search"
            >
              {searchResults.map((result) => {
                const selected = selectedAccount?.userId === result.userId;
                const isModerator = moderators.some(
                  (moderator) => moderator.userId === result.userId,
                );
                return (
                  <TouchableOpacity
                    key={result.userId}
                    testID={`moderation-search-result-${result.userId}`}
                    style={[
                      styles.searchResultRow,
                      {
                        borderColor: colors.border,
                        backgroundColor: selected
                          ? colors.primary + "20"
                          : "transparent",
                      },
                    ]}
                    onPress={() => handleSelectAccount(result)}
                    activeOpacity={0.75}
                    // The tint is the only sighted cue that this row is the
                    // account now staged, so the row has to carry the same
                    // choice as a state a screen reader announces. The
                    // grouped state is the native half of that: React
                    // Native Web drops it before the page is built, and a
                    // radio conveys its choice through aria-checked, so the
                    // browser needs its own copy of the same fact.
                    accessibilityRole="radio"
                    accessibilityLabel={`Select account ${result.username}`}
                    accessibilityState={{ selected }}
                    aria-checked={selected}
                    // Off the button role, React Native Web stops treating
                    // the space bar as a press, which is the key a radio is
                    // chosen with. Its own handler owns the bubble phase, so
                    // the space bar is answered on the way down instead.
                    {...(Platform.OS === "web"
                      ? {
                          onKeyDownCapture: (event: {
                            key: string;
                            preventDefault: () => void;
                          }) => {
                            if (event.key === " " || event.key === "Spacebar") {
                              // Otherwise the page scrolls under the choice.
                              event.preventDefault();
                              handleSelectAccount(result);
                            }
                          },
                        }
                      : null)}
                  >
                    <Text style={styles.searchResultEmoji}>
                      {result.avatarEmoji}
                    </Text>
                    <View style={styles.searchResultInfo}>
                      <Text
                        style={[
                          styles.searchResultName,
                          { color: colors.foreground },
                        ]}
                        numberOfLines={1}
                      >
                        {result.username}
                      </Text>
                      <Text
                        style={[
                          styles.searchResultMeta,
                          { color: colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {result.email ?? result.userId}
                      </Text>
                    </View>
                    {isModerator ? (
                      <Text
                        testID={`moderation-search-result-${result.userId}-moderator-badge`}
                        style={[
                          styles.searchResultBadge,
                          { color: colors.primary },
                        ]}
                      >
                        Moderator
                      </Text>
                    ) : null}
                    {result.banned ? (
                      <Text
                        style={[
                          styles.searchResultBadge,
                          { color: colors.destructive },
                        ]}
                      >
                        Banned
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {selectedAccount ? (
            <View
              testID="moderation-selected-account"
              style={[
                styles.selectedAccount,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  borderRadius: colors.radius - 2,
                },
              ]}
            >
              <Text style={styles.searchResultEmoji}>
                {selectedAccount.avatarEmoji}
              </Text>
              <View style={styles.searchResultInfo}>
                <Text
                  style={[
                    styles.searchResultName,
                    { color: colors.foreground },
                  ]}
                  numberOfLines={1}
                >
                  Selected: {selectedAccount.username}
                </Text>
                <Text
                  style={[
                    styles.searchResultMeta,
                    { color: colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {selectedAccount.email ?? selectedAccount.userId}
                  {selectedAccount.banned ? " · Currently banned" : ""}
                </Text>
              </View>
              <TouchableOpacity
                testID="moderation-selected-account-filter-history"
                style={[
                  styles.filterHistoryChip,
                  {
                    borderColor: colors.border,
                    borderRadius: colors.radius - 4,
                  },
                ]}
                onPress={() => filterHistoryByTarget(selectedAccount.userId)}
                accessibilityRole="button"
                accessibilityLabel={`Filter moderation history by ${selectedAccount.username}`}
              >
                <Feather name="filter" size={12} color={colors.foreground} />
                <Text
                  style={[
                    styles.filterHistoryChipText,
                    { color: colors.foreground },
                  ]}
                >
                  Filter history
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            ACCOUNT USER ID
          </Text>
          <TextInput
            testID="moderation-user-id"
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
                borderRadius: colors.radius - 2,
              },
            ]}
            value={moderationUserId}
            onChangeText={handleModerationUserIdChange}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Account user ID"
            placeholderTextColor={colors.mutedForeground}
          />
          <View style={styles.moderationActions}>
            <TouchableOpacity
              testID="ban-account-button"
              style={[
                styles.moderationButton,
                {
                  backgroundColor: colors.destructive,
                  borderRadius: colors.radius - 2,
                  opacity: isModerating ? 0.6 : 1,
                },
              ]}
              onPress={() => void setBanState(true)}
              disabled={isModerating}
              accessibilityRole="button"
              accessibilityLabel="Ban account"
            >
              <Text
                style={[
                  styles.moderationButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                {isModerating ? "Updating…" : "Ban account"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="restore-account-button"
              style={[
                styles.moderationButton,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: colors.radius - 2,
                  opacity: isModerating ? 0.6 : 1,
                },
              ]}
              onPress={() => void setBanState(false)}
              disabled={isModerating}
              accessibilityRole="button"
              accessibilityLabel="Restore account"
            >
              <Text
                style={[
                  styles.moderationButtonText,
                  { color: colors.foreground },
                ]}
              >
                Restore access
              </Text>
            </TouchableOpacity>
          </View>
          {moderationFeedback ? (
            <Text
              testID="moderation-feedback"
              accessibilityRole="alert"
              style={[
                styles.moderationFeedback,
                {
                  color:
                    moderationFeedback.kind === "success"
                      ? colors.online
                      : colors.destructive,
                },
              ]}
            >
              {moderationFeedback.message}
            </Text>
          ) : null}

          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            MODERATOR ACCESS
          </Text>
          <Text
            style={[styles.moderationHint, { color: colors.mutedForeground }]}
          >
            Granting moderator access takes effect immediately, with no
            republish. Moderators set in the server configuration are listed
            here but can only be changed there.
          </Text>
          <TouchableOpacity
            testID="grant-moderator-button"
            style={[
              styles.moderationButton,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: colors.radius - 2,
                opacity: isGrantingModerator ? 0.6 : 1,
              },
            ]}
            onPress={() => void grantModeratorAccess()}
            disabled={isGrantingModerator}
            accessibilityRole="button"
            accessibilityLabel="Grant moderator access"
            accessibilityState={{ disabled: isGrantingModerator }}
          >
            <Text
              style={[
                styles.moderationButtonText,
                { color: colors.foreground },
              ]}
            >
              {isGrantingModerator ? "Updating…" : "Grant moderator access"}
            </Text>
          </TouchableOpacity>
          {moderatorFeedback ? (
            <Text
              testID="moderator-feedback"
              accessibilityRole="alert"
              style={[
                styles.moderationFeedback,
                {
                  color:
                    moderatorFeedback.kind === "success"
                      ? colors.online
                      : colors.destructive,
                },
              ]}
            >
              {moderatorFeedback.message}
            </Text>
          ) : null}
          {moderatorsError ? (
            <Text
              testID="moderator-list-error"
              accessibilityRole="alert"
              style={[styles.moderationHint, { color: colors.destructive }]}
            >
              {moderatorsError}
            </Text>
          ) : null}
          {moderators.length === 0 ? (
            <Text
              style={[styles.moderationHint, { color: colors.mutedForeground }]}
            >
              {isLoadingModerators
                ? "Loading moderators…"
                : moderatorsError
                  ? "The current moderator list is unavailable."
                  : "No moderators yet."}
            </Text>
          ) : (
            <View
              testID="moderator-list"
              style={[styles.searchResults, { borderColor: colors.border }]}
            >
              {moderators.map((moderator) => {
                const isSelf = moderator.userId === userId;
                const canRevoke = moderator.source === "granted" && !isSelf;
                return (
                  <View
                    key={moderator.userId}
                    testID={`moderator-row-${moderator.userId}`}
                    style={[
                      styles.searchResultRow,
                      { borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.searchResultInfo}>
                      <Text
                        style={[
                          styles.searchResultName,
                          { color: colors.foreground },
                        ]}
                        numberOfLines={1}
                      >
                        {moderator.username ?? moderator.userId}
                        {isSelf ? " (you)" : ""}
                      </Text>
                      <Text
                        style={[
                          styles.searchResultMeta,
                          { color: colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {moderator.source === "configured"
                          ? `Set in server configuration · ${moderator.email ?? moderator.userId}`
                          : (moderator.email ?? moderator.userId)}
                      </Text>
                    </View>
                    {canRevoke ? (
                      <TouchableOpacity
                        testID={`revoke-moderator-${moderator.userId}`}
                        style={[
                          styles.filterHistoryChip,
                          {
                            borderColor: colors.destructive,
                            borderRadius: colors.radius - 4,
                            opacity:
                              revokingModeratorId === moderator.userId
                                ? 0.6
                                : 1,
                          },
                        ]}
                        onPress={() => void revokeModeratorAccess(moderator)}
                        disabled={revokingModeratorId === moderator.userId}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove moderator access from ${moderator.username ?? moderator.userId}`}
                        accessibilityState={{
                          disabled: revokingModeratorId === moderator.userId,
                        }}
                      >
                        <Text
                          style={[
                            styles.filterHistoryChipText,
                            { color: colors.destructive },
                          ]}
                        >
                          {revokingModeratorId === moderator.userId
                            ? "Removing…"
                            : "Remove"}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <Text
                        testID={`moderator-locked-${moderator.userId}`}
                        style={[
                          styles.searchResultBadge,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {moderator.source === "configured"
                          ? "Configured"
                          : "You"}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            MODERATION HISTORY
          </Text>
          <Text
            testID="moderation-history-scope"
            style={[styles.moderationHint, { color: colors.mutedForeground }]}
          >
            Records bans, restores, and moderator access changes.
          </Text>
          <View style={styles.historyFilterRow}>
            <TextInput
              testID="moderation-history-target-filter"
              style={[
                styles.input,
                styles.historyFilterInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  borderRadius: colors.radius - 2,
                },
              ]}
              value={historyTargetFilter}
              onChangeText={setHistoryTargetFilter}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Filter by account ID"
              placeholderTextColor={colors.mutedForeground}
            />
            <TextInput
              testID="moderation-history-actor-filter"
              style={[
                styles.input,
                styles.historyFilterInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  borderRadius: colors.radius - 2,
                },
              ]}
              value={historyActorFilter}
              onChangeText={setHistoryActorFilter}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Filter by admin ID"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
          {/* Getting an administrator's id otherwise means finding a
              history row they already appear on, so the moderator list
              above doubles as a picker. Choosing a name fills the field
              with that administrator's id and re-runs the query. */}
          {moderators.length > 0 ? (
            <View
              testID="moderation-history-actor-picker-group"
              style={styles.historyActorPicker}
              onPointerDown={handleActorPickerPressStart}
              {...actorPickerKeyboardProps}
            >
              <TouchableOpacity
                ref={actorPickerToggleRef}
                testID="moderation-history-actor-picker"
                style={[
                  styles.historyActorPickerToggle,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                    borderRadius: colors.radius - 2,
                  },
                ]}
                onPress={toggleActorPicker}
                accessibilityRole="combobox"
                accessibilityLabel={`Choose an administrator to filter moderation history. Currently ${historyActorLabel}.`}
                accessibilityState={{ expanded: isActorPickerOpen }}
                // A browser reads the open state off the element itself,
                // which react-native-web does not fill in from the state
                // above.
                aria-expanded={isActorPickerOpen}
              >
                <Text
                  testID="moderation-history-actor-picker-label"
                  style={[
                    styles.historyActorPickerLabel,
                    { color: colors.foreground },
                  ]}
                  numberOfLines={1}
                >
                  {`Admin: ${historyActorLabel}`}
                </Text>
                <Feather
                  name={isActorPickerOpen ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>
              {isActorPickerOpen ? (
                <View
                  testID="moderation-history-actor-options"
                  style={[styles.searchResults, { borderColor: colors.border }]}
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Administrators to filter moderation history by"
                >
                  <TouchableOpacity
                    testID="moderation-history-actor-option-any"
                    // Where the walking keys move focus to, and where they
                    // pick up from when focus arrives by other means.
                    ref={(row) => {
                      registerActorOption("", row);
                    }}
                    onFocus={() => {
                      setFocusedActorOption("");
                    }}
                    // The list's single stop in the tab order, which the
                    // walk carries from row to row; see above.
                    {...actorOptionTabOrder("")}
                    style={[
                      styles.searchResultRow,
                      { borderColor: colors.border },
                    ]}
                    onPress={() => handlePickHistoryActor("")}
                    accessibilityRole="radio"
                    accessibilityLabel="Show moderation history from any administrator"
                    accessibilityState={{
                      selected: historyActorFilterId === "",
                    }}
                    // A browser announces a choice in a list as checked
                    // or not, from the element rather than the state above.
                    aria-checked={historyActorFilterId === ""}
                  >
                    <View style={styles.searchResultInfo}>
                      <Text
                        style={[
                          styles.searchResultName,
                          { color: colors.foreground },
                        ]}
                        numberOfLines={1}
                      >
                        Any administrator
                      </Text>
                    </View>
                    {historyActorFilterId === "" ? (
                      <Feather name="check" size={14} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                  {moderators.map((moderator) => {
                    const selected = moderator.userId === historyActorFilterId;
                    const name = moderator.username ?? moderator.userId;
                    return (
                      <TouchableOpacity
                        key={moderator.userId}
                        testID={`moderation-history-actor-option-${moderator.userId}`}
                        ref={(row) => {
                          registerActorOption(moderator.userId, row);
                        }}
                        onFocus={() => {
                          setFocusedActorOption(moderator.userId);
                        }}
                        // Stepped over by Tab in a browser unless the walk
                        // is on it; see the row above.
                        {...actorOptionTabOrder(moderator.userId)}
                        style={[
                          styles.searchResultRow,
                          { borderColor: colors.border },
                        ]}
                        onPress={() => handlePickHistoryActor(moderator.userId)}
                        accessibilityRole="radio"
                        accessibilityLabel={`Filter moderation history by admin ${name}`}
                        accessibilityState={{ selected }}
                        aria-checked={selected}
                      >
                        <View style={styles.searchResultInfo}>
                          <Text
                            style={[
                              styles.searchResultName,
                              { color: colors.foreground },
                            ]}
                            numberOfLines={1}
                          >
                            {name}
                            {moderator.userId === userId ? " (you)" : ""}
                          </Text>
                          <Text
                            style={[
                              styles.searchResultMeta,
                              { color: colors.mutedForeground },
                            ]}
                            numberOfLines={1}
                          >
                            {moderator.email ?? moderator.userId}
                          </Text>
                        </View>
                        {selected ? (
                          <Feather
                            name="check"
                            size={14}
                            color={colors.primary}
                          />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.historyFilterActions}>
            <TouchableOpacity
              testID="moderation-history-filter-apply"
              style={[
                styles.historyFilterButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius - 2,
                },
              ]}
              onPress={handleApplyHistoryFilters}
              accessibilityRole="button"
              accessibilityLabel="Apply history filters"
            >
              <Text
                style={[
                  styles.historyFilterButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                Filter
              </Text>
            </TouchableOpacity>
            {appliedHistoryFilters.targetUserId ||
            appliedHistoryFilters.actorUserId ? (
              <TouchableOpacity
                testID="moderation-history-filter-clear"
                style={[
                  styles.historyFilterButton,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: colors.radius - 2,
                  },
                ]}
                onPress={handleClearHistoryFilters}
                accessibilityRole="button"
                accessibilityLabel="Clear history filters"
              >
                <Text
                  style={[
                    styles.historyFilterButtonText,
                    { color: colors.foreground },
                  ]}
                >
                  Clear
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {/* Shown above whatever is already listed rather than in place
              of it: a failed "load more" leaves the page already read on
              screen, so the message has to sit alongside those rows. */}
          {historyError ? (
            <Text
              testID="moderation-history-error"
              accessibilityRole="alert"
              style={[styles.moderationHint, { color: colors.destructive }]}
            >
              {historyError}
            </Text>
          ) : null}
          {visibleHistoryEntries.length === 0 ? (
            historyError ? null : isLoadingHistory ? (
              <Text
                style={[
                  styles.moderationHint,
                  { color: colors.mutedForeground },
                ]}
              >
                Loading history…
              </Text>
            ) : (
              <Text
                testID="moderation-history-empty"
                style={[
                  styles.moderationHint,
                  { color: colors.mutedForeground },
                ]}
              >
                {appliedHistoryFilters.targetUserId ||
                appliedHistoryFilters.actorUserId
                  ? "No bans, restores, or moderator access changes match these filters."
                  : "No bans, restores, or moderator access changes yet."}
              </Text>
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView
      testID="profile-screen"
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      // Every press on the screen ends up here, which is what lets a press
      // anywhere outside the administrator picker close its open list.
      onPointerDown={handlePressStartOutsideActorPicker}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 14,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          Profile
        </Text>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isConnected
                ? `${colors.online}20`
                : `${colors.mutedForeground}20`,
            },
          ]}
          testID="profile-connection-status-badge"
        >
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: isConnected
                  ? colors.online
                  : colors.mutedForeground,
              },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              { color: isConnected ? colors.online : colors.mutedForeground },
            ]}
            testID="profile-connection-status-text"
          >
            {isConnected ? "Connected" : "Offline"}
          </Text>
        </View>
        {connectionError ? (
          <Text
            accessibilityRole="alert"
            style={[styles.connectionError, { color: colors.destructive }]}
          >
            {connectionError}
          </Text>
        ) : null}
      </View>

      <FlatList
        ref={historyListRef}
        // The rows are this list's items, so the id the log is looked up by
        // has to sit on the list that owns them. It stays absent until there
        // are rows, exactly as the container it replaced was.
        testID={
          visibleHistoryEntries.length > 0
            ? "moderation-history-list"
            : undefined
        }
        data={visibleHistoryEntries}
        keyExtractor={historyEntryKey}
        renderItem={renderHistoryEntry}
        ItemSeparatorComponent={renderHistorySeparator}
        ListHeaderComponent={profileContent}
        ListFooterComponent={
          visibleHistoryEntries.length > 0 ? historyListFooter : null
        }
        style={styles.content}
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
      {/* Several loaded pages put the newest entries a long scroll away, so
          they are offered directly once they leave the screen. */}
      {visibleHistoryEntries.length > 0 && isBelowNewestEntry ? (
        <TouchableOpacity
          testID="moderation-history-jump-newest"
          style={[
            styles.jumpToNewest,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius * 2,
              bottom: tabBarClearance,
            },
          ]}
          onPress={handleJumpToNewest}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Jump to the newest moderation history entries"
        >
          <Feather name="arrow-up" size={14} color={colors.primaryForeground} />
          <Text
            style={[
              styles.jumpToNewestText,
              { color: colors.primaryForeground },
            ]}
          >
            Newest
          </Text>
        </TouchableOpacity>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 28, fontWeight: "800" as const },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "600" as const },
  connectionError: { fontSize: 12, marginTop: 8, paddingHorizontal: 20 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 32, gap: 16 },
  avatarRing: {
    width: 100,
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 8,
  },
  avatarEmoji: { fontSize: 50, lineHeight: 60 },
  card: { padding: 16, borderWidth: 1, gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
  },
  emojiHint: { fontSize: 12, lineHeight: 18 },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  emojiOption: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  emojiOptionText: { fontSize: 24 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  name: { fontSize: 18, fontWeight: "600" as const },
  editRow: { flexDirection: "row", gap: 10 },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  saveBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  saved: { fontSize: 13, fontWeight: "600" as const },
  uid: {
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  accountDeletionHint: { fontSize: 12, lineHeight: 18 },
  deleteAccountButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  moderationCard: { borderWidth: 1, gap: 12 },
  moderationHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  moderationHint: { fontSize: 12, lineHeight: 18 },
  moderationActions: { flexDirection: "row", gap: 10 },
  moderationButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  moderationButtonText: {
    fontSize: 13,
    fontWeight: "700" as const,
    textAlign: "center",
  },
  moderationFeedback: {
    fontSize: 13,
    fontWeight: "600" as const,
    lineHeight: 19,
  },
  searchRow: { flexDirection: "row", gap: 10 },
  searchBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchResults: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  searchResultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchResultEmoji: { fontSize: 22 },
  searchResultInfo: { flex: 1, gap: 2 },
  searchResultName: { fontSize: 14, fontWeight: "600" as const },
  searchResultMeta: { fontSize: 12 },
  searchResultBadge: { fontSize: 11, fontWeight: "700" as const },
  filterHistoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
  },
  filterHistoryChipText: {
    fontSize: 11,
    fontWeight: "600" as const,
    textAlign: "center",
  },
  selectedAccount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderWidth: 1,
  },
  // Pieces of the moderation card's edge, drawn around the log's rows now
  // that they are the screen list's items rather than children of the card.
  moderationCardOpenBottom: {
    paddingBottom: 12,
    borderBottomWidth: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  historyRowShell: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 16,
  },
  historyRowSeparator: { height: 8, borderLeftWidth: 1, borderRightWidth: 1 },
  historyCardFooter: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  jumpToNewest: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
  },
  jumpToNewestText: { fontSize: 13, fontWeight: "700" as const },
  historyRow: { borderBottomWidth: 1, paddingBottom: 8, gap: 2 },
  historyText: { fontSize: 13, lineHeight: 19 },
  historyActorLink: {
    fontWeight: "600" as const,
    textDecorationLine: "underline" as const,
  },
  historyMeta: { fontSize: 11 },
  historyFilterRow: { flexDirection: "row", gap: 10 },
  historyFilterInput: { flex: 1, height: 40, fontSize: 14 },
  historyActorPicker: { gap: 6 },
  historyActorPickerToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  historyActorPickerLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600" as const,
  },
  historyFilterActions: { flexDirection: "row", gap: 10 },
  historyFilterButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  historyFilterButtonText: {
    fontSize: 12,
    fontWeight: "700" as const,
    textAlign: "center",
  },
  historyLoadMore: {
    minHeight: 40,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    // Stands in for the card gap the button used to inherit from the panel,
    // which no longer applies now that it sits in the list's footer.
    marginTop: 16,
  },
});

/**
 * One entry of the moderation log.
 *
 * Kept out of the screen and compared against its own props so that the
 * things the screen does around it -- re-checking this account's role every
 * few seconds, typing in a filter field, loading another page -- leave the
 * rows already on screen alone instead of rebuilding every one of them.
 */
const ModerationHistoryRow = React.memo(function ModerationHistoryRow({
  entry,
  cardColor,
  cardEdgeColor,
  borderColor,
  foregroundColor,
  mutedColor,
  linkColor,
  onFilterActor,
  onFilterTarget,
}: ModerationHistoryRowProps) {
  // Formatting a date is not free, and a log several pages deep formats one
  // per row. Held with the row, it is done once per entry instead of once
  // per entry per render.
  const timestamp = useMemo(
    () => new Date(entry.createdAt).toLocaleString(),
    [entry.createdAt],
  );
  const handleFilterActor = useCallback(
    () => onFilterActor(entry.actorUserId),
    [entry.actorUserId, onFilterActor],
  );
  const handleFilterTarget = useCallback(
    () => onFilterTarget(entry.targetUserId),
    [entry.targetUserId, onFilterTarget],
  );

  return (
    <View
      style={[
        styles.historyRowShell,
        { backgroundColor: cardColor, borderColor: cardEdgeColor },
      ]}
    >
      <View
        testID={`moderation-history-entry-${entry.id}`}
        style={[styles.historyRow, { borderColor }]}
      >
        <Text style={[styles.historyText, { color: foregroundColor }]}>
          <Text
            testID={`moderation-history-entry-${entry.id}-filter-actor`}
            onPress={handleFilterActor}
            accessibilityRole="button"
            accessibilityLabel={`Filter moderation history by admin ${entry.actorUsername}`}
            style={[styles.historyActorLink, { color: linkColor }]}
          >
            {entry.actorUsername}
          </Text>
          {historyActionPhrase(entry.action)}
          <Text
            testID={`moderation-history-entry-${entry.id}-filter-target`}
            onPress={handleFilterTarget}
            accessibilityRole="button"
            accessibilityLabel={`Filter moderation history by account ${entry.targetUsername}`}
            style={[styles.historyActorLink, { color: linkColor }]}
          >
            {entry.targetUsername}
          </Text>
        </Text>
        <Text style={[styles.historyMeta, { color: mutedColor }]}>
          {timestamp}
        </Text>
      </View>
    </View>
  );
});

/**
 * How a key walks a list of choices, or null for a key that does not.
 * The bare arrow names are what browsers predating the current key names
 * report, in the same way they report "Esc" for Escape.
 */
function actorOptionMove(key: string | undefined): ActorOptionMove | null {
  switch (key) {
    case "ArrowDown":
    case "Down":
      return "next";
    case "ArrowUp":
    case "Up":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

/**
 * Where a move lands, given the position focus is on now -- -1 while it is
 * still on the toggle rather than in the list -- and the last option's
 * position. A move past either end stays on that end: the list is what the
 * keys are for, and stepping out of it is what Tab already does.
 */
function movedActorOptionIndex(
  move: ActorOptionMove,
  current: number,
  last: number,
): number {
  switch (move) {
    case "first":
      return 0;
    case "last":
      return last;
    // Coming from the toggle, Down enters the list at the top and Up at
    // the bottom, which is the way a browser's own list of choices opens.
    case "next":
      return current < 0 ? 0 : Math.min(current + 1, last);
    default:
      return current < 0 ? last : Math.max(current - 1, 0);
  }
}
