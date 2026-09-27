import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkProvider, useAuth, useClerk } from "@clerk/expo";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppFooter } from "@/components/AppFooter";
import { PRODUCT_NAME } from "@/constants/branding";
import { AppProvider, useApp } from "@/contexts/AppContext";
import { CryptoProvider } from "@/contexts/CryptoContext";
import { SocketProvider } from "@/contexts/SocketContext";
import { clerkTokenCache } from "@/lib/clerkTokenCache";

if (process.env["EXPO_PUBLIC_DOMAIN"]) {
  setBaseUrl(`https://${process.env["EXPO_PUBLIC_DOMAIN"]}`);
}

SplashScreen.preventAutoHideAsync();
import { AccessibilityProvider } from "@/contexts/AccessibilityContext";

const queryClient = new QueryClient();

function RootLayoutContent() {
  const { accessStatus, isReady, username } = useApp();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const signOutPending = useRef(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    if (signOutPending.current) return;
    signOutPending.current = true;
    setIsSigningOut(true);
    setSignOutError(null);
    // Android announces the live-region change; VoiceOver needs an explicit announcement.
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility("Signing out");
    try {
      // The existing auth guard redirects once Clerk clears the session.
      await signOut();
    } catch {
      const message = "Unable to sign out. Please try again.";
      setSignOutError(message);
      signOutPending.current = false;
      setIsSigningOut(false);
      if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
    }
  }

  const router = useRouter();
  const segments = useSegments();
  const isSetupRoute = segments[0] === "setup";
  const isAuthRoute =
    (segments as readonly string[]).includes("(auth)") ||
    segments[0] === "sign-in" ||
    segments[0] === "sign-up";
  const canRender = isLoaded && (!isSignedIn || isReady);

  useEffect(() => {
    if (canRender) SplashScreen.hideAsync();
  }, [canRender]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn && !isAuthRoute) {
      router.replace("/(auth)/sign-in" as never);
    } else if (
      isSignedIn &&
      isReady &&
      accessStatus === "ready" &&
      !username &&
      !isSetupRoute
    ) {
      router.replace("/setup");
    } else if (
      isSignedIn &&
      isReady &&
      accessStatus === "ready" &&
      username &&
      (isSetupRoute || isAuthRoute)
    ) {
      router.replace("/(tabs)");
    }
  }, [
    accessStatus,
    isAuthRoute,
    isLoaded,
    isReady,
    isSetupRoute,
    isSignedIn,
    router,
    username,
  ]);

  if (!canRender) {
    return (
      <View
        accessibilityRole="progressbar"
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          backgroundColor: "#0d0d1a",
        }}
      >
        <ActivityIndicator color="#a5b4fc" />
        <Text style={{ color: "#c7d2fe", fontSize: 15 }}>
          {isLoaded ? "Preparing your DevStudio workspace…" : "Loading DevStudio…"}
        </Text>
      </View>
    );
  }
  if (!isSignedIn && !isAuthRoute) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          backgroundColor: "#0d0d1a",
        }}
      >
        <Text style={{ color: "#f8fafc", fontSize: 22, fontWeight: "700" }}>
          Sign in to continue
        </Text>
        <Text style={{ color: "#c7d2fe", textAlign: "center", lineHeight: 20 }}>
          Create an account or sign in to open {PRODUCT_NAME} rooms and sandboxes.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to sign in"
          onPress={() => router.replace("/(auth)/sign-in" as never)}
          style={{
            borderRadius: 10,
            backgroundColor: "#6366f1",
            paddingHorizontal: 18,
            paddingVertical: 11,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Go to sign in</Text>
        </Pressable>
      </View>
    );
  }
  if (isSignedIn && accessStatus !== "ready") {
    const blockedCopy =
      accessStatus === "banned"
        ? {
            title: "Account access blocked",
            description:
              `This ${PRODUCT_NAME} account has been banned. You cannot join rooms, calls, or sandboxes.`,
          }
        : {
            title: "Verify your email",
            description:
              `Verify your email address before entering the ${PRODUCT_NAME} workspace.`,
          };
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          backgroundColor: "#0d0d1a",
        }}
      >
        <Text style={{ color: "#f8fafc", fontSize: 22, fontWeight: "700" }}>
          {blockedCopy.title}
        </Text>
        <Text style={{ color: "#c7d2fe", textAlign: "center", lineHeight: 20 }}>
          {blockedCopy.description}
        </Text>
        <Pressable
          testID="blocked-sign-out"
          accessibilityRole="button"
          accessibilityLabel={isSigningOut ? "Signing out" : "Sign out"}
          accessibilityState={{ busy: isSigningOut, disabled: isSigningOut }}
          disabled={isSigningOut}
          onPress={handleSignOut}
          style={{
            borderRadius: 10,
            backgroundColor: "#6366f1",
            paddingHorizontal: 18,
            paddingVertical: 11,
          }}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: "#fff", fontWeight: "700" }}
          >
            {isSigningOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>
        {signOutError && (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={{ color: "#c7d2fe", textAlign: "center", lineHeight: 20 }}
          >
            {signOutError}
          </Text>
        )}
      </View>
    );
  }
  if (isSignedIn && !username && !isSetupRoute) {
    return (
      <View
        accessibilityRole="progressbar"
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          backgroundColor: "#0d0d1a",
        }}
      >
        <ActivityIndicator color="#a5b4fc" />
        <Text style={{ color: "#c7d2fe", fontSize: 15 }}>
          Setting up your DevStudio account…
        </Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
       <Stack.Screen name="(auth)" />
       <Stack.Screen name="setup" options={{ gestureEnabled: !!username }} />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="new-room" options={{ presentation: "modal" }} />
      {/* The room manager is a management screen like new-room and the
          sandbox: it opens over whatever the admin was looking at and is
          dismissed again, rather than being somewhere they navigate to. */}
      <Stack.Screen name="admin-rooms" options={{ presentation: "modal" }} />
      <Stack.Screen name="room/[roomId]" />
      <Stack.Screen
        name="call/[roomId]"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="sandbox/[roomId]"
        options={{ presentation: "modal" }}
      />
      {/* The screen the router pushes when an address matches none of the
          above. It sets its own title as it renders, so the stack has
          nothing to configure beyond knowing the screen is one of its own. */}
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

function RootLayoutNav() {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <RootLayoutContent />
      </View>
      <AppFooter />
    </View>
  );
}

function AuthTokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken, userId } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  return (
    <CryptoProvider key={userId ?? "signed-out"} getToken={getToken}>
      {children}
    </CryptoProvider>
  );
}

export default function RootLayout() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      // SplashScreen hidden by RootLayoutNav once app context is ready
    }
  }, [fontsLoaded, fontError]);

  if (!publishableKey) {
    throw new Error("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required.");
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={clerkTokenCache}>
      <SafeAreaProvider>
        <AccessibilityProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <AuthTokenBridge>
                <AppProvider>
                  <SocketProvider>
                    <GestureHandlerRootView style={{ flex: 1 }}>
                      <KeyboardProvider>
                        <RootLayoutNav />
                      </KeyboardProvider>
                    </GestureHandlerRootView>
                  </SocketProvider>
                </AppProvider>
              </AuthTokenBridge>
            </QueryClientProvider>
          </ErrorBoundary>
        </AccessibilityProvider>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
