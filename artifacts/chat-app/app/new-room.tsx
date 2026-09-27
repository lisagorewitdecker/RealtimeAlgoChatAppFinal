import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useColors } from "@/hooks/useColors";

export default function NewRoomScreen() {
  const colors = useColors();
  const { fontScale } = useAccessibility();
  const fs = (base: number) => base * fontScale;
  const insets = useSafeAreaInsets();
  const formBottomPadding = useBottomClearance({ gap: 24 });
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [roomName, setRoomName] = useState("");
  const [roomId, setRoomId] = useState("");
  const canSubmit = (mode === "create" ? roomName : roomId).trim().length >= 2;

  function handleSubmit() {
    if (mode === "create") {
      const name = roomName.trim();
      if (name.length < 2) return;
      const id =
        name.toLowerCase().replace(/\s+/g, "-") +
        "-" +
        Math.random().toString(36).slice(2, 6);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push(
        `/room/${encodeURIComponent(id)}?roomName=${encodeURIComponent(name)}&create=true`
      );
    } else {
      const id = roomId.trim();
      if (id.length < 2) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push(`/room/${encodeURIComponent(id)}`);
    }
  }

  return (
    <View
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.topControls,
          {
            paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 16,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
            <Feather name="arrow-left" size={fs(24)} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground, fontSize: fs(20) }]}>New Room</Text>
          <View style={{ width: fs(24) }} />
        </View>

        <View
          style={[
            styles.toggle,
            {
              backgroundColor: colors.secondary,
              borderRadius: colors.radius,
              minHeight: fs(48),
            },
          ]}
        >
          {(["create", "join"] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[
                styles.toggleOption,
                {
                  backgroundColor: mode === m ? colors.primary : "transparent",
                  borderRadius: colors.radius - 2,
                },
              ]}
              onPress={() => setMode(m)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${m === "create" ? "Create" : "Join"} room mode`}
              accessibilityState={{ selected: mode === m }}
            >
              <Text
                style={[
                  styles.toggleText,
                  {
                    color: mode === m ? colors.primaryForeground : colors.mutedForeground,
                    fontSize: fs(15),
                  },
                ]}
              >
                {m === "create" ? "Create" : "Join"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <KeyboardAwareScrollViewCompat
        testID="new-room-scroll-container"
        style={styles.formScroll}
        contentContainerStyle={[
          styles.formContent,
          { paddingBottom: formBottomPadding },
        ]}
        bottomOffset={fs(80)}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.mutedForeground, fontSize: fs(11) }]}>
            {mode === "create" ? "ROOM NAME" : "ROOM ID"}
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: colors.border,
                borderRadius: colors.radius,
                fontSize: fs(16),
                minHeight: fs(52),
              },
            ]}
            placeholder={
              mode === "create"
                ? "e.g. Design Team"
                : "e.g. design-team-a3b2"
            }
            placeholderTextColor={colors.mutedForeground}
            value={mode === "create" ? roomName : roomId}
            onChangeText={mode === "create" ? setRoomName : setRoomId}
            autoFocus
            autoCapitalize={mode === "create" ? "sentences" : "none"}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            maxLength={mode === "create" ? 40 : 80}
            accessibilityLabel={mode === "create" ? "Room name" : "Room ID"}
            testID={mode === "create" ? "room-name-input" : "room-id-input"}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.btn,
            {
              backgroundColor:
                canSubmit
                  ? colors.primary
                  : colors.muted,
              borderRadius: colors.radius,
              minHeight: fs(54),
            },
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={mode === "create" ? "Create room" : "Join room"}
          accessibilityState={{ disabled: !canSubmit }}
          testID="room-submit-button"
        >
          <Feather
            style={styles.btnIcon}
            name={mode === "create" ? "plus-circle" : "log-in"}
            size={fs(20)}
            color={
              canSubmit
                ? colors.primaryForeground
                : colors.mutedForeground
            }
          />
          <Text
            style={[
              styles.btnText,
              {
                color:
                  canSubmit
                    ? colors.primaryForeground
                    : colors.mutedForeground,
                fontSize: fs(16),
              },
            ]}
          >
            {mode === "create" ? "Create Room" : "Join Room"}
          </Text>
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topControls: { paddingHorizontal: 24, gap: 24 },
  formScroll: { flex: 1 },
  formContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, gap: 24 },
  headerRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 4,
  },
  title: { fontSize: 20, fontWeight: "700" as const },
  toggle: { flexDirection: "row", padding: 4 },
  toggleOption: {
    flex: 1, alignItems: "center", justifyContent: "center",
  },
  toggleText: { fontSize: 15, fontWeight: "700" as const, flexShrink: 1, textAlign: "center" },
  form: { gap: 10 },
  label: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.8 },
  input: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, borderWidth: 1.5 },
   btn: {
     minHeight: 54, paddingVertical: 14, position: "relative",
     alignItems: "center", justifyContent: "center", marginTop: 8, flexWrap: "wrap",
   },
   btnText: { width: "100%", fontSize: 16, fontWeight: "700" as const, flexShrink: 1, textAlign: "center" },
   btnIcon: { position: "absolute", left: 16 },
});
