import { useColorScheme } from "react-native";
import colors from "@/constants/colors";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useColors } from "@/hooks/useColors";

jest.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    select: (
      specifics: Record<string, unknown>,
    ) => specifics.ios ?? specifics.native ?? specifics.default,
  },
  TurboModuleRegistry: {
    get: () => undefined,
  },
  useColorScheme: jest.fn(),
}));

jest.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.MockedFunction<
  typeof useColorScheme
>;
const mockUseAccessibility = useAccessibility as jest.MockedFunction<
  typeof useAccessibility
>;

describe("useColors", () => {
  beforeEach(() => {
    mockUseColorScheme.mockReset();
    mockUseAccessibility.mockReset();
  });

  it("returns the high-contrast palette regardless of system color scheme", () => {
    mockUseColorScheme.mockReturnValue("light");
    mockUseAccessibility.mockReturnValue({
      highContrast: true,
    } as ReturnType<typeof useAccessibility>);

    const result = useColors();

    expect(result).toEqual({ ...colors.highContrast, radius: colors.radius });
  });

  it.each([
    ["light", colors.light],
    ["dark", colors.dark],
  ] as const)(
    "keeps the %s palette unchanged when high contrast is disabled",
    (scheme, palette) => {
      mockUseColorScheme.mockReturnValue(scheme);
      mockUseAccessibility.mockReturnValue({
        highContrast: false,
      } as ReturnType<typeof useAccessibility>);

      const result = useColors();

      expect(result).toEqual({ ...palette, radius: colors.radius });
    },
  );
});