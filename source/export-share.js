const KMA_MARK_FILES = Object.freeze([
  Object.freeze({ archivePath: "licenses/kma_mark_1.png", filename: "kma_mark_1.png" }),
  Object.freeze({ archivePath: "licenses/kma_mark_2.png", filename: "kma_mark_2.png" })
]);

export async function buildCsvWorkspaceShareFiles(bundleBlob, csvBlob, csvSpecification) {
  if (!(bundleBlob instanceof Blob) || !(csvBlob instanceof Blob)) {
    throw new TypeError("공유할 CSV 자료 묶음과 표 파일이 필요합니다.");
  }
  if (!csvSpecification?.filename || !csvSpecification?.mimeType) {
    throw new TypeError("공유할 CSV 파일 정보가 필요합니다.");
  }

  const { default: JSZip } = await import("jszip");
  const archive = await JSZip.loadAsync(await bundleBlob.arrayBuffer());
  const markFiles = await Promise.all(KMA_MARK_FILES.map(async ({ archivePath, filename }) => {
    const entry = archive.file(archivePath);
    if (!entry) throw new Error("기상청 출처 표시 파일을 자료 묶음에서 찾지 못했습니다.");
    return {
      blob: new Blob([await entry.async("uint8array")], { type: "image/png" }),
      filename,
      mimeType: "image/png"
    };
  }));

  return [{ blob: csvBlob, ...csvSpecification, mimeType: "text/csv" }, ...markFiles];
}
