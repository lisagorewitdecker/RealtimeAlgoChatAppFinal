/**
 * Admin Room Manager — lists all rooms with stats and lets the admin
 * permanently close or delete them.
 * Access is derived by the server for the signed-in account.
 */
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useColors } from "@/hooks/useColors";

interface AdminRoom {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  isActive: boolean;
  memberCount: number;
  lastActivityAt: number | null;
}

const BASE = process.env["EXPO_PUBLIC_DOMAIN"]
  ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}`
  : "http://localhost:5000";

/** Shown when the request never reached a server response at all. */
const OFFLINE_MESSAGE =
  "We couldn't reach the server. Check your connection and try again.";
/** Shown when the server answered but could not return the room list. */
const SERVER_MESSAGE = "The server could not load the room list right now.";
/** Shown when the session is no longer accepted. */
const SESSION_MESSAGE =
  "Your session has expired. Sign in again to manage rooms.";
/** Shown when the account is signed in but no longer administers rooms. */
const ACCESS_MESSAGE =
  "This account no longer has admin access to the room list.";

function formatDate(ts: number | null) {
  if (!ts) return "No messages";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminRoomsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const listBottomPadding = useBottomClearance({ gap: 24 });
  const router = useRouter();
  const { getToken } = useAuth();
  const { fontScale, highContrast } = useAccessibility();
  const fs = (n: number) => n * fontScale;

  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<{ roomId: string; action: "close" | "delete" } | null>(null);
  const requestIdRef = useRef(0);
  const retryingRef = useRef(false);

  const apiFetch = useCallback(
    async (path: string, method = "GET", body?: object) => {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return res;
    },
    [getToken],
  );

  /**
   * Loads the room list. Every failure leaves a message behind instead of an
   * empty list, and any success clears it, so an outage, a revoked admin role
   * and an account with nothing to manage never look alike.
   *
   * A pull-to-refresh, the header refresh and a retry can overlap, so only the
   * newest request is allowed to write: a slow load that fails after a later
   * one succeeded must not put the error back over rooms an admin is acting on.
   */
  const loadRooms = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const isNewest = () => requestIdRef.current === requestId;
    try {
      const res = await apiFetch("rooms");
      const payload = (await res.json().catch(() => null)) as
        | { rooms?: AdminRoom[]; error?: string }
        | null;
      if (!isNewest()) return;
      if (!res.ok) {
        setLoadError(
          res.status === 401
            ? SESSION_MESSAGE
            : res.status === 403
              ? ACCESS_MESSAGE
              : typeof payload?.error === "string" && payload.error
                ? payload.error
                : SERVER_MESSAGE,
        );
        return;
      }
      if (!Array.isArray(payload?.rooms)) {
        setLoadError(SERVER_MESSAGE);
        return;
      }
      setRooms(payload.rooms);
      setLoadError(null);
    } catch {
      if (isNewest()) setLoadError(OFFLINE_MESSAGE);
    } finally {
      if (isNewest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [apiFetch]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadRooms();
  }, [loadRooms]);

  /** Retries once per tap, even if the tap lands before the busy state paints. */
  const handleRetry = useCallback(() => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    void loadRooms().finally(() => {
      retryingRef.current = false;
      setRetrying(false);
    });
  }, [loadRooms]);

  const closeRoom = useCallback(
    async (room: AdminRoom) => {
      setActionInProgress({ roomId: room.id, action: "close" });
      try {
        const res = await apiFetch(`rooms/${encodeURIComponent(room.id)}/close`, "PATCH");
        if (res.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setRooms((prev) =>
            prev.map((r) => (r.id === room.id ? { ...r, isActive: false } : r)),
          );
        }
      } finally {
        setActionInProgress(null);
      }
    },
    [apiFetch],
  );

  const deleteRoom = useCallback(
    (room: AdminRoom) => {
      const doDelete = async () => {
        setActionInProgress({ roomId: room.id, action: "delete" });
        try {
          const res = await apiFetch(`rooms/${encodeURIComponent(room.id)}`, "DELETE");
          if (res.ok) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setRooms((prev) => prev.filter((r) => r.id !== room.id));
          } else {
            Alert.alert("Error", "Failed to delete room.");
          }
        } finally {
          setActionInProgress(null);
        }
      };

      Alert.alert(
        "Delete room permanently?",
        `"${room.name}" and all its messages will be permanently removed. This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => void doDelete() },
        ],
      );
    },
    [apiFetch],
  );

  const handleRoomAction = useCallback(
    (room: AdminRoom) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const options = ["Cancel", "Close permanently", "Delete permanently"];

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: room.name,
            message: `${room.memberCount} members · Last active: ${formatDate(room.lastActivityAt)}`,
            options,
            destructiveButtonIndex: 2,
            cancelButtonIndex: 0,
          },
          (idx) => {
            if (idx === 1) {
              void closeRoom(room);
            }
            if (idx === 2) deleteRoom(room);
          },
        );
      } else {
        Alert.alert(room.name, `${room.memberCount} members · Last active: ${formatDate(room.lastActivityAt)}`, [
          { text: "Cancel", style: "cancel" },
          { text: "Close permanently", style: "destructive", onPress: () => void closeRoom(room) },
          { text: "Delete permanently", style: "destructive", onPress: () => deleteRoom(room) },
        ]);
      }
    },
    [closeRoom, deleteRoom],
  );

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const retryButton = (
    <TouchableOpacity
      style={[
        styles.retryBtn,
        {
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: retrying ? 0.6 : 1,
        },
      ]}
      onPress={handleRetry}
      disabled={retrying}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Retry loading rooms"
      accessibilityState={{ disabled: retrying, busy: retrying }}
      testID="admin-rooms-retry-button"
    >
      <Feather name="refresh-cw" size={15} color={colors.primary} />
      <Text style={[styles.retryText, { color: colors.primary, fontSize: fs(14) }]}>
        {retrying ? "Retrying…" : "Try again"}
      </Text>
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: AdminRoom }) => {
    const isBusy = actionInProgress?.roomId === item.id;
    const isInactive = !item.isActive;
    const daysSinceActivity = item.lastActivityAt
      ? Math.floor((Date.now() - item.lastActivityAt) / 86400000)
      : null;
    const isStale = daysSinceActivity !== null && daysSinceActivity > 30;

    return (
      <TouchableOpacity
        style={[
          styles.roomCard,
          {
            backgroundColor: colors.card,
            borderColor: isInactive
              ? highContrast
                ? colors.destructive
                : colors.destructive + "40"
              : isStale
              ? highContrast
                ? colors.mutedForeground
                : colors.mutedForeground + "30"
              : colors.border,
            borderRadius: colors.radius,
            opacity: isInactive && !highContrast ? 0.7 : 1,
          },
        ]}
        onPress={() => handleRoomAction(item)}
        activeOpacity={0.75}
        disabled={actionInProgress !== null}
        accessibilityLabel={isBusy ? `${actionInProgress.action === "close" ? "Closing" : "Deleting"} ${item.name} in progress` : `${item.name}. ${item.memberCount} members. Last active ${formatDate(item.lastActivityAt)}. Tap for actions.`}
        accessibilityState={{ disabled: actionInProgress !== null, busy: isBusy }}
        accessibilityLiveRegion="polite"
        accessibilityRole="button"
      >
        <View style={styles.roomCardMain}>
          <View style={styles.roomCardLeft}>
            {isInactive && (
              <View
                style={[
                  styles.inactivePill,
                  {
                    backgroundColor: highContrast
                      ? colors.muted
                      : colors.destructive + "20",
                  },
                ]}
              >
                <Text style={[styles.inactivePillText, { color: colors.destructive, fontSize: fs(10) }]}>
                  HIDDEN
                </Text>
              </View>
            )}
            {isStale && !isInactive && (
              <View
                style={[
                  styles.inactivePill,
                  {
                    backgroundColor: highContrast
                      ? colors.secondary
                      : colors.mutedForeground + "20",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.inactivePillText,
                    { color: colors.mutedForeground, fontSize: fs(10) },
                  ]}
                >
                  STALE
                </Text>
              </View>
            )}
            <Text
              style={[styles.roomName, { color: colors.foreground, fontSize: fs(15) }]}
            >
              {item.name}
            </Text>
            <Text style={[styles.roomMeta, { color: colors.mutedForeground, fontSize: fs(12) }]}>
              {item.memberCount} {item.memberCount === 1 ? "member" : "members"} ·{" "}
              {formatDate(item.lastActivityAt)}
            </Text>
            <Text
              style={[
                styles.roomId,
                {
                  color: highContrast
                    ? colors.mutedForeground
                    : colors.mutedForeground + "80",
                  fontSize: fs(10),
                },
              ]}
              numberOfLines={1}
            >
              ID: {item.id}
            </Text>
          </View>
          <View style={styles.roomCardRight}>
            {isBusy ? (
              <ButtonSpinner color={colors.primary} />
            ) : (
              <Feather name="more-vertical" size={18} color={colors.mutedForeground} />
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 10, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
        accessible
        accessibilityRole="header"
      >
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Feather name="shield" size={14} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.foreground, fontSize: fs(17) }]}>
              Room Manager
            </Text>
          </View>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontSize: fs(12) }]}>
            {loadError && rooms.length === 0
              ? "Room count unavailable"
              : `${rooms.length} room${rooms.length !== 1 ? "s" : ""} total`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onRefresh}
          hitSlop={10}
          accessibilityLabel="Refresh rooms"
          accessibilityRole="button"
        >
          <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Legend */}
      <View style={[styles.legend, { backgroundColor: colors.muted, borderBottomColor: colors.border }]}>
        <Feather name="info" size={12} color={colors.mutedForeground} />
        <Text style={[styles.legendText, { color: colors.mutedForeground, fontSize: fs(11) }]}>
          Tap a room to deactivate (hide) or delete it permanently.
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : loadError && rooms.length === 0 ? (
        <View
          style={[styles.center, { paddingBottom: listBottomPadding }]}
          testID="admin-rooms-error-state"
        >
          <Feather name="alert-circle" size={48} color={colors.destructive} />
          <Text style={[styles.errorTitle, { color: colors.foreground, fontSize: fs(18) }]}>
            Can&apos;t load rooms
          </Text>
          <Text
            style={[styles.errorText, { color: colors.mutedForeground, fontSize: fs(14) }]}
            accessibilityRole="alert"
            testID="admin-rooms-error-message"
          >
            {loadError}
          </Text>
          {retryButton}
        </View>
      ) : (
        <>
          {loadError ? (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: colors.card,
                  borderBottomColor: highContrast ? colors.destructive : colors.border,
                },
              ]}
              testID="admin-rooms-error-banner"
            >
              <Feather name="alert-circle" size={16} color={colors.destructive} />
              <Text
                style={[styles.errorBannerText, { color: colors.foreground, fontSize: fs(13) }]}
                accessibilityRole="alert"
                testID="admin-rooms-error-message"
              >
                {loadError}
              </Text>
              {retryButton}
            </View>
          ) : null}
          <FlatList
            data={rooms}
            keyExtractor={(r) => r.id}
            renderItem={renderItem}
            contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
              />
            }
            ListEmptyComponent={
              <View style={styles.center} testID="admin-rooms-empty-state">
                <Feather name="inbox" size={48} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground, fontSize: fs(14) }]}>
                  No rooms found
                </Text>
              </View>
            }
            accessibilityLabel="Room list"
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16,
    paddingBottom: 12, borderBottomWidth: 1, gap: 12,
  },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  headerTitle: { fontWeight: "700" as const },
  headerSub: { marginTop: 2 },
  legend: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1,
  },
  legendText: { flex: 1 },
  list: { padding: 16, gap: 10 },
  roomCard: { borderWidth: 1, padding: 14 },
  roomCardMain: { flexDirection: "row", alignItems: "center", gap: 12 },
  roomCardLeft: { flex: 1, gap: 3, minWidth: 0 },
  roomCardRight: { width: 24, alignItems: "center" },
  inactivePill: {
    alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, marginBottom: 2,
  },
  inactivePillText: { fontWeight: "700" as const, letterSpacing: 0.5 },
  roomName: { fontWeight: "600" as const },
  roomMeta: {},
  roomId: { fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyText: {},
  errorTitle: { fontWeight: "700" as const, marginTop: 8, textAlign: "center" },
  errorText: { textAlign: "center" },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  errorBannerText: { flex: 1 },
  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  retryText: { fontWeight: "600" as const },
});
