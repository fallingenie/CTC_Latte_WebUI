import {
  resolveVerifiedObservationMarkAssets,
  verifyLocalObservationMarkAssetBytes
} from "./export-attribution.js";

export async function buildCsvWorkspaceShareFiles(
  bundleBlob,
  csvBlob,
  csvSpecification,
  observationAttribution,
  environment = {}
) {
  if (!(bundleBlob instanceof Blob) || !(csvBlob instanceof Blob)) {
    throw new TypeError("공유할 CSV 자료 묶음과 표 파일이 필요합니다.");
  }
  if (typeof csvSpecification?.filename !== "string"
    || csvSpecification.filename !== csvSpecification.filename.trim()
    || csvSpecification.filename.length === 0
    || csvSpecification.filename.length > 160
    || csvSpecification.filename.startsWith(".")
    || !csvSpecification.filename.toLowerCase().endsWith(".csv")
    || /[<>:"/\\|?*\u0000-\u001F]/u.test(csvSpecification.filename)
    || typeof csvSpecification?.mimeType !== "string"
    || !csvSpecification.mimeType.toLowerCase().startsWith("text/csv")) {
    throw new TypeError("공유할 CSV 파일 정보가 필요합니다.");
  }

  const markAssets = resolveVerifiedObservationMarkAssets(observationAttribution);
  const csvFile = {
    blob: csvBlob,
    filename: csvSpecification.filename,
    mimeType: "text/csv"
  };
  if (markAssets.length === 0) return [csvFile];

  const { default: JSZip } = await import("jszip");
  const archive = await JSZip.loadAsync(await bundleBlob.arrayBuffer());
  const markFiles = await Promise.all(markAssets.map(async (asset) => {
    const entry = archive.file(asset.archivePath);
    if (!entry) throw new Error("필수 결과 표장 파일을 자료 묶음에서 찾지 못했습니다.");
    const bytes = await verifyLocalObservationMarkAssetBytes(
      asset,
      await entry.async("uint8array"),
      { crypto: environment.crypto ?? globalThis.crypto }
    );
    return {
      blob: new Blob([bytes], { type: asset.mediaType }),
      filename: asset.name,
      mimeType: asset.mediaType
    };
  }));

  return [csvFile, ...markFiles];
}
