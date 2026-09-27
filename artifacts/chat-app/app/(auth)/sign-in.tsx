import { useOAuth } from "@clerk/expo";
import { useSignIn } from "@clerk/expo/legacy";
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
  return candidate.errors?.[0]?.longMessage ?? candidate.errors?.[0]?.message ?? "Unable to sign in. Please try again.";
}

type ResetStep = "signIn" | "email" | "code" | "password";

export default function SignInScreen() {
  const colors = useColors();
  const { fontScale: savedFontScale } = useAccessibility();
  const { authVisualState, authFontScale } = useLocalSearchParams<{
    authVisualState?: string;
    authFontScale?: string;
  }>();
  const fontScale = __DEV__ && authFontScale === "1.4" ? 1.4 : savedFontScale;
  const fs = (base: number) => base * fontScale;
  const contentBottomPadding = useBottomClearance({ gap: CONTENT_PADDING });
  const { signIn, setActive, isLoaded } = useSignIn();
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });
  const { startOAuthFlow: startXOAuthFlow } = useOAuth({ strategy: "oauth_x" });
  const { startOAuthFlow: startAppleOAuthFlow } = useOAuth({ strategy: "oauth_apple" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetStep, setResetStep] = useState<ResetStep>("signIn");
  const [clientTrustCode, setClientTrustCode] = useState("");
  // Allow browser visual checks to reach this state without a real Clerk session.
  const [awaitingClientTrust, setAwaitingClientTrust] = useState(
    () => __DEV__ && authVisualState === "client-trust-verification",
  );
  const [error, setError] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const loading = loadingAction !== null;

  const signInWithGoogle = useCallback(async () => {
    try {
      setLoadingAction("Google"); setError("");
      const { createdSessionId, setActive: activate } = await startOAuthFlow();
      if (!createdSessionId || !activate) throw new Error("Google sign-in did not complete.");
      await activate({ session: createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }, [startOAuthFlow]);
  const signInWithX = useCallback(async () => {
    try {
      setLoadingAction("X"); setError("");
      const { createdSessionId, setActive: activate } = await startXOAuthFlow();
      if (!createdSessionId || !activate) throw new Error("X sign-in did not complete.");
      await activate({ session: createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }, [startXOAuthFlow]);
  const signInWithApple = useCallback(async () => {
    try {
      setLoadingAction("Apple"); setError("");
      const { createdSessionId, setActive: activate } = await startAppleOAuthFlow();
      if (!createdSessionId || !activate) throw new Error("Apple sign-in did not complete.");
      await activate({ session: createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }, [startAppleOAuthFlow]);

  function clearReset() {
    setResetStep("signIn");
    setResetCode("");
    setNewPassword("");
    setClientTrustCode("");
    setAwaitingClientTrust(false);
    setError("");
  }

  function enterResetFlow() {
    setError("");
    setResetStep("email");
  }

  async function submitSignIn() {
    if (loading || !isLoaded || !signIn) return;
    try {
      setLoadingAction("primary"); setError("");
      const result = await signIn.create({ identifier: email.trim(), password });
      if (result.status === "needs_client_trust") {
        const emailFactor = result.supportedFirstFactors?.find(
          (factor) => factor.strategy === "email_code",
        );
        if (!emailFactor) {
          setError("Email verification is unavailable for this account.");
          return;
        }
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailFactor.emailAddressId,
        });
        setAwaitingClientTrust(true);
        return;
      }
      if (result.status !== "complete" || !result.createdSessionId) {
        setError("Additional verification is required to sign in.");
        return;
      }
      await setActive({ session: result.createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }

  async function verifyClientTrust() {
    if (loading || !isLoaded || !signIn || !clientTrustCode.trim()) return;
    try {
      setLoadingAction("primary"); setError("");
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code: clientTrustCode.trim(),
      });
      if (result.status !== "complete" || !result.createdSessionId) {
        setError("Account verification is not complete yet.");
        return;
      }
      await setActive({ session: result.createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }

  async function requestPasswordReset() {
    if (loading || !isLoaded || !signIn || !email.trim()) return;
    try {
      setLoadingAction("primary"); setError("");
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email.trim(),
      });
      setResetStep("code");
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }

  async function verifyResetCode() {
    if (loading || !isLoaded || !signIn || !resetCode.trim()) return;
    try {
      setLoadingAction("primary"); setError("");
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: resetCode.trim(),
      });
      if (result.status !== "needs_new_password") {
        setError("This reset code could not be verified. Please request a new code.");
        return;
      }
      setResetStep("password");
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }

  async function updatePassword() {
    if (loading || !isLoaded || !signIn || !newPassword) return;
    try {
      setLoadingAction("primary"); setError("");
      const result = await signIn.resetPassword({ password: newPassword });
      if (result.status !== "complete" || !result.createdSessionId) {
        setError("Your password could not be updated. Please try again.");
        return;
      }
      await setActive({ session: result.createdSessionId });
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setLoadingAction(null);
    }
  }

  const isAlternateFlow = awaitingClientTrust || resetStep !== "signIn";
  const title = awaitingClientTrust ? "Verify your account" : resetStep === "signIn" ? `Sign in to your ${PRODUCT_NAME} Workspace` : resetStep === "email" ? "Reset your password" : resetStep === "code" ? "Check your email" : "Create a new password";
  const subtitle = awaitingClientTrust
    ? "Enter the code sent to your email."
    : resetStep === "signIn"
    ? `Sign in to your ${PRODUCT_NAME} workspace.`
    : resetStep === "email"
      ? "Enter your account email and we'll send you a reset code."
    : resetStep === "code"
      ? `Enter the reset code sent to ${email.trim()}.`
      : `Choose a new password for your ${PRODUCT_NAME} account.`;
  const action = awaitingClientTrust ? verifyClientTrust : resetStep === "signIn" ? submitSignIn : resetStep === "email" ? requestPasswordReset : resetStep === "code" ? verifyResetCode : updatePassword;
  const actionLabel = awaitingClientTrust ? "Verify" : resetStep === "signIn" ? "Sign in" : resetStep === "email" ? "Send reset code" : resetStep === "code" ? "Verify reset code" : "Update password";
  const actionDisabled = loading || (awaitingClientTrust ? !clientTrustCode : resetStep === "signIn" ? !email || !password : resetStep === "email" ? !email : resetStep === "code" ? !resetCode : !newPassword);
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
        <Text
          accessibilityRole="header"
          {...{ role: "heading", "aria-level": 1 }}
          style={[styles.title, { color: colors.foreground, fontSize: fs(28), lineHeight: fs(36) }]}
        >
          {title}
        </Text>
        {!awaitingClientTrust && resetStep === "signIn" ? (
          <Text
            accessibilityRole="header"
            {...{ role: "heading", "aria-level": 2 }}
            style={[styles.greeting, { color: colors.foreground, fontSize: fs(20), lineHeight: fs(28) }]}
          >
            welcome back
          </Text>
        ) : null}
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontSize: fs(15), lineHeight: fs(22) }]}>{subtitle}</Text>
        {awaitingClientTrust ? (
          <TextInput style={[styles.input, inputStyle]} placeholder="6-digit code" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" value={clientTrustCode} onChangeText={setClientTrustCode} editable={!loading} onSubmitEditing={verifyClientTrust} />
        ) : resetStep === "signIn" ? (
          <>
            <TextInput style={[styles.input, inputStyle]} placeholder="Email address" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} editable={!loading} />
            <TextInput style={[styles.input, inputStyle]} placeholder="Password" placeholderTextColor={colors.mutedForeground} autoComplete="password" secureTextEntry value={password} onChangeText={setPassword} editable={!loading} onSubmitEditing={submitSignIn} />
          </>
        ) : resetStep === "email" ? (
          <TextInput style={[styles.input, inputStyle]} placeholder="Email address" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} editable={!loading} onSubmitEditing={requestPasswordReset} />
        ) : resetStep === "code" ? (
          <TextInput style={[styles.input, inputStyle]} placeholder="Reset code" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" value={resetCode} onChangeText={setResetCode} editable={!loading} onSubmitEditing={verifyResetCode} />
        ) : (
          <TextInput style={[styles.input, inputStyle]} placeholder="New password" placeholderTextColor={colors.mutedForeground} autoComplete="new-password" secureTextEntry value={newPassword} onChangeText={setNewPassword} editable={!loading} onSubmitEditing={updatePassword} />
        )}
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive, fontSize: fs(13), lineHeight: fs(18) }]}>{error}</Text> : null}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={loadingAction === "primary" ? `${actionLabel} in progress` : actionLabel} accessibilityState={{ disabled: actionDisabled, busy: loadingAction === "primary" }} accessibilityLiveRegion="polite" disabled={actionDisabled} onPress={action} style={[styles.button, controlStyle, { backgroundColor: colors.primary, borderRadius: colors.radius }]}>
          {loadingAction === "primary" ? <ButtonSpinner color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground, fontSize: fs(16), lineHeight: fs(22) }]}>{actionLabel}</Text>}
        </TouchableOpacity>
        {!isAlternateFlow ? (
          <>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Forgot password" disabled={loading} onPress={enterResetFlow} style={[styles.textButton, { minHeight: fs(28), paddingVertical: fs(4) }]}>
              <Text style={[styles.linkText, { color: colors.primary, fontSize: fs(14), lineHeight: fs(20) }]}>Forgot password?</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={loadingAction === "Google" ? "Continue with Google in progress" : "Continue with Google"} accessibilityState={{ disabled: loading, busy: loadingAction === "Google" }} accessibilityLiveRegion="polite" disabled={loading} onPress={signInWithGoogle} style={[styles.oauth, controlStyle, { borderColor: colors.border, borderRadius: colors.radius }]}>
              {loadingAction === "Google" ? <ButtonSpinner color={colors.foreground} /> : <Text style={[styles.oauthText, { color: colors.foreground, fontSize: fs(15), lineHeight: fs(21) }]}>Continue with Google</Text>}
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={loadingAction === "X" ? "Continue with X in progress" : "Continue with X"} accessibilityState={{ disabled: loading, busy: loadingAction === "X" }} accessibilityLiveRegion="polite" disabled={loading} onPress={signInWithX} style={[styles.oauth, controlStyle, { borderColor: colors.border, borderRadius: colors.radius }]}>
              {loadingAction === "X" ? <ButtonSpinner color={colors.foreground} /> : <Text style={[styles.oauthText, { color: colors.foreground, fontSize: fs(15), lineHeight: fs(21) }]}>Continue with X</Text>}
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={loadingAction === "Apple" ? "Continue with Apple in progress" : "Continue with Apple"} accessibilityState={{ disabled: loading, busy: loadingAction === "Apple" }} accessibilityLiveRegion="polite" disabled={loading} onPress={signInWithApple} style={[styles.oauth, controlStyle, { borderColor: colors.border, borderRadius: colors.radius }]}>
              {loadingAction === "Apple" ? <ButtonSpinner color={colors.foreground} /> : <Text style={[styles.oauthText, { color: colors.foreground, fontSize: fs(15), lineHeight: fs(21) }]}>Continue with Apple</Text>}
            </TouchableOpacity>
            <Text style={[styles.linkText, { color: colors.mutedForeground, fontSize: fs(14), lineHeight: fs(20) }]}>New here? <Link href={"/(auth)/sign-up" as never} style={{ color: colors.primary }}>Create an account</Link></Text>
          </>
        ) : (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to sign in" disabled={loading} onPress={clearReset} style={[styles.textButton, { minHeight: fs(28), paddingVertical: fs(4) }]}>
            <Text style={[styles.linkText, { color: colors.primary, fontSize: fs(14), lineHeight: fs(20) }]}>Back to sign in</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, content: { flexGrow: 1, justifyContent: "center", padding: CONTENT_PADDING }, card: { gap: 14 }, title: { fontWeight: "700" }, greeting: { fontWeight: "600" }, subtitle: { marginBottom: 12 }, input: { borderWidth: 1, paddingHorizontal: 15 }, button: { width: "100%", alignItems: "center", justifyContent: "center", marginTop: 4, flexWrap: "wrap" }, buttonText: { width: "100%", fontWeight: "700", flexShrink: 1, textAlign: "center" }, oauth: { width: "100%", alignItems: "center", justifyContent: "center", borderWidth: 1, flexWrap: "wrap" }, oauthText: { width: "100%", fontWeight: "600", flexShrink: 1, textAlign: "center" }, error: { width: "100%", maxWidth: "100%", flexShrink: 1 }, linkText: { textAlign: "center", marginTop: 8 }, textButton: { alignItems: "center" } });