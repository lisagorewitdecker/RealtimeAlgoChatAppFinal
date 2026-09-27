import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import RoomCard from "@/components/RoomCard";
import { PRODUCT_NAME } from "@/constants/branding";
import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import { useTabBarClearance } from "@/hooks/useTabBarClearance";

/**
 * Gap between the last room card and the tab bar. Keeps the 90pt end-of-list
 * spacing the list has always had on native.
 */
const LIST_TRAILING_SPACING = 26;

/** Shown when the request never reached a server response at all. */
const OFFLINE_MESSAGE =
  "We couldn't reach the server. Check your connection and try again.";
/** Shown when the server answered but could not return the room list. */
const SERVER_MESSAGE = "The server could not load your rooms right now.";
/** Shown when there is no usable session to ask for the room list with. */
const SESSION_MESSAGE =
  "Your session has expired. Sign in again to see your rooms.";

interface Room {
  id: string;
  name: string;
  userCount: number;
  createdAt: number;
}

export default function ChatsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const { username } = useApp();
  const { getToken } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const getTokenRef = useRef(getToken);
  const retryingRef = useRef(false);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  /**
   * Loads the room list. Every failure leaves a message behind instead of an
   * empty list, and any success clears it. Setting the same message again is a
   * no-op for React, so a background poll that keeps failing re-states nothing.
   *
   * A pull-to-refresh or a retry can start while an earlier request is still
   * out, so only the newest request is allowed to write: a slow poll that
   * fails after a later retry succeeded must not put the error back. Only
   * requests the user asked for supersede one another — see pollRooms.
   */
  const fetchRooms = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const isNewest = () => requestIdRef.current === requestId;
    inFlightRef.current = true;
    try {
      const domain = process.env["EXPO_PUBLIC_DOMAIN"];
      const base = domain ? `https://${domain}` : "http://localhost:5000";
      const token = await getTokenRef.current();
      if (!token) {
        if (isNewest()) setLoadError(SESSION_MESSAGE);
        return;
      }
      const res = await fetch(`${base}/api/rooms`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as
        | { rooms?: Room[]; error?: string }
        | null;
      if (!isNewest()) return;
      if (!res.ok) {
        setLoadError(
          res.status === 401
            ? SESSION_MESSAGE
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
    } catch (_) {
      if (isNewest()) setLoadError(OFFLINE_MESSAGE);
    } finally {
      if (isNewest()) {
        inFlightRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  /**
   * The background poll waits its turn instead of superseding a request that
   * is still out. On a connection slower than the poll interval, restarting
   * every 8 seconds would discard each answer as it arrives and leave the
   * screen loading forever; a pull-to-refresh or a retry still overtakes,
   * because those are the user asking for an answer now.
   */
  const pollRooms = useCallback(() => {
    if (inFlightRef.current) return;
    fetchRooms();
  }, [fetchRooms]);

  useEffect(() => {
    fetchRooms();
    intervalRef.current = setInterval(pollRooms, 8000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchRooms, pollRooms]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRooms();
  }, [fetchRooms]);

  /** Retries once per tap, even if the tap lands before the busy state paints. */
  const handleRetry = useCallback(() => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    void fetchRooms().finally(() => {
      retryingRef.current = false;
      setRetrying(false);
    });
  }, [fetchRooms]);

  function handleJoin(room: Room) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/room/${room.id}?roomName=${encodeURIComponent(room.name)}`);
  }

  const topPad =
    Platform.OS === "web" ? 67 : insets.top;

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
      testID="rooms-retry-button"
    >
      <Feather name="refresh-cw" size={15} color={colors.primary} />
      <Text style={[styles.retryText, { color: colors.primary }]}>
        {retrying ? "Retrying…" : "Try again"}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
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
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {PRODUCT_NAME}
          </Text>
          <Text
            accessibilityRole="header"
            {...{ role: "heading", "aria-level": 2 }}
            style={[styles.greeting, { color: colors.foreground }]}
          >
            welcome back
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {username ? `Hi, ${username}` : "Tap + to join a room"}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.newBtn,
            { backgroundColor: colors.primary, borderRadius: colors.radius },
          ]}
          onPress={() => router.push("/new-room")}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Create or join a room"
          testID="new-room-button"
        >
          <Feather name="plus" size={22} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : loadError && rooms.length === 0 ? (
        <View style={styles.center} testID="rooms-error-state">
          <Feather name="alert-circle" size={48} color={colors.destructive} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Can&apos;t load your rooms
          </Text>
          <Text
            style={[styles.errorText, { color: colors.mutedForeground }]}
            accessibilityRole="alert"
            testID="rooms-error-message"
          >
            {loadError}
          </Text>
          {retryButton}
        </View>
      ) : rooms.length === 0 ? (
        <View style={styles.center} testID="rooms-empty-state">
          <Feather name="message-square" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No active rooms
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Create one to get started
          </Text>
        </View>
      ) : (
        <>
          {loadError ? (
            <View
              style={[
                styles.errorBanner,
                { backgroundColor: colors.card, borderBottomColor: colors.border },
              ]}
              testID="rooms-error-banner"
            >
              <Feather name="alert-circle" size={16} color={colors.destructive} />
              <Text
                style={[styles.errorBannerText, { color: colors.foreground }]}
                accessibilityRole="alert"
                testID="rooms-error-message"
              >
                {loadError}
              </Text>
              {retryButton}
            </View>
          ) : null}
          <FlatList
            data={rooms}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => (
              <RoomCard room={item} onPress={() => handleJoin(item)} />
            )}
            contentContainerStyle={{
              paddingTop: 16,
              paddingBottom: tabBarClearance + LIST_TRAILING_SPACING,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
              />
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  title: { fontSize: 28, fontWeight: "800" as const },
  greeting: { fontSize: 20, fontWeight: "600" as const, marginTop: 4 },
  subtitle: { fontSize: 13, marginTop: 2 },
  newBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700" as const, marginTop: 8 },
  emptyText: { fontSize: 14 },
  errorText: { fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1,
  },
  errorBannerText: { flex: 1, fontSize: 13 },
  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  retryText: { fontSize: 14, fontWeight: "600" as const },
});
