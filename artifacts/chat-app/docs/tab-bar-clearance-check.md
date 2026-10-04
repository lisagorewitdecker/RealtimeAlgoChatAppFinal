# Tab bar clearance check

How to confirm that the **last control on each tab** stays fully visible above
the classic bottom tab bar and still responds to a tap. Re-run this whenever the
tab bar height changes (`NATIVE_TAB_BAR_HEIGHT` / `WEB_TAB_BAR_HEIGHT` in
`hooks/useTabBarClearance.ts`), when a tab screen's trailing spacing changes, or
when the bottom inset moves between the bar and the footer again.

The classic bar (Android, pre-iOS-26, web) is absolutely positioned, so it
floats over the screen and each tab screen has to reserve room for it. The
liquid-glass `NativeTabs` branch handles that itself and is not covered here.

## What the numbers should be

- React Navigation 7.18.2 sizes the classic bar as `TABBAR_HEIGHT_UIKIT` (49dp)
  plus the bottom safe-area inset — but `app/(tabs)/_layout.tsx` passes
  `safeAreaInsets={{ bottom: 0 }}`, so on a device the bar is a flat **49dp**.
  The inset belongs to `components/AppFooter.tsx`, which renders below the
  navigator.
- `useTabBarClearance` reserves **64dp + the screen's own gap** (Chats +26,
  Profile +24), with no inset, matching that ownership.
- So the last control should clear the bar's top edge by roughly **15dp + the
  gap — about 41dp on Chats and 39dp on Profile**. Because neither side of that
  comparison contains the inset any more, gesture and 3-button navigation should
  give the same result. If a tab bar height change ever makes the difference
  negative, the last control gets covered.
- The bar height is a fixed constant and the reserved padding is a fixed number,
  so a larger system font scale makes the content taller without shrinking the
  gap. Check it by eye anyway: that is how the original defect was found.

`__tests__/NavigatorTabBarHeight.test.tsx` keeps the first two numbers tied
together without a phone: it mounts `app/(tabs)/_layout.tsx` in a real router
and fails if the bar React Navigation reports or paints ever grows past the
reserved clearance — whether because the library's own constant went up or
because the layout stopped handing the bottom inset to the footer. A jest run
only ever resolves and transforms one platform, so
`__tests__/NavigatorTabBarHeight.test.android.tsx` runs the same measurement
again under the `android` project in `jest.config.js`; the failure names the
platform whose bar grew. The steps below still cover what neither run can see:
real device insets, the system font scale, and whether a control is genuinely
tappable.

## How to check it on a phone

1. Open **Preview on your phone** in Replit and scan the QR code for the managed
   `artifacts/chat-app: expo` workflow.
2. **Chats tab**: scroll the room list all the way down. The last room card must
   be fully visible above the tab bar, and tapping it must open that room.
3. **Profile tab**: scroll all the way down. The last control must be fully
   visible above the bar and respond to a tap. For a normal account that is
   **Delete account**; tap it and **cancel** the confirmation — do not confirm.
   For a moderator account the moderation card is last instead, so check its
   last control too.
4. Repeat both tabs with the system font size at its largest setting
   (Android: Settings → Display → Font size; iOS: Settings → Accessibility →
   Display & Text Size → Larger Text).
5. On Android, if possible check both navigation modes (3-button and gesture).
   They no longer change the tab bar, but they do change the footer below it, so
   confirm the © line stays clear of the gesture bar as well.

## Verified in this workspace — 2026-09-26

Browser run of the same classic tab bar branch (Expo web at a 412 × 915
Pixel-sized viewport, fresh non-admin account, no safe-area inset, web bar
height 84), scrolled to maximum scroll on each tab:

| Tab     | Last control            | Tab bar top | Control bottom | Gap  | Tap                                                    |
| ------- | ----------------------- | ----------- | -------------- | ---- | ------------------------------------------------------ |
| Chats   | last room card          | 800px       | 763px          | 37px | opened that room                                       |
| Profile | `delete-account-button` | 800px       | 758px          | 42px | opened the confirm dialog (dismissed, nothing deleted) |

- `document.elementFromPoint` at each control's centre returned the control
  itself, not the tab bar.
- The footer (`app-footer`) spans 883–915px, starting exactly where the bar ends
  and overlapping neither the bar nor either last control.
- Screenshots of both tabs at maximum scroll showed clear spacing, no overlap.
- `__tests__/TabBarClearance.test.tsx`,
  `__tests__/AndroidTabBar.test.android.tsx` and `__tests__/AppFooter.test.tsx`
  pass.

The same measurements were taken before and after the change that moved the
bottom inset from the bar to the footer, and were identical — expected, since
the browser's bottom inset is 0 either way.

## Not verified in this workspace

This workspace has no Android device, emulator, or Android SDK (no `adb`, no
`/dev/kvm`), and react-native-web does not follow the OS font scale. So these
parts can only be confirmed by eye on a phone:

- a real Android navigation inset (gesture and 3-button)
- an increased system font scale
- a small pre-iOS-26 iPhone

## Reported from a device

These are **user-reported** results, not observations made from an attached
device in this workspace. No device model, navigation mode, or per-control
detail was given with either report.

| Date       | Build                                             | Reported                                                                                                |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 2026-09-26 | task branch, before the inset moved to the footer | something covered or untappable at the bottom of both tabs, at the default and at the largest font size |
| 2026-09-26 | current build (footer owns the bottom inset)      | both tabs fine: last room card and Delete account visible and responding to a tap                       |
| 2026-09-26 | current build, largest system font size           | both tabs still fine                                                                                    |

The first report was made against a preview that predated the change moving the
bottom inset from the tab bar to the app footer. On that build the © line had no
inset of its own and sat under the Android gesture/navigation bar, which is the
bottom-most thing on the screen that could look covered. The tab controls
themselves reserved more room than the bar occupied on that build as well
(inset + 64 + gap against inset + 49), so neither build explains a covered tab
control, and the first report was never reproduced or narrowed down.
