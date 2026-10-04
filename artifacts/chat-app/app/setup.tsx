import { Feather } from "@expo/vector-icons";
import { useClerk } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { PRODUCT_NAME } from "@/constants/branding";
import { useApp } from "@/contexts/AppContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useColors } from "@/hooks/useColors";

export default function SetupScreen() {
  const colors = useColors();
  const { fontScale } = useAccessibility();
  const fs = (base: number) => base * fontScale;
  const insets = useSafeAreaInsets();
  const contentBottomPadding = useBottomClearance({ gap: 24 });
  const { setUsername } = useApp();
  const { signOut } = useClerk();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function handleContinue() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await setUsername(trimmed);
      router.replace("/(tabs)");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save your display name. Please try again.",
      );
    }
  }

  return (
    <KeyboardAwareScrollViewCompat
      testID="setup-keyboard-scroll"
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.inner,
        { paddingTop: insets.top + 60, paddingBottom: contentBottomPadding },
      ]}
      bottomOffset={fs(62)}
      keyboardShouldPersistTaps="handled"
    >
        <View
          style={[
            styles.iconRing,
            { backgroundColor: colors.secondary, borderRadius: colors.radius * 3 },
          ]}
        >
          <Feather name="terminal" size={36} color={colors.primary} />
        </View>
        <View style={styles.brandBlock}>
          <Text style={[styles.headline, { color: colors.foreground, fontSize: fs(28) }]}>{PRODUCT_NAME}</Text>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground, fontSize: fs(14) }]}>
            Build · Call · Ship
          </Text>
        </View>

        <View style={styles.capabilities}>
          <View style={styles.capabilityRow}>
            <View style={[styles.capabilityIcon, { backgroundColor: colors.muted }]}>
              <Feather name="video" size={18} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.capabilityText, { color: colors.secondaryForeground, fontSize: fs(15) }]}>
              WebRTC video rooms with peers
            </Text>
          </View>
          <View style={styles.capabilityRow}>
            <View style={[styles.capabilityIcon, { backgroundColor: colors.muted }]}>
              <Feather name="code" size={18} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.capabilityText, { color: colors.secondaryForeground, fontSize: fs(15) }]}>
              HTML, CSS & JS playground
            </Text>
          </View>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.secondaryForeground, fontSize: fs(11) }]}>DISPLAY NAME</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: error ? colors.destructive : colors.border,
                borderRadius: colors.radius,
                fontSize: fs(16),
                minHeight: fs(52),
              },
            ]}
            placeholder="How should your team know you?"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={(t) => { setName(t); setError(""); }}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={handleContinue}
            maxLength={30}
            testID="setup-display-name-input"
          />
          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive, fontSize: fs(12), lineHeight: fs(18) }]}>{error}</Text>
          ) : null}

          <TouchableOpacity
            style={[
              styles.btn,
              {
                backgroundColor: name.trim().length >= 2 ? colors.primary : colors.muted,
                borderRadius: colors.radius,
                 minHeight: fs(54),
              },
            ]}
            onPress={handleContinue}
            activeOpacity={0.8}
            testID="setup-submit-button"
          >
            <Text
              style={[
                styles.btnText,
                {
                  color: name.trim().length >= 2 ? colors.primaryForeground : colors.mutedForeground,
                  fontSize: fs(16),
                },
              ]}
            >
              Enter workspace
            </Text>
            <Feather
              style={styles.btnIcon}
              name="arrow-right"
              size={fs(18)}
              color={name.trim().length >= 2 ? colors.primaryForeground : colors.mutedForeground}
            />
          </TouchableOpacity>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontSize: fs(12), lineHeight: fs(18) }]}>
            Choose the display name your team will see.
          </Text>
          <TouchableOpacity
            onPress={async () => {
              await signOut();
              router.replace("/(auth)/sign-in" as never);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.signOut, { color: colors.mutedForeground, fontSize: fs(13) }]}>Sign out</Text>
          </TouchableOpacity>
        </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flexGrow: 1, paddingHorizontal: 28, justifyContent: "center" },
  iconRing: {
    width: 54, height: 54, alignItems: "center",
    justifyContent: "center", alignSelf: "center", marginBottom: 16,
  },
  headline: {
    fontSize: 28, fontWeight: "700" as const, textAlign: "center",
  },
  brandBlock: { alignItems: "center", marginBottom: 28 },
  eyebrow: { fontSize: 14, marginTop: 4 },
  capabilities: { gap: 14, marginBottom: 34 },
  capabilityRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  capabilityIcon: {
    width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  capabilityText: { fontSize: 15, fontWeight: "500" as const, flex: 1, flexShrink: 1 },
  form: { gap: 10 },
  label: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.8 },
  input: {
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 16,
    borderWidth: 1.5,
  },
  error: { fontSize: 12, marginTop: 2 },
   btn: {
     minHeight: 54, paddingVertical: 14, position: "relative",
     alignItems: "center", justifyContent: "center", marginTop: 8, flexWrap: "wrap",
   },
   btnText: { width: "100%", fontSize: 16, fontWeight: "700" as const, flexShrink: 1, textAlign: "center" },
   btnIcon: { position: "absolute", right: 16 },
  hint: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8 },
  signOut: { fontSize: 13, fontWeight: "600" as const, textAlign: "center", marginTop: 10 },
});
