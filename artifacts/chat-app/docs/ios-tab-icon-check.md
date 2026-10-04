# iOS tab bar icon check

The tab bar draws SF Symbols on iOS instead of the Feather glyphs Android and
web use. Those names live in Apple's system font, so
`__tests__/FeatherIconNames.test.ts` cannot check them and
`__tests__/TabLayout.test.tsx` only pins the strings the layout passes. A
renamed or dropped symbol would leave an empty space in the tab bar with the
whole suite still green, so the symbols are checked by eye on a real iOS client
and the result is recorded here for the next SDK or iOS upgrade to be compared
against.

## What the layout asks for

`app/(tabs)/_layout.tsx` picks one of two bars at runtime through
`isLiquidGlassAvailable()` from `expo-glass-effect`. On iOS 26 and later, the
native module also checks whether the host app opts into compatibility design
(`UIDesignRequiresCompatibility`). The iOS version alone does not identify the
branch: Expo Go's host configuration may differ from a standalone release
build. Both branches have to be looked at.

| Branch | When it renders | Chats | Profile |
| --- | --- | --- | --- |
| `NativeTabLayout` (`expo-router/unstable-native-tabs`) | Liquid Glass available | `message.circle`, selected `message.circle.fill` | `person.circle`, selected `person.circle.fill` |
| `ClassicTabLayout` (`expo-symbols` `SymbolView`) | Liquid Glass unavailable | `message.circle` | `person.circle` |

The classic branch passes one symbol per tab and tints it with
`tabBarActiveTintColor` / `tabBarInactiveTintColor`, so selecting a tab there
changes the colour, not the glyph. Only the native branch swaps in the `.fill`
variants. On Android and web the same branch draws Feather `message-circle` and
`user` instead, which the offline test already covers.

All four names are in the SF Symbols catalogue that `sf-symbols-typescript`
ships (2.2.0, the version `expo-symbols` types `SymbolView` against), and they
are original SF Symbols 1.0 names, so a typo fails the typecheck. Catalogue
membership is not proof that the installed iOS renders them, which is why this
check exists.

## How to run it

1. Start the managed `artifacts/chat-app: expo` workflow, open **Preview on
   your phone** in Replit and scan the current QR code with Expo Go. Do not
   start a second Metro server.
2. Sign in and stop on a screen that shows the bottom tab bar (Chats and
   Profile).
3. For each tab, check that a glyph is drawn above the label and not an empty
   gap: a speech bubble inside a circle for Chats, a head-and-shoulders inside a
   circle for Profile.
4. Tap the other tab and look again, so both tabs are seen selected and
   unselected. On the native branch the selected glyph is solid, the unselected
   one is an outline.
5. Switch the phone between light and dark appearance (Settings → Display &
   Brightness) and repeat steps 3 and 4.
6. Repeat the whole pass on the other branch. One client only renders the
   branch its availability check selects, so the other branch has to be forced
   temporarily in `TabLayout` for the second pass and the override removed
   afterwards.
7. Record the result in the table below, with screenshots where they were
   captured.

## Results

| Date | iOS / client | Branch | Appearance | Chats | Profile |
| --- | --- | --- | --- | --- | --- |
| 2026-09-26 (user report) | iOS 26 reported (entered as “i02 26”); Expo Go version not supplied | Not identified | Dark | **Blank when unselected** (Profile selected); still blank in a temporary diagnostic with bright magenta unselected icon tint | Selected icon was visible in bright green during the diagnostic; other states not reported |
| 2026-09-26 (user report after opening this project's QR in Expo Go) | iOS 26 reported; Expo Go version not supplied | Classic (`Chats (classic check)` label observed on phone) | Light and dark; each tab selected and unselected | Visible in all four combinations | Visible in all four combinations |
| 2026-09-26 (user report with temporary iOS native-branch override) | Same reported iOS client | Native (`Chats (native check)` label observed on phone) | Light and dark; each tab selected and unselected | Visible in all four combinations | Visible in all four combinations |
| 2026-09-26 (user report, fresh QR session with **no branch override**) | iOS 26.6.1; Expo Go app-details version 1.0.0, SDK 57.0.0 (build number not supplied) | Native (`Chats (native auto check)` label observed on phone with normal availability check) | Not specified for this session | Native glass bar and icon visible | Native glass bar and icon visible |

These are **user-reported results**, not independently captured screenshots of
the tab bar. The initial blank-icon report was made before confirming that the
phone had loaded this project's current bundle. After the user opened this
project's QR code in Expo Go, both branches passed the full four-combination
check. The cause of the earlier blank icon was not established; do not treat
the diagnostic alone as proof of an SF Symbol removal or a color defect.
The temporary magenta/green overrides, branch-label markers, and native-branch
override were all removed after the checks. Normal runtime branch selection
and normal icon tint colors are restored.

The image subsequently supplied
(`attached_assets/Screenshot_2026-09-26_at_9.00.14_AM_1790427616911.png`)
shows the sign-in screen, with no tab bar, and cannot confirm any icon state.
The initial blank observation therefore remains unassigned to a rendering
branch. The later branch-identified reports above are the comparison
baseline for future SDK or iOS upgrades.

## Automatic selection on iOS 26.6.1

In the fresh Expo Go session above, the normal `isLiquidGlassAvailable()`
selection picked `NativeTabLayout`; the user saw the native glass bar with both
Chats and Profile icons. No mismatch was observed in this session, so the
selection logic was not changed. The earlier classic result was also reported
from Expo Go, but its version/build was not recorded, and the reason for the
different availability result is unknown. Do not replace the availability
check with an iOS-version-only check: the native module checks the host app's
design compatibility setting too.

This is a **user-reported Expo Go** observation, not an independently captured
device screenshot or a standalone/TestFlight release-build result. The
temporary `Chats (native auto check)` / `Chats (classic auto check)` labels
used to identify the automatic branch have been removed. For a standalone
release check, record its app build, iOS version, the automatically selected
bar, and whether both icons appear; do not assume Expo Go's host configuration
proves the same result for the standalone app.

At the time of this check, the user had only Expo Go, not a standalone or
TestFlight build on the iOS 26.6.1 phone. Production-equivalent automatic
selection therefore remains **unverified**; no production mismatch has been
established or fixed.

## Conclusion and comparison

The blank Chats icon **did not reproduce on the refreshed, branch-identified
client**. The classic pass was identified by the temporary `Chats (classic
check)` label after scanning this project's QR code; the native pass was
identified by `Chats (native check)` after forcing that branch temporarily.
In each pass, both icons were reported visible with Chats selected, with
Profile selected, in light appearance, and in dark appearance. This checks
the unselected Chats state that originally failed, as well as the selected
state and the other tab. The temporary markers and override are no longer in
the source; normal runtime branch selection remains in effect.

These are user-reported observations, not independently captured screenshots
of the tab bar. The initial dark-mode blank observation had neither a branch
marker nor confirmation of this project's current bundle. It cannot be
assigned to either tab implementation, and the later successful pass does not
prove whether the original cause was a stale bundle, a transient native
rendering issue, or something else. Expo Go's exact version was not captured
for those earlier passes, and no tab-bar screenshot was available. **No symbol, tint, or
branch-selection change is justified by this comparison.** In particular, a
blank icon with a bright diagnostic tint alone does not establish a color
fault. The temporary magenta/green overrides were removed after the checks;
normal icon tint colors are restored.

If the icon disappears again, capture a screenshot showing the tab bar, the
phone's iOS and Expo Go versions, whether Chats or Profile is selected, and
light/dark appearance. Open the current project QR in Expo Go and temporarily
mark the Chats label with a distinctive branch-specific suffix as in the
passes above. If that suffix does not appear, verify the client refresh
before drawing any conclusion about the current icon code. If it does
appear, compare the same state on both tabs and both branches before
changing a symbol or color; remove the diagnostic label and branch override
after the check.

The image subsequently supplied
(`attached_assets/Screenshot_2026-09-26_at_9.00.14_AM_1790427616911.png`)
shows the sign-in screen, with no tab bar, and cannot confirm any icon state.
The two branch-identified reports above are the comparison baseline for future
SDK or iOS upgrades.
