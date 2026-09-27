import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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

/**
 * The served sandbox document, prepared for the browser that draws it in an
 * iframe.
 *
 * Two things differ from the copy a WebView loads straight from the server.
 * The markup is handed to the iframe rather than fetched from the API origin,
 * so the addresses it loads the socket client from, and connects back to,
 * have to name that origin instead of this page's. And the document is told
 * the bottom room its host measured, which in a browser is the only way it
 * can learn of any: a page inside an iframe is never told the window's
 * safe-area insets, so `env(safe-area-inset-bottom)` resolves to zero there
 * whatever the phone underneath reports.
 */
export function prepareWebSandboxHtml(
  html: string,
  apiBase: string,
  hostBottomInset: number,
): string {
  const apiOrigin = JSON.stringify(apiBase);
  const atApiOrigin = html
    .replace(
      /(<script\s+src=["'])\/api\/socket-client\.js(["'])/i,
      `$1${apiBase}/api/socket-client.js$2`,
    )
    .replace(/io\(\{path:/g, `io(${apiOrigin},{path:`);

  return withHostBottomInset(atApiOrigin, hostBottomInset);
}

/**
 * `html` with the script that hands the document `inset`, run as it loads —
 * the iframe's side of what `injectedJavaScript` does for the WebView below.
 *
 * The script goes at the end of the head, so the property is set before the
 * body is laid out and the controls are never drawn under the home bar
 * first. A document arriving without a head takes it at the end instead,
 * where it still applies, rather than losing the inset altogether.
 */
function withHostBottomInset(html: string, inset: number): string {
  const script = `<script>${hostBottomInsetScript(inset)}</script>`;
  const headEnd = html.search(/<\/head\s*>/i);

  return headEnd === -1
    ? html + script
    : html.slice(0, headEnd) + script + html.slice(headEnd);
}

const webFrameStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  border: "none",
  backgroundColor: "#fff",
};

export default function SandboxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ roomId: string; roomName?: string }>();
  const roomId = params.roomId ?? "";
  const roomName = params.roomName ?? roomId;
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const getTokenRef = React.useRef(getToken);
  const webViewRef = React.useRef<WebView>(null);
  const [token, setToken] = useState<string | null>(null);
  const [servedHtml, setServedHtml] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const domain = process.env["EXPO_PUBLIC_DOMAIN"];
  const base = domain ? `https://${domain}` : "http://localhost:5000";
  const url = `${base}/api/rooms/sandbox?roomId=${encodeURIComponent(roomId)}${
    params.roomName ? `&roomName=${encodeURIComponent(params.roomName)}` : ""
  }`;

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setAuthError("You need to sign in before opening the sandbox.");
      return;
    }

    let isMounted = true;
    getTokenRef.current()
      .then((nextToken) => {
        if (!isMounted) return;
        if (nextToken) {
          setToken(nextToken);
          if (Platform.OS === "web") {
            fetch(url, {
              headers: { Authorization: `Bearer ${nextToken}` },
            })
              .then((response) => {
                if (!response.ok) {
                  throw new Error("Unable to load the sandbox. Please try again.");
                }
                return response.text();
              })
              .then((html) => {
                if (isMounted) {
                  setServedHtml(html);
                }
              })
              .catch((cause: unknown) => {
                if (isMounted) {
                  setAuthError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to load the sandbox. Please try again.",
                  );
                }
              });
          }
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
  }, [base, isLoaded, isSignedIn, url]);

  /**
   * The sandbox document pads the assistant's buttons by the bottom inset,
   * and it cannot always see one: an Android WebView reports nothing for its
   * gesture strip, and a browser tells a page in an iframe nothing about the
   * window's insets at all. This screen is on the side of that boundary that
   * knows the number, so it hands it over — to the WebView through the script
   * below, and to the iframe through the document it is handed.
   */
  const hostedInset = useHostedDocumentInset();
  const bottomInsetScript = hostBottomInsetScript(hostedInset);

  const sandboxDocument = useMemo(
    () =>
      servedHtml === null
        ? null
        : prepareWebSandboxHtml(servedHtml, base, hostedInset),
    [base, hostedInset, servedHtml],
  );

  // The document reads the script above as it loads. Anything that moves the
  // inset afterwards — a rotation, a phone that reports its bars late — has to
  // be injected again, since the prop is only read once.
  useEffect(() => {
    webViewRef.current?.injectJavaScript(bottomInsetScript);
  }, [bottomInsetScript]);

  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 8;

  return (
    <View style={[styles.root, { backgroundColor: "#0d0d1a" }]}>
      <View style={[styles.topBar, { paddingTop: topPad, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          testID="sandbox-back-button"
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Return to room"
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.titleArea}>
          <Feather name="code" size={16} color={colors.accent} />
          <Text style={[styles.roomName, { color: colors.foreground }]} numberOfLines={1}>
            {roomName} — Sandbox
          </Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      {!isLoaded ||
      (isSignedIn && !token && !authError) ||
      (Platform.OS === "web" && isSignedIn && !servedHtml && !authError) ? (
        <View style={styles.loading}>
          <Text style={{ color: "#a5b4fc" }}>Confirming your signed-in session…</Text>
        </View>
      ) : authError ? (
        <View style={styles.loading}>
          <Feather name="alert-circle" size={32} color="#a5b4fc" />
          <Text style={styles.authError}>{authError}</Text>
        </View>
      ) : Platform.OS === "web" ? (
        React.createElement("iframe", {
          title: `${roomName} sandbox`,
          srcDoc: sandboxDocument ?? "",
          style: webFrameStyle,
        })
      ) : (
        <WebView
          ref={webViewRef}
          source={{
            uri: url,
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScript={bottomInsetScript}
          allowsInlineMediaPlayback={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.loading, { backgroundColor: "#0d0d1a" }]}>
              <Text style={{ color: "#a5b4fc" }}>Loading sandbox…</Text>
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
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12,
  },
  titleArea: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  roomName: { fontSize: 15, fontWeight: "600" as const },
  webview: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  authError: { color: "#a5b4fc", maxWidth: 280, textAlign: "center", lineHeight: 20 },
});
