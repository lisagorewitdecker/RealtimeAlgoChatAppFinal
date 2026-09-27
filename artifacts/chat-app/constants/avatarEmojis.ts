export const AVATAR_EMOJIS = [
  "😀",
  "😎",
  "🤓",
  "🧑‍💻",
  "👩‍💻",
  "👨‍💻",
  "🦄",
  "🐱",
  "🐶",
  "🦊",
  "🐼",
  "🐸",
  "🐙",
  "🦋",
  "🌈",
  "🔥",
  "⚡",
  "🚀",
  "🎨",
  "🎮",
  "💡",
  "🛠️",
  "🌟",
  "🍀",
] as const;

export type AvatarEmoji = (typeof AVATAR_EMOJIS)[number];

export const DEFAULT_AVATAR_EMOJI: AvatarEmoji = "🧑‍💻";

const avatarEmojiSet: ReadonlySet<string> = new Set(AVATAR_EMOJIS);

export function isAvatarEmoji(value: unknown): value is AvatarEmoji {
  return typeof value === "string" && avatarEmojiSet.has(value);
}

export function normalizeAvatarEmoji(value: unknown): AvatarEmoji {
  return isAvatarEmoji(value) ? value : DEFAULT_AVATAR_EMOJI;
}