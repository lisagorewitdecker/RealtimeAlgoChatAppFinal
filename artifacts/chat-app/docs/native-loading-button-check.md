# Loading-button screen-reader check

Date: 2026-09-24

The check requested sign-in, sign-up, password reset, and AI send loading and outcome states on physical Expo clients with screen readers enabled. For each action, the requested checks were the busy button's spoken name and disabled state, focus after the request, and any separate spinner announcement.

| Platform | Screen reader | Result reported |
| --- | --- | --- |
| iPhone | VoiceOver | User reported “works.” |
| Android | TalkBack | User reported “works.” |

These are **user-reported** results, not observations made from an attached device in this workspace. The response did not provide per-action speech transcripts, focus details, or a breakdown of success and failure transitions; those details are not independently verified here. No platform-specific failure was reported, so no code change was made.