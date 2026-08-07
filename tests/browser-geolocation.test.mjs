import test from "node:test";
import assert from "node:assert/strict";

import { currentLocationFailureMessage, requestCurrentBrowserCoordinate } from "../source/browser-geolocation.js";

test("현재 위치 성공 응답은 지도 범위와 동서 경도에 맞게 정규화한다", async () => {
  let receivedOptions;
  const coordinate = await requestCurrentBrowserCoordinate({
    secureContext: true,
    geolocation: {
      getCurrentPosition(success, _failure, options) {
        receivedOptions = options;
        success({ coords: { latitude: -91, longitude: 378.4241 } });
      }
    }
  });

  assert.equal(coordinate.latitude, -85.05112878);
  assert.ok(Math.abs(coordinate.longitude - 18.4241) < 1e-9);
  assert.deepEqual(receivedOptions, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
});

test("현재 위치 권한 오류는 원래 오류를 전달하고 사용자 안내를 구분한다", async () => {
  const denied = { code: 1 };
  await assert.rejects(
    requestCurrentBrowserCoordinate({
      secureContext: true,
      geolocation: { getCurrentPosition(_success, failure) { failure(denied); } }
    }),
    denied
  );
  assert.match(currentLocationFailureMessage(denied), /위치 권한/u);
  assert.match(currentLocationFailureMessage({ code: 3 }), /시간이 초과/u);
  assert.match(currentLocationFailureMessage({ code: "insecure" }), /보안 연결/u);
  assert.match(currentLocationFailureMessage({ code: "unsupported" }), /사용할 수 없습니다/u);
});

test("현재 위치 API 또는 유효 좌표가 없으면 조회를 닫힌 상태로 실패시킨다", async () => {
  await assert.rejects(requestCurrentBrowserCoordinate({ secureContext: false }), { code: "insecure" });
  await assert.rejects(requestCurrentBrowserCoordinate({ secureContext: true, geolocation: null }), { code: "unsupported" });
  await assert.rejects(
    requestCurrentBrowserCoordinate({
      secureContext: true,
      geolocation: { getCurrentPosition(success) { success({ coords: { latitude: Number.NaN, longitude: 127 } }); } }
    }),
    { code: 2 }
  );
});
