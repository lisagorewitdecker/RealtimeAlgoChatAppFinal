/**
 * AccessibilityContext — stores user accessibility preferences:
 *   - highContrast: stronger color contrast for low-vision users
 *   - fontScale: multiplier for text sizes (1.0 – 1.4)
 *   - reduceMotion: disable animations / transitions
 *
 * Preferences are persisted to AsyncStorage and also respect the system's
 * reduceMotion setting (the user toggle overrides it).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo } from "react-native";

const STORAGE_KEY = "devstudio_accessibility_prefs";

type FontScale = 1.0 | 1.1 | 1.2 | 1.4;
const FONT_SCALES: readonly FontScale[] = [1.0, 1.1, 1.2, 1.4];

function isFontScale(value: unknown): value is FontScale {
  return FONT_SCALES.some((scale) => scale === value);
}

interface AccessibilityPrefs {
  highContrast: boolean;
  fontScale: FontScale;
  reduceMotion: boolean;
}

interface AccessibilityContextValue extends AccessibilityPrefs {
  setHighContrast: (v: boolean) => void;
  setFontScale: (v: FontScale) => void;
  setReduceMotion: (v: boolean) => void;
}

const defaults: AccessibilityPrefs = {
  highContrast: false,
  fontScale: 1.0,
  reduceMotion: false,
};

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(defaults);
  const hasSavedReduceMotionOverride = useRef(false);

  // Load persisted prefs and detect system reduce-motion on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: AccessibilityPrefs = { ...defaults };

      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const saved = parsed as Record<string, unknown>;
            hasSavedReduceMotionOverride.current =
              typeof saved.reduceMotion === "boolean";
            loaded = {
              highContrast:
                typeof saved.highContrast === "boolean"
                  ? saved.highContrast
                  : defaults.highContrast,
              fontScale: isFontScale(saved.fontScale)
                ? saved.fontScale
                : defaults.fontScale,
              reduceMotion:
                typeof saved.reduceMotion === "boolean"
                  ? saved.reduceMotion
                  : defaults.reduceMotion,
            };
          }
        }
      } catch {
        // use defaults
      }

      // Respect system setting if user hasn't explicitly set one
      try {
        const systemReduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
        if (systemReduceMotion && !hasSavedReduceMotionOverride.current) {
          loaded.reduceMotion = true;
        }
      } catch {
        // ignore
      }

      if (!cancelled) setPrefs(loaded);
    })();

    // Listen for system reduce-motion changes
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      if (cancelled || hasSavedReduceMotionOverride.current) return;
      setPrefs((prev) => {
        return { ...prev, reduceMotion: enabled };
      });
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const persist = useCallback((next: AccessibilityPrefs) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const setHighContrast = useCallback(
    (v: boolean) => {
      setPrefs((prev) => {
        const next = { ...prev, highContrast: v };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setFontScale = useCallback(
    (v: FontScale) => {
      setPrefs((prev) => {
        const next = { ...prev, fontScale: v };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setReduceMotion = useCallback(
    (v: boolean) => {
      hasSavedReduceMotionOverride.current = true;
      setPrefs((prev) => {
        const next = { ...prev, reduceMotion: v };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return (
    <AccessibilityContext.Provider
      value={{ ...prefs, setHighContrast, setFontScale, setReduceMotion }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error("useAccessibility must be inside AccessibilityProvider");
  return ctx;
}
