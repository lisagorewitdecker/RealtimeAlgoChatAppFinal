import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MessageBubble from "@/components/MessageBubble";
import { useApp } from "@/contexts/AppContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSocket } from "@/contexts/SocketContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useColors } from "@/hooks/useColors";
import { useModeratorRoleRecheck } from "@/hooks/useModeratorRoleRecheck";

interface Message {
  id: string;
  content: string;
  userId: string;
  username: string;
  avatarEmoji?: string;
  timestamp: number;
  type: "text" | "system";
}

interface EncryptedMessage {
  id: string;
  userId: string;
  username: string;
  avatarEmoji?: string;
  timestamp: number;
  type: "text" | "system";
  ciphertext?: string;
  nonce?: string;
  systemContent?: string;
}

interface User {
  userId: string;
  username: string;
  avatarEmoji?: string;
}

function apiBaseUrl(): string {
  const domain = process.env["EXPO_PUBLIC_DOMAIN"];
  return domain ? `https://${domain}` : "http://localhost:5000";
}

export default function RoomScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // The status screens and the composer both end at the bottom edge of the
  // window, so both clear the home bar — the device's on native, the fixed web
  // one in the browser; they differ only in how much room they keep without an
  // inset.
  const statusScreenBottomPadding = useBottomClearance({ minimum: 24 });
  const composerBottomPadding = useBottomClearance({ minimum: 8, gap: 8 });
  const router = useRouter();
  const params = useLocalSearchParams<{ roomId: string; roomName?: string; create?: string }>();
  const roomId = params.roomId ?? "";
  const roomName = params.roomName ?? roomId;
  const createIfMissing = params.create === "true";

  const { userId, isAdmin, refreshAdminAccess } = useApp();
  const { getToken } = useAuth();
  const { socket } = useSocket();
  const { fontScale } = useAccessibility();
  const {
    publicKeyB64,
    loadRoomKey,
    getRoomKey,
    generateRoomKey,
    setRoomKey,
    encryptRoomKey,
    decryptRoomKeyEnvelope,
    encryptMessage,
    decryptMessage,
  } = useCrypto();
  const fs = (base: number) => base * fontScale;

  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [text, setText] = useState("");
  const [showUsers, setShowUsers] = useState(false);
  const [isRoomCreator, setIsRoomCreator] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [moderatingUserId, setModeratingUserId] = useState<string | null>(null);
  const [roomBanned, setRoomBanned] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const pendingMessagesRef = useRef<EncryptedMessage[]>([]);
  const inputRef = useRef<TextInput>(null);

  // The room's own grant belongs to whoever created it and cannot be taken
  // away while the room is open; the account-wide moderator role can be, so
  // it is read live rather than kept from the join answer. Someone who loses
  // the role inside the room loses these controls with it.
  const canModerate = isRoomCreator || isAdmin;

  // The ban controls follow the account's current moderator role: the shared
  // re-check reads it as the room comes into view and rarely while the member
  // stays in it, under the change the chat connection normally pushes down.
  useModeratorRoleRecheck();

  const handleRoomBanned = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setRoomBanned(true);
  }, []);

  const decryptTransportMessage = useCallback(
    (msg: EncryptedMessage): Message | null => {
      if (msg.type === "system") {
        return {
          id: msg.id,
          content: msg.systemContent ?? "Room update",
          userId: msg.userId,
          username: msg.username,
          avatarEmoji: msg.avatarEmoji,
          timestamp: msg.timestamp,
          type: "system",
        };
      }
      if (!msg.ciphertext || !msg.nonce) return null;
      const content = decryptMessage(msg.ciphertext, msg.nonce, roomId);
      if (content === null) return null;
      return { ...msg, content, type: "text" };
    },
    [decryptMessage, roomId],
  );

  useEffect(() => {
    if (!socket || !userId) return;

    async function onRoomJoined(data: {
      messages: EncryptedMessage[];
      users: User[];
      isRoomCreator?: boolean;
      canClose?: boolean;
      canInitializeKey?: boolean;
      roomKeyEnvelope?: {
        ciphertext: string;
        nonce: string;
        senderPublicKey: string;
      };
    }) {
      await loadRoomKey(roomId);
      let roomKey = getRoomKey(roomId);
      if (!roomKey && data.roomKeyEnvelope) {
        roomKey = decryptRoomKeyEnvelope(
          data.roomKeyEnvelope.ciphertext,
          data.roomKeyEnvelope.nonce,
          data.roomKeyEnvelope.senderPublicKey,
        );
        if (roomKey) await setRoomKey(roomId, roomKey);
      }
      if (!roomKey && data.canInitializeKey) {
        roomKey = await generateRoomKey(roomId);
        const envelope = encryptRoomKey(roomKey, publicKeyB64);
        if (envelope) {
          socket?.emit("room-key-share", {
            roomId,
            userId,
            ciphertext: envelope.ciphertextB64,
            nonce: envelope.nonceB64,
            senderPublicKey: publicKeyB64,
          });
        }
      }
      setRoomReady(true);
      setMessages(
        roomKey
          ? data.messages
              .map(decryptTransportMessage)
              .filter((message): message is Message => message !== null)
          : [],
      );
      setUsers(data.users);
      setIsRoomCreator(data.isRoomCreator === true);
      setCanClose(data.canClose === true);
    }
    function onMessage(msg: EncryptedMessage) {
      const decrypted = decryptTransportMessage(msg);
      if (!decrypted) {
        pendingMessagesRef.current.push(msg);
        return;
      }
      setMessages((prev) => [...prev, decrypted]);
    }
    function onUserJoined(data: {
      userId: string;
      username: string;
      avatarEmoji?: string;
      message: EncryptedMessage;
    }) {
      setUsers((prev) => {
        if (prev.find((u) => u.userId === data.userId)) return prev;
        return [
          ...prev,
          { userId: data.userId, username: data.username, avatarEmoji: data.avatarEmoji },
        ];
      });
      const decrypted = decryptTransportMessage(data.message);
      if (decrypted) setMessages((prev) => [...prev, decrypted]);
    }
    function onUserLeft(data: { userId: string; message: EncryptedMessage }) {
      setUsers((prev) => prev.filter((u) => u.userId !== data.userId));
      const decrypted = decryptTransportMessage(data.message);
      if (decrypted) setMessages((prev) => [...prev, decrypted]);
    }
    async function onRoomKeyEnvelope(data: {
      roomId: string;
      ciphertext: string;
      nonce: string;
      senderPublicKey: string;
    }) {
      if (data.roomId !== roomId || getRoomKey(roomId)) return;
      const roomKey = decryptRoomKeyEnvelope(
        data.ciphertext,
        data.nonce,
        data.senderPublicKey,
      );
      if (!roomKey) return;
      await setRoomKey(roomId, roomKey);
      const pending = pendingMessagesRef.current.splice(0);
      const decrypted = pending
        .map(decryptTransportMessage)
        .filter((message): message is Message => message !== null);
      if (decrypted.length) setMessages((prev) => [...prev, ...decrypted]);
    }
    function onRoomKeyNeeded(data: {
      roomId: string;
      userId: string;
      publicKey: string;
    }) {
      if (data.roomId !== roomId) return;
      const roomKey = getRoomKey(roomId);
      if (!roomKey) return;
      const envelope = encryptRoomKey(roomKey, data.publicKey);
      if (!envelope) return;
      socket?.emit("room-key-share", {
        roomId,
        userId: data.userId,
        ciphertext: envelope.ciphertextB64,
        nonce: envelope.nonceB64,
        senderPublicKey: publicKeyB64,
      });
    }
    function onKicked(data: {
      roomId: string;
      userId: string;
      banned?: boolean;
    }) {
      if (data.roomId !== roomId || data.userId !== userId) return;
      if (data.banned) {
        handleRoomBanned();
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Removed", "You have been removed from this room.", [
        { text: "OK", onPress: () => router.replace("/(tabs)" as never) },
      ]);
    }
    function onSocketError(error: { code?: string }) {
      if (error.code === "ROOM_BANNED") {
        handleRoomBanned();
      }
      if (error.code === "ROOM_CLOSED") {
        setRoomClosed(true);
      }
    }
    function onRoomBanned(data: { roomId?: string }) {
      if (data.roomId !== roomId) return;
      handleRoomBanned();
    }
    function onRoomClosed(data: { roomId?: string }) {
      if (data.roomId !== roomId) return;
      setRoomClosed(true);
    }

    socket.on("room-joined", onRoomJoined);
    socket.on("message", onMessage);
    socket.on("user-joined", onUserJoined);
    socket.on("user-left", onUserLeft);
    socket.on("kicked", onKicked);
    socket.on("error", onSocketError);
    socket.on("room-banned", onRoomBanned);
    socket.on("room-key-envelope", onRoomKeyEnvelope);
    socket.on("room-key-needed", onRoomKeyNeeded);
    socket.on("room-closed", onRoomClosed);
    socket.emit("join-room", {
      roomId,
      createIfMissing: createIfMissing !== false,
      roomName,
    });

    return () => {
      socket.off("room-joined", onRoomJoined);
      socket.off("message", onMessage);
      socket.off("user-joined", onUserJoined);
      socket.off("user-left", onUserLeft);
      socket.off("kicked", onKicked);
      socket.off("error", onSocketError);
      socket.off("room-banned", onRoomBanned);
      socket.off("room-key-envelope", onRoomKeyEnvelope);
      socket.off("room-key-needed", onRoomKeyNeeded);
      socket.off("room-closed", onRoomClosed);
      socket.emit("leave-room", { roomId });
    };
  }, [
    socket,
    userId,
    roomId,
    roomName,
    createIfMissing,
    handleRoomBanned,
    loadRoomKey,
    getRoomKey,
    generateRoomKey,
    setRoomKey,
    encryptRoomKey,
    decryptRoomKeyEnvelope,
    decryptTransportMessage,
    publicKeyB64,
    router,
  ]);

  const banUser = useCallback(
    async (target: User) => {
      setModeratingUserId(target.userId);
      try {
        const token = await getToken();
        const response = await fetch(
          `${apiBaseUrl()}/api/moderation/${encodeURIComponent(roomId)}/ban`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token ?? ""}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ userId: target.userId }),
          },
        );
        // A refusal is the first this copy of the app may hear that the
        // account's moderator role was removed: re-read it so the controls
        // go instead of staying to produce the same error again.
        if (response.status === 403) void refreshAdminAccess();
        const result = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(result?.error ?? "Unable to ban this room member.");
        }
      } catch (error) {
        Alert.alert(
          "Unable to ban member",
          error instanceof Error ? error.message : "Please try again.",
        );
      } finally {
        setModeratingUserId(null);
      }
    },
    [getToken, refreshAdminAccess, roomId],
  );

  const confirmBanUser = useCallback(
    (target: User) => {
      const message = `${target.username} will be removed and will not be able to rejoin this room.`;
      if (Platform.OS === "web") {
        if (globalThis.confirm(`Ban room member?\n\n${message}`)) {
          void banUser(target);
        }
        return;
      }
      Alert.alert(
        "Ban room member?",
        message,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Ban",
            style: "destructive",
            onPress: () => void banUser(target),
          },
        ],
      );
    },
    [banUser],
  );

  const sendMessage = useCallback(() => {
    const content = text.trim();
    if (!content || !socket) return;
    const encrypted = encryptMessage(content, roomId);
    if (!encrypted) {
      Alert.alert("Secure room unavailable", "The room key is not ready yet. Please try again.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    socket.emit("message", {
      roomId,
      ciphertext: encrypted.ciphertextB64,
      nonce: encrypted.nonceB64,
    });
    setText("");
  }, [text, socket, roomId, encryptMessage]);

  const closeRoom = useCallback(() => {
    if (!socket || !canClose) return;
    const close = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      socket.emit("close-room", { roomId });
    };
    const message = "This permanently closes the room for everyone. Encrypted history will remain stored but nobody can rejoin.";
    if (Platform.OS === "web") {
      if (globalThis.confirm(`Close room permanently?\n\n${message}`)) close();
      return;
    }
    Alert.alert("Close room permanently?", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Close room", style: "destructive", onPress: close },
    ]);
  }, [canClose, roomId, socket]);

  const openCall = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(
      `/call/${encodeURIComponent(roomId)}?roomName=${encodeURIComponent(roomName)}`
    );
  }, [router, roomId, roomName]);

  const openSandbox = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(
      `/sandbox/${encodeURIComponent(roomId)}?roomName=${encodeURIComponent(roomName)}`
    );
  }, [router, roomId, roomName]);

  const headerTop = Platform.OS === "web" ? 67 : insets.top;

  if (roomBanned) {
    return (
      <View
        testID="banned-room"
        accessibilityRole="alert"
        style={[
          styles.blockedRoot,
          {
            backgroundColor: colors.background,
            paddingTop: headerTop + 24,
            paddingBottom: statusScreenBottomPadding,
          },
        ]}
      >
        <Feather name="slash" size={40} color={colors.destructive} />
        <Text
          accessibilityRole="header"
          style={[styles.blockedTitle, { color: colors.foreground }]}
        >
          Banned from room
        </Text>
        <Text
          style={[styles.blockedDescription, { color: colors.mutedForeground }]}
        >
          A room moderator has banned you from this room.
        </Text>
        <TouchableOpacity
          testID="return-to-room-list-button"
          accessibilityRole="button"
          accessibilityLabel="Return to room list"
          onPress={() => router.replace("/(tabs)" as never)}
          style={[styles.blockedButton, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.blockedButtonText, { color: colors.primaryForeground }]}>
            Return to room list
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (roomClosed) {
    return (
      <View
        testID="closed-room"
        accessibilityRole="alert"
        style={[
          styles.blockedRoot,
          {
            backgroundColor: colors.background,
            paddingTop: headerTop + 24,
            paddingBottom: statusScreenBottomPadding,
          },
        ]}
      >
        <Feather name="lock" size={40} color={colors.destructive} />
        <Text accessibilityRole="header" style={[styles.blockedTitle, { color: colors.foreground }]}>
          Room closed
        </Text>
        <Text style={[styles.blockedDescription, { color: colors.mutedForeground }]}>
          This room was permanently closed and can no longer be joined.
        </Text>
        <TouchableOpacity
          testID="return-to-room-list-button"
          accessibilityRole="button"
          accessibilityLabel="Return to room list"
          onPress={() => router.replace("/(tabs)" as never)}
          style={[styles.blockedButton, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.blockedButtonText, { color: colors.primaryForeground }]}>
            Return to room list
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!roomReady) {
    return (
      <View
        testID="room-loading"
        accessibilityRole="progressbar"
        style={[
          styles.blockedRoot,
          {
            backgroundColor: colors.background,
            paddingTop: headerTop + 24,
            paddingBottom: statusScreenBottomPadding,
          },
        ]}
      >
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingTitle, { color: colors.foreground }]}>
          Opening room…
        </Text>
        <Text style={[styles.blockedDescription, { color: colors.mutedForeground }]}>
          Connecting securely to the conversation.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View
        testID="room-header"
        style={[
          styles.header,
          {
            paddingTop: headerTop + 10,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          testID="room-back-button"
          onPress={() => router.replace("/(tabs)" as never)}
          hitSlop={12}
          accessibilityLabel="Return to room list"
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View testID="room-header-center" style={styles.headerCenter}>
          <Text
            style={[styles.roomName, { color: colors.foreground, fontSize: fs(17) }]}
            numberOfLines={1}
          >
            {roomName}
          </Text>
          <Text
            testID="room-participant-count"
            accessibilityLabel={`${users.length} ${users.length === 1 ? "person" : "people"} in room`}
            style={[styles.userCount, { color: colors.mutedForeground, fontSize: fs(12) }]}
          >
            {users.length} {users.length === 1 ? "person" : "people"}
          </Text>
        </View>
        <View testID="room-header-actions" style={styles.headerActions}>
          <TouchableOpacity
            testID="room-users-button"
            style={[styles.iconBtn, { backgroundColor: colors.secondary }]}
            onPress={() => setShowUsers((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show room members"
          >
            <Feather name="users" size={18} color={showUsers ? colors.primary : colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            testID="room-sandbox-button"
            style={[styles.iconBtn, { backgroundColor: colors.secondary }]}
            onPress={openSandbox}
            hitSlop={8}
          >
            <Feather name="code" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          {canClose ? (
            <TouchableOpacity
              testID="room-close-button"
              style={[styles.iconBtn, { backgroundColor: `${colors.destructive}20` }]}
              onPress={closeRoom}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close room permanently"
            >
              <Feather name="x-circle" size={18} color={colors.destructive} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.primary }]}
            onPress={openCall}
            hitSlop={8}
          >
            <Feather name="video" size={18} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {showUsers && (
        <View
          style={[
            styles.userPanel,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          <Text style={[styles.userPanelTitle, { color: colors.mutedForeground, fontSize: fs(11) }]}>
            ONLINE
          </Text>
          {canModerate ? (
            <Text style={[styles.moderatorLabel, { color: colors.primary, fontSize: fs(12) }]}>
              Room moderator controls
            </Text>
          ) : null}
          {users.map((u) => (
            <View key={u.userId} style={styles.userRow}>
              <View style={[styles.userAvatar, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.userAvatarText, { fontSize: fs(15) }]}>
                  {u.avatarEmoji || u.username.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.userName, { color: colors.foreground, fontSize: fs(14) }]}>
                {u.username}
                {u.userId === userId ? " (you)" : ""}
              </Text>
              {canModerate && u.userId !== userId ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Ban ${u.username} from this room`}
                  disabled={moderatingUserId !== null}
                  onPress={() => confirmBanUser(u)}
                  style={[
                    styles.banButton,
                    {
                      backgroundColor: `${colors.destructive}20`,
                      borderColor: colors.destructive,
                    },
                  ]}
                >
                  <Text style={[styles.banButtonText, { color: colors.destructive, fontSize: fs(12) }]}>
                    {moderatingUserId === u.userId ? "Banning…" : "Ban"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={[...messages].reverse()}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MessageBubble message={item} isSelf={item.userId === userId} />
        )}
        inverted
        contentContainerStyle={[
          styles.list,
          { paddingBottom: 12 },
        ]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!!messages.length}
      />

      <View
        testID="room-composer"
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: composerBottomPadding,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            {
              backgroundColor: colors.background,
              color: colors.foreground,
              borderColor: colors.border,
              borderRadius: colors.radius * 2,
              fontSize: fs(15),
            },
          ]}
          placeholder="Message…"
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={2000}
          returnKeyType="default"
        />
        <TouchableOpacity
          testID="room-send-button"
          style={[
            styles.sendBtn,
            {
              backgroundColor: text.trim() ? colors.primary : colors.muted,
              borderRadius: 22,
            },
          ]}
          onPress={sendMessage}
          activeOpacity={0.8}
          disabled={!text.trim()}
        >
            <Feather
              name="send"
              size={18}
              color={text.trim() ? colors.primaryForeground : colors.mutedForeground}
            />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  blockedRoot: {
    flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32,
  },
  blockedTitle: {
    fontSize: 24, fontWeight: "700" as const, marginTop: 18, textAlign: "center",
  },
  blockedDescription: {
    fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 420, textAlign: "center",
  },
  loadingTitle: {
    fontSize: 24, fontWeight: "700" as const, marginTop: 18, textAlign: "center",
  },
  blockedButton: {
    borderRadius: 12, marginTop: 28, paddingHorizontal: 20, paddingVertical: 13,
    alignItems: "center", justifyContent: "center",
  },
  blockedButtonText: { fontWeight: "700" as const, textAlign: "center" },
  header: {
    flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16,
    paddingBottom: 12, borderBottomWidth: 1, gap: 12,
  },
  headerCenter: { flex: 1, minWidth: 0 },
  roomName: { fontSize: 17, fontWeight: "700" as const, flexShrink: 1, minWidth: 0 },
  userCount: { fontSize: 12, marginTop: 1 },
  headerActions: { flexDirection: "row", gap: 8, flexShrink: 0 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  userPanel: { borderBottomWidth: 1, paddingHorizontal: 20, paddingVertical: 12, gap: 6 },
  userPanelTitle: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.8, marginBottom: 4 },
  moderatorLabel: { fontSize: 12, fontWeight: "600" as const, marginBottom: 8 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  userAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarText: { fontSize: 15 },
  userName: { fontSize: 14 },
  banButton: {
    borderRadius: 8,
    borderWidth: 1,
    marginLeft: "auto",
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  banButtonText: { fontSize: 12, fontWeight: "700" as const, textAlign: "center" },
  list: { paddingTop: 8 },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 14,
    paddingTop: 10, borderTopWidth: 1, gap: 10,
  },
  input: {
    flex: 1, flexShrink: 1, minWidth: 0, minHeight: 44, maxHeight: 120, paddingHorizontal: 16,
    paddingVertical: 12, fontSize: 15, borderWidth: 1,
  },
  sendBtn: {
    width: 44, height: 44, flexShrink: 0, alignItems: "center", justifyContent: "center",
  },
});
