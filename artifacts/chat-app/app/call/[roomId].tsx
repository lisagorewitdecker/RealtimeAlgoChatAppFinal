import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { hostBottomInsetScript } from "@workspace/hosted-document-inset";
import { useApp } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import { useHostedDocumentInset } from "@/hooks/useHostedDocumentInset";

export default function CallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ roomId: string; roomName?: string }>();
  const roomId = params.roomId ?? "";
  const roomName = params.roomName ?? roomId;
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const webViewRef = useRef<WebView<unknown>>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const domain = process.env["EXPO_PUBLIC_DOMAIN"];
  const base = domain ? `https://${domain}` : "http://localhost:5000";
  const url = `${base}/api/rooms/call?roomId=${encodeURIComponent(roomId)}${
    params.roomName ? `&roomName=${encodeURIComponent(params.roomName)}` : ""
  }`;

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setAuthError("You need to sign in before joining a call.");
      return;
    }

    let isMounted = true;
    getToken()
      .then((nextToken) => {
        if (!isMounted) return;
        if (nextToken) {
          setToken(nextToken);
        } else {
          setAuthError("Your signed-in session could not be verified. Please sign in again.");
        }
      })
      .catch(() => {
        if (isMounted) {
          setAuthError("Your signed-in session could not be verified. Please sign in again.");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [getToken, isLoaded, isSignedIn]);

  /**
   * The call document pads its controls by the bottom inset, but only an iOS
   * WebView reports one to it; Android's says nothing about its gesture strip,
   * so the buttons would sit inside it. This screen is on the side of that
   * boundary that knows the number, so it hands it over — through the same
   * rule the sandbox screen hands its own document, since a browser leaves a
   * hosted document just as blind.
   */
  const hostedInset = useHostedDocumentInset();
  const bottomInsetScript = hostBottomInsetScript(hostedInset);

  // The document reads the script above as it loads. Anything that moves the
  // inset afterwards — a rotation, a phone that reports its bars late — has to
  // be injected again, since the prop is only read once.
  useEffect(() => {
    webViewRef.current?.injectJavaScript(bottomInsetScript);
  }, [bottomInsetScript]);

  function onMessage(event: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "end-call") router.back();
    } catch (_) {}
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topBar,
          { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 8 },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Feather name="chevron-down" size={26} color={colors.secondaryForeground} />
        </TouchableOpacity>
        <Text style={[styles.roomName, { color: colors.foreground }]} numberOfLines={1}>
          {roomName}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {!isLoaded || (isSignedIn && !token && !authError) ? (
        <View style={[styles.loading, { backgroundColor: colors.background }]}>
          <Text style={{ color: colors.secondaryForeground }}>
            Confirming your signed-in session…
          </Text>
        </View>
      ) : authError ? (
        <View style={[styles.loading, { backgroundColor: colors.background }]}>
          <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
          <Text style={[styles.authError, { color: colors.secondaryForeground }]}>
            {authError}
          </Text>
        </View>
      ) : Platform.OS === "web" ? (
        <View style={styles.webFallback}>
          <Feather name="video-off" size={48} color={colors.mutedForeground} />
          <Text style={[styles.webFallbackTitle, { color: colors.foreground }]}>Video calls</Text>
          <Text style={[styles.webFallbackText, { color: colors.mutedForeground }]}>
            Open this app on a mobile device to use video and audio calls.
          </Text>
        </View>
      ) : (
        <WebView<unknown>
          ref={webViewRef}
          source={{
            uri: url,
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }}
          style={[styles.webview, { backgroundColor: colors.background }]}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScript={bottomInsetScript}
          onMessage={onMessage}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.loading, { backgroundColor: colors.background }]}>
              <Text style={{ color: colors.secondaryForeground }}>Joining call…</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 10,
  },
  roomName: { fontSize: 16, fontWeight: "600" as const, flex: 1, textAlign: "center" },
  webview: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  authError: { maxWidth: 280, textAlign: "center", lineHeight: 20 },
  webFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 40 },
  webFallbackTitle: { fontSize: 20, fontWeight: "700" as const },
  webFallbackText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
});
