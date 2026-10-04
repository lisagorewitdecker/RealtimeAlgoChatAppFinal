import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const chatAppRequire = createRequire(
  resolve(process.cwd(), "artifacts/chat-app/package.json"),
);
const expoRequire = createRequire(chatAppRequire.resolve("expo"));
const signingRequire = createRequire(
  expoRequire.resolve("@expo/code-signing-certificates"),
);
const forge = signingRequire("node-forge");

test("RSA verification rejects extra DigestAlgorithm elements", () => {
  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 512, e: 3 });
  const asn1 = forge.asn1;
  const validSigningDigest = forge.md.sha256.create();
  validSigningDigest.update("test message");
  const validSignature = keyPair.privateKey.sign(validSigningDigest);
  const validVerificationDigest = forge.md.sha256.create();
  validVerificationDigest.update("test message");

  assert.equal(
    keyPair.publicKey.verify(
      validVerificationDigest.digest().getBytes(),
      validSignature,
    ),
    true,
  );

  const digest = forge.md.sha256.create();
  digest.update("test message");
  const digestBytes = digest.digest().getBytes();

  const algorithm = asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.SEQUENCE,
    true,
    [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer(forge.pki.oids.sha256).getBytes(),
      ),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ""),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, []),
    ],
  );
  const digestInfo = asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.SEQUENCE,
    true,
    [
      algorithm,
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OCTETSTRING,
        false,
        digestBytes,
      ),
    ],
  );
  const encodedDigestInfo = asn1.toDer(digestInfo).getBytes();
  const keySize = Math.ceil(keyPair.privateKey.n.bitLength() / 8);
  const encodedMessage =
    "\x00\x01" +
    "\xff".repeat(keySize - encodedDigestInfo.length - 3) +
    "\x00" +
    encodedDigestInfo;
  const encodedInteger = new forge.jsbn.BigInteger(
    forge.util.bytesToHex(encodedMessage),
    16,
  );
  const signature = forge.util.hexToBytes(
    encodedInteger
      .modPow(keyPair.privateKey.d, keyPair.privateKey.n)
      .toString(16)
      .padStart(keySize * 2, "0"),
  );

  assert.throws(
    () => keyPair.publicKey.verify(digestBytes, signature),
    /valid RSASSA-PKCS1-v1_5 DigestInfo/,
  );
});
