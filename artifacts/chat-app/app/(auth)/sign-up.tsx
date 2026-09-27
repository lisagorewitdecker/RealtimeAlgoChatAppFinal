import { useOAuth } from "@clerk/expo";
import { useSignUp } from "@clerk/expo/legacy";
import * as WebBrowser from "expo-web-browser";
import { Link, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { PRODUCT_NAME } from "@/constants/branding";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useColors } from "@/hooks/useColors";

/** The room the form keeps around itself, and above the home bar below it. */
const CONTENT_PADDING = 28;

WebBrowser.maybeCompleteAuthSession();

function clerkError(error: unknown) {
  const candidate = error as { errors?: Array<{ longMessage?: string; message?: string }> };
  return candidate.errors?.[0]?.longMessage ?? candidate.errors?.[0]?.message ?? "Unable to create your account. Please try again.";
}

export default function SignUpScreen() {
  const colors = useColors();
  const { fontScale: savedFontScale } = useAccessibility();
  const { authVisualState, authFontScale } = useLocalSearchParams<{
    authVisualState?: string;
    authFontScale?: string;
  }>();
  const fontScale = __DEV__ && authFontScale === "1.4" ? 1.4 : savedFontScale;
  const fs = (base: number) => base * fontScale;
  const contentBottomPadding = useBottomClearance({ gap: CONTENT_PADDING });
  const { signUp, setActive, isLoaded } = useSignUp();
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });
  const { startOAuthFlow: startXOAuthFlow } = useOAuth({ strategy: "oauth_x" });
  const { startOAuthFlow: startAppleOAuthFlow } = useOAuth({ strategy: "oauth_apple" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Allow browser visual checks to reach this state without creating a real account.
  const [awaitingCode, setAwaitingCode] = useState(
    () => __DEV__ && authVisualState === "email-verification",
  );
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const loading = loadingAction !== null;

  const signUpWithGoogle = useCallback(async () => {
    try {
      setLoadingAction("Google"); setError("");
      const { createdSessionId, setActive: activate } = await startOAuthFlow();
      if (!createdSessionId || !activate) throw new Error("Google sign-up did not complete.");
      await activate({ session: createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }, [startOAuthFlow]);
  const signUpWithX = useCallback(async () => {
    try {
      setLoadingAction("X"); setError("");
      const { createdSessionId, setActive: activate } = await startXOAuthFlow();
      if (!createdSessionId || !activate) throw new Error("X sign-up did not complete.");
      await activate({ session: createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }, [startXOAuthFlow]);
  const signUpWithApple = useCallback(async () => {
    try {
      setLoadingAction("Apple"); setError("");
      const { createdSessionId, setActive: activate } = await startAppleOAuthFlow();
      if (!createdSessionId || !activate) throw new Error("Apple sign-up did not complete.");
      await activate({ session: createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }, [startAppleOAuthFlow]);

  async function createAccount() {
    if (loading || !isLoaded || !signUp) return;
    try {
      setLoadingAction("primary"); setError("");
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setAwaitingCode(true);
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }

  async function verifyEmail() {
    if (loading || !signUp) return;
    try {
      setLoadingAction("primary"); setError("");
      const result = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (result.status !== "complete" || !result.createdSessionId) {
        setError("Email verification is not complete yet.");
        return;
      }
      await setActive({ session: result.createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }

  const inputStyle = {
    color: colors.foreground,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: colors.radius,
    fontSize: fs(16),
    minHeight: fs(52),
    paddingVertical: fs(12),
  };
  const controlStyle = { minHeight: fs(52), paddingVertical: fs(14) };

  return (
    <ScrollView
      testID="auth-scroll-container"
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: contentBottomPadding },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={[styles.title, { color: colors.foreground, fontSize: fs(28), lineHeight: fs(36) }]}>{awaitingCode ? "Verify your email" : "Create your account"}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontSize: fs(15), lineHeight: fs(22) }]}>{awaitingCode ? "Enter the code sent to your email address." : `Join ${PRODUCT_NAME} to chat, call, and build together.`}</Text>
        {!awaitingCode ? <><TextInput style={[styles.input, inputStyle]} placeholder="Email address" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} editable={!loading} /><TextInput style={[styles.input, inputStyle]} placeholder="Password" placeholderTextColor={colors.mutedForeground} autoComplete="new-password" secureTextEntry value={password} onChangeText={setPassword} editable={!loading} /></> : <TextInput style={[styles.input, inputStyle]} placeholder="Email verification code" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" value={code} onChangeText={setCode} editable={!loading} onSubmitEditing={verifyEmail} />}
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive, fontSize: fs(13), lineHeight: fs(18) }]}>{error}</Text> : null}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={loadingAction === "primary" ? `${awaitingCode ? "Verify email" : "Create account"} in progress` : awaitingCode ? "Verify email" : "Create account"} accessibilityState={{ disabled: loading || (!awaitingCode && (!email || !password)) || (awaitingCode && !code), busy: loadingAction === "primary" }} accessibilityLiveRegion="polite" disabled={loading || (!awaitingCode && (!email || !password)) || (awaitingCode && !code)} onPress={awaitingCode ? verifyEmail : createAccount} style={[styles.button, controlStyle, { backgroundColor: colors.primary, borderRadius: colors.radius }]}>{loadingAction === "primary" ? <ButtonSpinner color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground, fontSize: fs(16), lineHeight: fs(22) }]}>{awaitingCode ? "Verify email" : "Create account"}</Text>}</TouchableOpacity>
         {!awaitingCode ? <><TouchableOpacity accessibilityRole="button" accessibilityLabel={loadingAction === "Google" ? "Continue with Google in progress" : "Continue with Google"} accessibilityState={{ disabled: loading, busy: loadingAction === "Google" }} accessibilityLiveRegion="polite" disabled={loading} onPress={signUpWithGoogle} style={[styles.oauth, controlStyle, { borderColor: colors.border, borderRadius: colors.radius }]}>{loadingAction === "Google" ? <ButtonSpinner color={colors.foreground} /> : <Text style={[styles.oauthText, { color: colors.foreground, fontSize: fs(15), lineHeight: fs(21) }]}>Continue with Google</Text>}</TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel={loadingAction === "X" ? "Continue with X in progress" : "Continue with X"} accessibilityState={{ disabled: loading, busy: loadingAction === "X" }} accessibilityLiveRegion="polite" disabled={loading} onPress={signUpWithX} style={[styles.oauth, controlStyle, { borderColor: colors.border, borderRadius: colors.radius }]}>{loadingAction === "X" ? <ButtonSpinner color={colors.foreground} /> : <Text style={[styles.oauthText, { color: colors.foreground, fontSize: fs(15), lineHeight: fs(21) }]}>Continue with X</Text>}</TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel={loadingAction === "Apple" ? "Continue with Apple in progress" : "Continue with Apple"} accessibilityState={{ disabled: loading, busy: loadingAction === "Apple" }} accessibilityLiveRegion="polite" disabled={loading} onPress={signUpWithApple} style={[styles.oauth, controlStyle, { borderColor: colors.border, borderRadius: colors.radius }]}>{loadingAction === "Apple" ? <ButtonSpinner color={colors.foreground} /> : <Text style={[styles.oauthText, { color: colors.foreground, fontSize: fs(15), lineHeight: fs(21) }]}>Continue with Apple</Text>}</TouchableOpacity></> : null}
        <Text style={[styles.linkText, { color: colors.mutedForeground, fontSize: fs(14), lineHeight: fs(20) }]}>Already have an account? <Link href={"/(auth)/sign-in" as never} style={{ color: colors.primary }}>Sign in</Link></Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, content: { flexGrow: 1, justifyContent: "center", padding: CONTENT_PADDING }, card: { gap: 14 }, title: { fontWeight: "700" }, subtitle: { marginBottom: 12 }, input: { borderWidth: 1, paddingHorizontal: 15 }, button: { width: "100%", alignItems: "center", justifyContent: "center", marginTop: 4, flexWrap: "wrap" }, buttonText: { width: "100%", fontWeight: "700", flexShrink: 1, textAlign: "center" }, oauth: { width: "100%", alignItems: "center", justifyContent: "center", borderWidth: 1, flexWrap: "wrap" }, oauthText: { width: "100%", fontWeight: "600", flexShrink: 1, textAlign: "center" }, error: { width: "100%", maxWidth: "100%", flexShrink: 1 }, linkText: { textAlign: "center", marginTop: 8 } });