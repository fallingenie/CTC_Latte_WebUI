import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";

const expectedSha256 = "b4ec53b8e26665a41938f1dba1d5134296dd8e324fe033a2324f5552996de9aa";
const expectedContract = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "lattethecat.climate.capsule",
      sha256_cert_fingerprints: [
        "73:63:73:01:63:6C:E4:F3:B0:15:2F:8A:E6:4F:48:09:42:E1:3D:28:4A:0D:06:07:82:52:92:21:88:A0:81:BA"
      ]
    }
  }
];

test("Digital Asset Links 원본과 배포본은 검증된 Android 계약의 동일 바이트다", async () => {
  const source = await fs.readFile(
    new URL("../source/public/.well-known/assetlinks.json", import.meta.url)
  );
  const deployment = await fs.readFile(
    new URL("../.well-known/assetlinks.json", import.meta.url)
  );

  assert.equal(source.equals(deployment), true);
  assert.equal(source.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
  assert.equal(crypto.createHash("sha256").update(source).digest("hex"), expectedSha256);
  assert.deepEqual(JSON.parse(source.toString("utf8")), expectedContract);
});
