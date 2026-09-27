import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import nacl from "tweetnacl";
import {
  decodeBase64,
  encodeBase64,
} from "tweetnacl-util";
import {
  CryptoProvider,
  type CryptoContextValue,
  useCrypto,
} from "../contexts/CryptoContext";

const mockSecureStore = new Map<string, string>();
let mockRandomCounter = 0;

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn((length: number) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = (mockRandomCounter + index) % 256;
    }
    mockRandomCounter += length;
    return bytes;
  }),
}));

let cryptoValue: CryptoContextValue | null = null;

function CryptoProbe() {
  cryptoValue = useCrypto();
  return null;
}

async function renderCryptoProvider() {
  const view = render(
    <CryptoProvider getToken={null}>
      <CryptoProbe />
    </CryptoProvider>,
  );

  await waitFor(() => {
    expect(cryptoValue?.isReady).toBe(true);
  });

  return view;
}

describe("CryptoProvider", () => {
  beforeEach(() => {
    mockSecureStore.clear();
    mockRandomCounter = 0;
    cryptoValue = null;
  });

  it("generates a room key, persists it, and restores it after remount", async () => {
    const firstView = await renderCryptoProvider();
    let generatedKey: Uint8Array | undefined;

    await act(async () => {
      generatedKey = await cryptoValue?.generateRoomKey("room-42");
    });

    expect(generatedKey).toHaveLength(nacl.secretbox.keyLength);
    expect(cryptoValue?.getRoomKey("room-42")).toEqual(generatedKey);
    expect(mockSecureStore.get("devstudio_roomkey_room-42")).toBe(
      encodeBase64(generatedKey as Uint8Array),
    );

    firstView.unmount();
    const secondView = await renderCryptoProvider();

    await act(async () => {
      await cryptoValue?.loadRoomKey("room-42");
    });

    expect(cryptoValue?.getRoomKey("room-42")).toEqual(generatedKey);
    secondView.unmount();
  });

  it("round trips room-key envelopes with a fresh nonce", async () => {
    await renderCryptoProvider();
    const roomKey = new Uint8Array(nacl.secretbox.keyLength).fill(7);

    const firstEnvelope = cryptoValue?.encryptRoomKey(
      roomKey,
      cryptoValue.publicKeyB64,
    );
    const secondEnvelope = cryptoValue?.encryptRoomKey(
      roomKey,
      cryptoValue.publicKeyB64,
    );

    expect(firstEnvelope).not.toBeNull();
    expect(firstEnvelope?.nonceB64).toHaveLength(
      Math.ceil((nacl.box.nonceLength * 4) / 3),
    );
    expect(secondEnvelope?.nonceB64).not.toBe(firstEnvelope?.nonceB64);
    expect(
      cryptoValue?.decryptRoomKeyEnvelope(
        firstEnvelope!.ciphertextB64,
        firstEnvelope!.nonceB64,
        cryptoValue.publicKeyB64,
      ),
    ).toEqual(roomKey);
  });

  it("round trips messages and arbitrary bytes with unique nonces", async () => {
    await renderCryptoProvider();
    await act(async () => {
      await cryptoValue?.generateRoomKey("room-42");
    });

    const firstMessage = cryptoValue?.encryptMessage("Hello 🔐", "room-42");
    const secondMessage = cryptoValue?.encryptMessage("Hello 🔐", "room-42");
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const encryptedBytes = cryptoValue?.encryptBytes(bytes, "room-42");

    expect(firstMessage).not.toBeNull();
    expect(secondMessage?.nonceB64).not.toBe(firstMessage?.nonceB64);
    expect(
      cryptoValue?.decryptMessage(
        firstMessage!.ciphertextB64,
        firstMessage!.nonceB64,
        "room-42",
      ),
    ).toBe("Hello 🔐");
    expect(encryptedBytes).not.toBeNull();
    expect(
      cryptoValue?.decryptBytes(
        encryptedBytes!.ciphertextB64,
        encryptedBytes!.nonceB64,
        "room-42",
      ),
    ).toEqual(bytes);
  });

  it("rejects invalid ciphertext and never returns plaintext without a room key", async () => {
    await renderCryptoProvider();
    expect(cryptoValue?.encryptMessage("secret", "missing-room")).toBeNull();
    expect(
      cryptoValue?.decryptMessage(
        "invalid ciphertext",
        "invalid nonce",
        "missing-room",
      ),
    ).toBeNull();
    expect(cryptoValue?.encryptBytes(new Uint8Array([1]), "missing-room")).toBeNull();
    expect(
      cryptoValue?.decryptBytes(
        "invalid ciphertext",
        "invalid nonce",
        "missing-room",
      ),
    ).toBeNull();

    await act(async () => {
      await cryptoValue?.generateRoomKey("room-42");
    });
    const encrypted = cryptoValue?.encryptMessage("secret", "room-42");
    const tamperedCiphertext = decodeBase64(encrypted!.ciphertextB64);
    tamperedCiphertext[0] ^= 1;

    expect(
      cryptoValue?.decryptMessage(
        encodeBase64(tamperedCiphertext),
        encrypted!.nonceB64,
        "room-42",
      ),
    ).toBeNull();
    expect(
      cryptoValue?.decryptMessage(
        encrypted!.ciphertextB64,
        "invalid nonce",
        "room-42",
      ),
    ).toBeNull();
  });

  it("clears the device keypair and every indexed room key on account deletion", async () => {
    await renderCryptoProvider();
    await act(async () => {
      await cryptoValue?.generateRoomKey("room-42");
      await cryptoValue?.generateRoomKey("room-84");
    });

    expect(mockSecureStore.has("devstudio_device_keypair_v1")).toBe(true);
    expect(mockSecureStore.has("devstudio_roomkey_room-42")).toBe(true);
    expect(mockSecureStore.has("devstudio_roomkey_room-84")).toBe(true);

    await act(async () => {
      await cryptoValue?.clearLocalKeys();
    });

    expect(mockSecureStore.has("devstudio_device_keypair_v1")).toBe(false);
    expect(mockSecureStore.has("devstudio_roomkey_index_v1")).toBe(false);
    expect(mockSecureStore.has("devstudio_roomkey_room-42")).toBe(false);
    expect(mockSecureStore.has("devstudio_roomkey_room-84")).toBe(false);
    expect(cryptoValue?.roomKeys.size).toBe(0);
  });
});