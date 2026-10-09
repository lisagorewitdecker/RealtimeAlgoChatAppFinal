/**
 * CryptoContext — per-device NaCl box keypair + per-room secretbox keys.
 *
 * Device keypair: X25519 box keypair stored in SecureStore (native) or
 * localStorage (web). Public key is synced to /api/users/me on load.
 *
 * Room keys: 32-byte symmetric secretbox keys. Stored in SecureStore keyed
 * by roomId. When joining a room:
 *   - If `canInitializeKey` is true (first user), generate a fresh key and
 *     box-encrypt it to ourselves to create the initial envelope.
 *   - If `roomKeyEnvelope` is present in room-joined, decrypt it with our
 *     box private key.
 *   - When another user needs the room key (`room-key-needed`), box-encrypt
 *     it to their public key and emit `room-key-share`.
 */

import * as SecureStore from "expo-secure-store";
import * as ExpoCrypto from "expo-crypto";
import nacl from "tweetnacl";
import { decodeBase64, encodeBase64, decodeUTF8 } from "tweetnacl-util";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

nacl.setPRNG((target: Uint8Array, length: number) => {
  target.set(ExpoCrypto.getRandomBytes(length));
});

// ---------------------------------------------------------------------------
// SecureStore / localStorage abstraction
// ---------------------------------------------------------------------------

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface CryptoContextValue {
  /** Base64-encoded X25519 public key for this device */
  publicKeyB64: string;
  /** Whether the keypair has been loaded and public key synced */
  isReady: boolean;
  /** Decrypt a room key envelope (box). Returns the 32-byte key or null. */
  decryptRoomKeyEnvelope: (
    ciphertextB64: string,
    nonceB64: string,
    senderPublicKeyB64: string
  ) => Uint8Array | null;
  /** Encrypt a room key to a recipient's public key (box). */
  encryptRoomKey: (
    roomKey: Uint8Array,
    recipientPublicKeyB64: string
  ) => { ciphertextB64: string; nonceB64: string } | null;
  /** Encrypt a message with the room's secretbox key. */
  encryptMessage: (
    plaintext: string,
    roomId: string
  ) => { ciphertextB64: string; nonceB64: string } | null;
  /** Decrypt a message with the room's secretbox key. */
  decryptMessage: (
    ciphertextB64: string,
    nonceB64: string,
    roomId: string
  ) => string | null;
  /** Encrypt arbitrary bytes with the room secretbox key. */
  encryptBytes: (
    data: Uint8Array,
    roomId: string
  ) => { ciphertextB64: string; nonceB64: string } | null;
  /** Decrypt arbitrary bytes with the room secretbox key. */
  decryptBytes: (
    ciphertextB64: string,
    nonceB64: string,
    roomId: string
  ) => Uint8Array | null;
  /** Store the room key for a room (called after decrypting an envelope or generating). */
  setRoomKey: (roomId: string, key: Uint8Array) => Promise<void>;
  /** Get the room key for a room if available. */
  getRoomKey: (roomId: string) => Uint8Array | null;
  /** Generate a fresh 32-byte room key and store it. */
  generateRoomKey: (roomId: string) => Promise<Uint8Array>;
  /** Restore a previously saved room key from this device. */
  loadRoomKey: (roomId: string) => Promise<void>;
  /** In-memory map of roomId -> room key */
  roomKeys: Map<string, Uint8Array>;
  /** Remove this device's account-bound encryption material. */
  clearLocalKeys: () => Promise<void>;
}

const CryptoContext = createContext<CryptoContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEVICE_KEYPAIR_KEY = "devstudio_device_keypair_v1";
const ROOM_KEY_INDEX_KEY = "devstudio_roomkey_index_v1";

export function CryptoProvider({
  children,
  getToken,
}: {
  children: React.ReactNode;
  getToken: (() => Promise<string | null>) | null;
}) {
  const [keypair, setKeypair] = useState<nacl.BoxKeyPair | null>(null);
  const [isReady, setIsReady] = useState(false);
  const roomKeysRef = useRef<Map<string, Uint8Array>>(new Map());
  const [roomKeysVersion, setRoomKeysVersion] = useState(0);

  // Load or generate device keypair
  useEffect(() => {
    (async () => {
      try {
        const stored = await secureGet(DEVICE_KEYPAIR_KEY);
        let kp: nacl.BoxKeyPair;
        if (stored) {
          const { secretKey } = JSON.parse(stored);
          const sk = decodeBase64(secretKey);
          kp = nacl.box.keyPair.fromSecretKey(sk);
        } else {
          kp = nacl.box.keyPair();
          await secureSet(
            DEVICE_KEYPAIR_KEY,
            JSON.stringify({ secretKey: encodeBase64(kp.secretKey) })
          );
        }
        setKeypair(kp);
      } catch (e) {
        console.warn("[Crypto] Failed to load keypair, generating fresh:", e);
        try {
          const kp = nacl.box.keyPair();
          await secureSet(
            DEVICE_KEYPAIR_KEY,
            JSON.stringify({ secretKey: encodeBase64(kp.secretKey) })
          );
          setKeypair(kp);
        } catch (storageError) {
          console.error("[Crypto] Unable to persist device keypair:", storageError);
        }
      }
    })();
  }, []);

  // Once keypair is ready, sync public key to server
  useEffect(() => {
    if (!keypair) return;
    (async () => {
      try {
        const token = getToken ? await getToken() : null;
        if (!token) {
          setIsReady(true);
          return;
        }
        const domain = process.env["EXPO_PUBLIC_DOMAIN"];
        const base = domain ? `https://${domain}` : "http://localhost:5000";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        headers["Authorization"] = `Bearer ${token}`;
        const response = await fetch(`${base}/api/profile`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            publicKey: encodeBase64(keypair.publicKey),
          }),
        });
        if (!response.ok) {
          throw new Error(`Public key sync failed (${response.status})`);
        }
      } catch (e) {
        console.warn("[Crypto] Failed to sync public key:", e);
      }
      setIsReady(true);
    })();
  }, [keypair, getToken]);

  const publicKeyB64 = keypair ? encodeBase64(keypair.publicKey) : "";

  const decryptRoomKeyEnvelope = useCallback(
    (
      ciphertextB64: string,
      nonceB64: string,
      senderPublicKeyB64: string
    ): Uint8Array | null => {
      if (!keypair) return null;
      try {
        const ciphertext = decodeBase64(ciphertextB64);
        const nonce = decodeBase64(nonceB64);
        const senderPubKey = decodeBase64(senderPublicKeyB64);
        const decrypted = nacl.box.open(
          ciphertext,
          nonce,
          senderPubKey,
          keypair.secretKey
        );
        return decrypted;
      } catch {
        return null;
      }
    },
    [keypair]
  );

  const encryptRoomKey = useCallback(
    (
      roomKey: Uint8Array,
      recipientPublicKeyB64: string
    ): { ciphertextB64: string; nonceB64: string } | null => {
      if (!keypair) return null;
      try {
        const recipientPubKey = decodeBase64(recipientPublicKeyB64);
        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const ciphertext = nacl.box(
          roomKey,
          nonce,
          recipientPubKey,
          keypair.secretKey
        );
        return {
          ciphertextB64: encodeBase64(ciphertext),
          nonceB64: encodeBase64(nonce),
        };
      } catch {
        return null;
      }
    },
    [keypair]
  );

  const encryptMessage = useCallback(
    (
      plaintext: string,
      roomId: string
    ): { ciphertextB64: string; nonceB64: string } | null => {
      const roomKey = roomKeysRef.current.get(roomId);
      if (!roomKey) return null;
      try {
        const msg = decodeUTF8(plaintext);
        const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
        const ciphertext = nacl.secretbox(msg, nonce, roomKey);
        return {
          ciphertextB64: encodeBase64(ciphertext),
          nonceB64: encodeBase64(nonce),
        };
      } catch {
        return null;
      }
    },
    []
  );

  const decryptMessage = useCallback(
    (
      ciphertextB64: string,
      nonceB64: string,
      roomId: string
    ): string | null => {
      const roomKey = roomKeysRef.current.get(roomId);
      if (!roomKey) return null;
      try {
        const ciphertext = decodeBase64(ciphertextB64);
        const nonce = decodeBase64(nonceB64);
        const decrypted = nacl.secretbox.open(ciphertext, nonce, roomKey);
        if (!decrypted) return null;
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
      } catch {
        return null;
      }
    },
    []
  );

  const encryptBytes = useCallback(
    (
      data: Uint8Array,
      roomId: string
    ): { ciphertextB64: string; nonceB64: string } | null => {
      const roomKey = roomKeysRef.current.get(roomId);
      if (!roomKey) return null;
      try {
        const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
        const ciphertext = nacl.secretbox(data, nonce, roomKey);
        return {
          ciphertextB64: encodeBase64(ciphertext),
          nonceB64: encodeBase64(nonce),
        };
      } catch {
        return null;
      }
    },
    []
  );

  const decryptBytes = useCallback(
    (
      ciphertextB64: string,
      nonceB64: string,
      roomId: string
    ): Uint8Array | null => {
      const roomKey = roomKeysRef.current.get(roomId);
      if (!roomKey) return null;
      try {
        const ciphertext = decodeBase64(ciphertextB64);
        const nonce = decodeBase64(nonceB64);
        return nacl.secretbox.open(ciphertext, nonce, roomKey) || null;
      } catch {
        return null;
      }
    },
    []
  );

  const setRoomKey = useCallback(async (roomId: string, key: Uint8Array) => {
    const storedIndex = await secureGet(ROOM_KEY_INDEX_KEY);
    const roomIds = new Set<string>(
      storedIndex ? (JSON.parse(storedIndex) as string[]) : [],
    );
    roomIds.add(roomId);
    await secureSet(ROOM_KEY_INDEX_KEY, JSON.stringify([...roomIds]));
    await secureSet(`devstudio_roomkey_${roomId}`, encodeBase64(key));
    roomKeysRef.current.set(roomId, key);
    setRoomKeysVersion((v) => v + 1);
  }, []);

  const getRoomKey = useCallback((roomId: string): Uint8Array | null => {
    return roomKeysRef.current.get(roomId) ?? null;
  }, []);

  const generateRoomKey = useCallback(
    async (roomId: string): Promise<Uint8Array> => {
      const key = nacl.randomBytes(nacl.secretbox.keyLength);
      await setRoomKey(roomId, key);
      return key;
    },
    [setRoomKey]
  );

  // Load persisted room keys on init
  useEffect(() => {
    // We load room keys lazily per room when needed
  }, []);

  const loadRoomKey = useCallback(async (roomId: string): Promise<void> => {
    if (roomKeysRef.current.has(roomId)) return;
    const stored = await secureGet(`devstudio_roomkey_${roomId}`);
    if (!stored) return;
    const key = decodeBase64(stored);
    const storedIndex = await secureGet(ROOM_KEY_INDEX_KEY);
    const roomIds = new Set<string>(
      storedIndex ? (JSON.parse(storedIndex) as string[]) : [],
    );
    roomIds.add(roomId);
    await secureSet(ROOM_KEY_INDEX_KEY, JSON.stringify([...roomIds]));
    roomKeysRef.current.set(roomId, key);
    setRoomKeysVersion((v) => v + 1);
  }, []);

  const clearLocalKeys = useCallback(async (): Promise<void> => {
    const storedIndex = await secureGet(ROOM_KEY_INDEX_KEY);
    const indexedRoomIds = storedIndex
      ? (JSON.parse(storedIndex) as string[])
      : [];
    const roomIds = new Set([
      ...indexedRoomIds,
      ...roomKeysRef.current.keys(),
    ]);
    await Promise.all([
      secureDelete(DEVICE_KEYPAIR_KEY),
      secureDelete(ROOM_KEY_INDEX_KEY),
      ...[...roomIds].map((roomId) =>
        secureDelete(`devstudio_roomkey_${roomId}`),
      ),
    ]);
    roomKeysRef.current.clear();
    setKeypair(null);
    setRoomKeysVersion((v) => v + 1);
  }, []);

  // Expose roomKeys as a snapshot for consumers that need reactivity
  const roomKeys = roomKeysRef.current;

  return (
    <CryptoContext.Provider
      value={{
        publicKeyB64,
        isReady,
        decryptRoomKeyEnvelope,
        encryptRoomKey,
        encryptMessage,
        decryptMessage,
        encryptBytes,
        decryptBytes,
        setRoomKey,
        getRoomKey,
        generateRoomKey,
        loadRoomKey,
        roomKeys,
        clearLocalKeys,
      }}
    >
      {children}
    </CryptoContext.Provider>
  );
}

export function useCrypto(): CryptoContextValue {
  const ctx = useContext(CryptoContext);
  if (!ctx) throw new Error("useCrypto must be used inside CryptoProvider");
  return ctx;
}
