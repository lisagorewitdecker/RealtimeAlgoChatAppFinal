import { Feather } from "@expo/vector-icons";
import { useSignIn } from "@clerk/expo";
import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useColors } from "@/hooks/useColors";

type ResetStep = "email" | "code" | "password";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const { fontScale } = useAccessibility();
  const fs = (base: number) => base * fontScale;
  const insets = useSafeAreaInsets();
  const contentBottomPadding = useBottomClearance({ gap: 24 });
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loadingAction, setLoadingAction] = useState<"primary" | "resend" | null>(null);
  const isLoading = fetchStatus === "fetching" || loadingAction !== null;

  async function sendResetCode() {
    if (!email.trim() || isLoading) return;
    setLoadingAction("primary");
    try {
      const identified = await signIn.create({ identifier: email.trim() });
      if (identified.error) return;
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (!sent.error) setStep("code");
    } finally {
      setLoadingAction(null);
    }
  }

  async function verifyCode() {
    if (!code.trim() || isLoading) return;
    setLoadingAction("primary");
    try {
      const verified = await signIn.resetPasswordEmailCode.verifyCode({
        code: code.trim(),
      });
      if (!verified.error && signIn.status === "needs_new_password") {
        setStep("password");
      }
    } finally {
      setLoadingAction(null);
    }
  }

  async function savePassword() {
    if (password.length < 8 || isLoading) return;
    setLoadingAction("primary");
    try {
      const result = await signIn.resetPasswordEmailCode.submitPassword({
        password,
        signOutOfOtherSessions: true,
      });
      if (result.error || signIn.status !== "complete") return;
      await signIn.finalize({
        navigate: ({ session }) => {
          if (!session?.currentTask) router.replace("/(tabs)");
        },
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function resendCode() {
    if (isLoading) return;
    setLoadingAction("resend");
    try {
      await signIn.resetPasswordEmailCode.sendCode();
    } finally {
      setLoadingAction(null);
    }
  }

  const title =
    step === "email"
      ? "Reset your password"
      : step === "code"
        ? "Check your email"
        : "Choose a new password";
  const subtitle =
    step === "email"
      ? "We’ll send a secure verification code."
      : step === "code"
        ? `Enter the code sent to ${email}.`
        : "Use at least 8 characters.";
  const fieldError =
    errors?.fields?.identifier?.message ||
    errors?.fields?.code?.message ||
    errors?.fields?.password?.message;
  const actionLabel = step === "email" ? "Send reset code" : step === "code" ? "Verify code" : "Save new password";
  const actionDisabled = isLoading || (step === "email" ? !email.trim() : step === "code" ? !code.trim() : password.length < 8);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        testID="forgot-password-content"
        style={[
          styles.inner,
          {
            paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 32,
            paddingBottom: contentBottomPadding,
          },
        ]}
      >
        <View style={styles.brandRow}>
          <View style={[styles.iconRing, { backgroundColor: colors.secondary }]}>
            <Feather name="lock" size={26} color={colors.primary} />
          </View>
          <Text style={[styles.brand, { color: colors.foreground }]}>DevStudio</Text>
        </View>

        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground, fontSize: fs(26), lineHeight: fs(32) }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontSize: fs(14), lineHeight: fs(20) }]}>
          {subtitle}
        </Text>

        <View style={styles.form}>
          {step === "email" ? (
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: fieldError ? colors.destructive : colors.border,
                  borderRadius: colors.radius,
                  fontSize: fs(16),
                  minHeight: fs(52),
                },
              ]}
              placeholder="you@example.com"
              accessibilityLabel="Email address"
              placeholderTextColor={colors.mutedForeground}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoFocus
              returnKeyType="send"
              onSubmitEditing={sendResetCode}
            />
          ) : step === "code" ? (
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: fieldError ? colors.destructive : colors.border,
                  borderRadius: colors.radius,
                  fontSize: fs(16),
                  minHeight: fs(52),
                },
              ]}
              placeholder="6-digit code"
              accessibilityLabel="Reset code"
              placeholderTextColor={colors.mutedForeground}
              value={code}
              onChangeText={setCode}
              keyboardType="numeric"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={verifyCode}
            />
          ) : (
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: fieldError ? colors.destructive : colors.border,
                  borderRadius: colors.radius,
                  fontSize: fs(16),
                  minHeight: fs(52),
                },
              ]}
              placeholder="New password"
              accessibilityLabel="New password"
              placeholderTextColor={colors.mutedForeground}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoFocus
              returnKeyType="done"
              onSubmitEditing={savePassword}
            />
          )}

          {fieldError ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive, fontSize: fs(12) }]}>
              {fieldError}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[
              styles.button,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: isLoading ? 0.65 : 1,
                minHeight: fs(54),
              },
            ]}
            onPress={
              step === "email"
                ? sendResetCode
                : step === "code"
                  ? verifyCode
                  : savePassword
            }
            disabled={actionDisabled}
            accessibilityRole="button"
            accessibilityLabel={loadingAction === "primary" ? `${actionLabel} in progress` : actionLabel}
            accessibilityState={{ disabled: actionDisabled, busy: loadingAction === "primary" }}
            accessibilityLiveRegion="polite"
            activeOpacity={0.8}
          >
            {loadingAction === "primary" ? (
              <ButtonSpinner color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground, fontSize: fs(16) }]}>
                {actionLabel}
              </Text>
            )}
          </TouchableOpacity>

          {step === "code" ? (
            <TouchableOpacity
              style={[styles.secondaryButton, { minHeight: fs(44) }]}
              accessibilityRole="button"
              accessibilityLabel={loadingAction === "resend" ? "Resend code in progress" : "Resend code"}
              accessibilityState={{ disabled: isLoading, busy: loadingAction === "resend" }}
              accessibilityLiveRegion="polite"
              disabled={isLoading}
              onPress={resendCode}
            >
              {loadingAction === "resend" ? (
                <ButtonSpinner color={colors.primary} />
              ) : (
                <Text style={[styles.link, { color: colors.primary, fontSize: fs(14) }]}>Resend code</Text>
              )}
            </TouchableOpacity>
          ) : null}

          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity style={styles.secondaryButton} accessibilityRole="button" accessibilityLabel="Back to sign in">
              <Text style={[styles.link, { color: colors.mutedForeground }]}>
                Back to sign in
              </Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: "center" },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 32,
  },
  iconRing: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 22, fontWeight: "800" as const },
  title: { fontSize: 26, fontWeight: "700" as const, marginBottom: 6 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 28 },
  form: { gap: 12 },
  input: { paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1.5 },
  error: { fontSize: 12 },
  button: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonText: { width: "100%", fontSize: 16, fontWeight: "700" as const, textAlign: "center" },
  secondaryButton: { alignItems: "center", paddingVertical: 10 },
  link: { fontSize: 14, fontWeight: "600" as const, textAlign: "center" },
});
