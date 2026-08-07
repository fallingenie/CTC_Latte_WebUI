const mercatorLatitudeLimit = 85.05112878;

function normalizeLongitude(longitude) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

export function requestCurrentBrowserCoordinate({
  geolocation = globalThis.navigator?.geolocation,
  secureContext = globalThis.isSecureContext
} = {}) {
  if (secureContext === false) return Promise.reject({ code: "insecure" });
  if (!geolocation?.getCurrentPosition) return Promise.reject({ code: "unsupported" });
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition((position) => {
      const latitude = position?.coords?.latitude;
      const longitude = position?.coords?.longitude;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        reject({ code: 2 });
        return;
      }
      resolve({
        latitude: Math.max(-mercatorLatitudeLimit, Math.min(mercatorLatitudeLimit, latitude)),
        longitude: normalizeLongitude(longitude)
      });
    }, reject, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
  });
}

export function currentLocationFailureMessage(error) {
  if (error?.code === 1) return "현재 위치 권한이 꺼져 있습니다. 브라우저 설정에서 위치 권한을 허용하거나 지도에서 직접 선택하세요.";
  if (error?.code === 3) return "현재 위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도하거나 지도에서 직접 선택하세요.";
  if (error?.code === "insecure") return "보안 연결에서만 현재 위치를 확인할 수 있습니다. 지도를 눌러 위치를 선택하세요.";
  if (error?.code === "unsupported") return "이 브라우저에서는 현재 위치 기능을 사용할 수 없습니다. 지도에서 직접 위치를 선택하세요.";
  return "현재 위치를 확인할 수 없습니다. 기기의 위치 기능을 켜거나 지도에서 직접 선택하세요.";
}
