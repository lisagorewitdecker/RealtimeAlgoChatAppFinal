import { render } from "@testing-library/react-native";
import React from "react";
import { StyleSheet, type ViewStyle } from "react-native";

import { AppFooter, FOOTER_VERTICAL_PADDING } from "@/components/AppFooter";

/**
 * The footer is the bottom-most element of the app: it renders below the tab
 * navigator, so it is what covers the iOS home indicator and the Android
 * gesture bar. These tests pin that the copyright line is padded clear of that
 * strip on a device, and that a device without a bottom inset (web) keeps the
 * compact footer it always had.
 */

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({ mutedForeground: "#a5b4fc" }),
}));

function renderFooterWithBottomInset(bottom: number): ViewStyle {
  mockInsets.bottom = bottom;
  const { getByTestId } = render(<AppFooter />);

  return StyleSheet.flatten(getByTestId("app-footer").props.style) as ViewStyle;
}

describe("AppFooter", () => {
  beforeEach(() => {
    mockInsets.bottom = 0;
  });

  it("shows the JavaScript current year and copyright symbol without repeating the owner name", () => {
    const { getByText } = render(<AppFooter />);

    expect(getByText(`© ${new Date().getFullYear()}`)).toBeTruthy();
  });

  it("keeps the copyright line above the home indicator on a device with a bottom inset", () => {
    const iphoneHomeIndicatorInset = 34;

    const style = renderFooterWithBottomInset(iphoneHomeIndicatorInset);

    expect(style.paddingBottom).toBeGreaterThanOrEqual(
      iphoneHomeIndicatorInset,
    );
    expect(style.paddingTop).toBe(FOOTER_VERTICAL_PADDING);
  });

  it("clears an Android gesture bar that is taller than the iOS home indicator", () => {
    const androidNavigationBarInset = 48;

    const style = renderFooterWithBottomInset(androidNavigationBarInset);

    expect(style.paddingBottom).toBeGreaterThanOrEqual(
      androidNavigationBarInset,
    );
  });

  it("stays compact where there is no bottom inset, so web is unchanged", () => {
    const style = renderFooterWithBottomInset(0);

    expect(style.paddingBottom).toBe(FOOTER_VERTICAL_PADDING);
    expect(style.paddingTop).toBe(FOOTER_VERTICAL_PADDING);
  });
});
