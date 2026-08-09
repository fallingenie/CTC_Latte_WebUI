import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Vercel은 기후자료 API를 RC 조회 경로로 전달한다", async () => {
  const configuration = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8")
  );

  assert.deepEqual(configuration.rewrites, [
    {
      source: "/api/climate/:path*",
      destination:
        "https://vercel-c4c9589b---ctc-latte-rc-3rh4n6ymna-du.a.run.app/api/climate/:path*"
    }
  ]);

  assert.doesNotMatch(
    JSON.stringify(configuration),
    /storage\.googleapis\.com|gs:\/\/|ctc_latte/u
  );
});
