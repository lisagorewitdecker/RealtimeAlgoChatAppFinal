import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Text } from "react-native";
import {
  AccessibilityProvider,
  useAccessibility,
} from "../contexts/AccessibilityContext";

const STORAGE_KEY = "devstudio_accessibility_prefs";

const initialPrefs = {
  highContrast: false,
  fontScale: 1.0 as const,
  reduceMotion: false,
};

type AccessibilitySnapshot = {
  highContrast: boolean;
  fontScale: number;
  reduceMotion: boolean;
};

let snapshot: AccessibilitySnapshot | null = null;

function AccessibilityProbe() {
  const { highContrast, fontScale, reduceMotion } = useAccessibility();
  snapshot = { highContrast, fontScale, reduceMotion };
  return <Text testID="accessibility-prefs">Accessibility preferences</Text>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("AccessibilityProvider", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    snapshot = null;
    jest
      .mocked(AccessibilityInfo.isReduceMotionEnabled)
      .mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("restores saved high contrast, font scale, and reduce motion values", async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        highContrast: true,
        fontScale: 1.4,
        reduceMotion: true,
      }),
    );

    const { unmount } = render(
      <AccessibilityProvider>
        <AccessibilityProbe />
      </AccessibilityProvider>,
    );

    await waitFor(() => {
      expect(snapshot).toEqual({
        highContrast: true,
        fontScale: 1.4,
        reduceMotion: true,
      });
    });

    unmount();
  });

  it("uses defaults when saved preferences contain invalid JSON", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{"highContrast":');

    const { unmount } = render(
      <AccessibilityProvider>
        <AccessibilityProbe />
      </AccessibilityProvider>,
    );

    await waitFor(() => {
      expect(snapshot).toEqual(initialPrefs);
    });

    unmount();
  });

  it.each([false, true])(
    "renders defaults when saved preferences cannot be read and respects system reduce motion (%s)",
    async (systemReduceMotion) => {
      jest
        .spyOn(AsyncStorage, "getItem")
        .mockRejectedValueOnce(new Error("storage unavailable"));
      jest
        .mocked(AccessibilityInfo.isReduceMotionEnabled)
        .mockResolvedValue(systemReduceMotion);

      const { getByTestId, unmount } = render(
        <AccessibilityProvider>
          <AccessibilityProbe />
        </AccessibilityProvider>,
      );

      expect(getByTestId("accessibility-prefs")).toBeTruthy();
      await waitFor(() => {
        expect(snapshot).toEqual({
          ...initialPrefs,
          reduceMotion: systemReduceMotion,
        });
      });

      unmount();
    },
  );

  it.each([0, 1.3, "1.4", null])(
    "uses the default font scale for unsupported saved value %p",
    async (fontScale) => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          highContrast: true,
          fontScale,
          reduceMotion: true,
        }),
      );

      const { unmount } = render(
        <AccessibilityProvider>
          <AccessibilityProbe />
        </AccessibilityProvider>,
      );

      await waitFor(() => {
        expect(snapshot).toEqual({
          highContrast: true,
          fontScale: initialPrefs.fontScale,
          reduceMotion: true,
        });
      });

      unmount();
    },
  );

  it.each([false, true])(
    "ignores non-boolean saved preferences and respects system reduce motion (%s)",
    async (systemReduceMotion) => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          highContrast: "true",
          fontScale: 1.2,
          reduceMotion: "false",
        }),
      );
      jest
        .mocked(AccessibilityInfo.isReduceMotionEnabled)
        .mockResolvedValue(systemReduceMotion);

      const { unmount } = render(
        <AccessibilityProvider>
          <AccessibilityProbe />
        </AccessibilityProvider>,
      );

      await waitFor(() => {
        expect(snapshot).toEqual({
          highContrast: initialPrefs.highContrast,
          fontScale: 1.2,
          reduceMotion: systemReduceMotion,
        });
      });

      unmount();
    },
  );

  it("keeps an explicitly saved reduce-motion value over system changes", async () => {
    let onReduceMotionChanged: ((enabled: boolean) => void) | undefined;
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation(((event: "reduceMotionChanged", listener: (enabled: boolean) => void) => {
        onReduceMotionChanged = listener;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >;
      }) as typeof AccessibilityInfo.addEventListener);

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        highContrast: false,
        fontScale: 1.1,
        reduceMotion: false,
      }),
    );
    jest
      .mocked(AccessibilityInfo.isReduceMotionEnabled)
      .mockResolvedValue(true);

    const { unmount } = render(
      <AccessibilityProvider>
        <AccessibilityProbe />
      </AccessibilityProvider>,
    );

    await waitFor(() => {
      expect(snapshot?.reduceMotion).toBe(false);
    });

    act(() => {
      onReduceMotionChanged?.(true);
    });

    expect(snapshot?.reduceMotion).toBe(false);
    unmount();
  });

  it("follows later system reduce-motion changes when no saved override exists", async () => {
    let onReduceMotionChanged: ((enabled: boolean) => void) | undefined;
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation(((event: "reduceMotionChanged", listener: (enabled: boolean) => void) => {
        onReduceMotionChanged = listener;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >;
      }) as typeof AccessibilityInfo.addEventListener);

    const { unmount } = render(
      <AccessibilityProvider>
        <AccessibilityProbe />
      </AccessibilityProvider>,
    );

    await waitFor(() => {
      expect(snapshot?.reduceMotion).toBe(false);
    });

    act(() => {
      onReduceMotionChanged?.(true);
    });
    expect(snapshot?.reduceMotion).toBe(true);

    act(() => {
      onReduceMotionChanged?.(false);
    });
    expect(snapshot?.reduceMotion).toBe(false);
    unmount();
  });

  it("does not update state when unmounted during preference hydration", async () => {
    const storageRead = deferred<string | null>();
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockReturnValue(storageRead.promise);

    const setPrefs = jest.fn();
    jest
      .spyOn(React, "useState")
      .mockReturnValueOnce([initialPrefs, setPrefs] as never);

    const view = render(
      <AccessibilityProvider>
        <AccessibilityProbe />
      </AccessibilityProvider>,
    );
    view.unmount();

    await act(async () => {
      storageRead.resolve(JSON.stringify({ highContrast: true }));
      await storageRead.promise;
    });

    expect(setPrefs).not.toHaveBeenCalled();
  });

  it("removes the reduce-motion listener and ignores late events on unmount", () => {
    const remove = jest.fn();
    let onReduceMotionChanged: ((enabled: boolean) => void) | undefined;
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation(((event: "reduceMotionChanged", listener: (enabled: boolean) => void) => {
        onReduceMotionChanged = listener;
        return {
          remove,
        } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
      }) as typeof AccessibilityInfo.addEventListener);

    const setPrefs = jest.fn();
    jest
      .spyOn(React, "useState")
      .mockReturnValueOnce([initialPrefs, setPrefs] as never);

    const view = render(
      <AccessibilityProvider>
        <AccessibilityProbe />
      </AccessibilityProvider>,
    );
    view.unmount();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(onReduceMotionChanged).toBeDefined();

    act(() => {
      onReduceMotionChanged?.(true);
    });

    expect(setPrefs).not.toHaveBeenCalled();
  });

  it("can mount and unmount repeatedly without leaking subscriptions", async () => {
    const removers: jest.Mock[] = [];
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation((() => {
        const remove = jest.fn();
        removers.push(remove);
        return {
          remove,
        } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
      }) as typeof AccessibilityInfo.addEventListener);

    const firstView = render(
      <AccessibilityProvider>
        <AccessibilityProbe />
      </AccessibilityProvider>,
    );
    await act(async () => {});
    firstView.unmount();

    const secondView = render(
      <AccessibilityProvider>
        <AccessibilityProbe />
      </AccessibilityProvider>,
    );
    await act(async () => {});
    secondView.unmount();

    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(2);
    expect(removers).toHaveLength(2);
    for (const remove of removers) {
      expect(remove).toHaveBeenCalledTimes(1);
    }
  });
});
