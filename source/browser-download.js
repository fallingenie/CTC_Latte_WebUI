const DOWNLOAD_CLEANUP_DELAY_MS = 2000;

function resolveSaveFilePicker(environment) {
  if (typeof environment.showSaveFilePicker === "function") {
    return (options) => environment.showSaveFilePicker(options);
  }
  if (typeof globalThis.showSaveFilePicker === "function") {
    return (options) => globalThis.showSaveFilePicker(options);
  }
  return undefined;
}

function normalizeExtension(extension) {
  return extension.startsWith(".") ? extension : `.${extension}`;
}

export async function requestSaveTarget(
  { filename, mimeType, extension, description },
  environment = {}
) {
  const showSaveFilePicker = resolveSaveFilePicker(environment);
  if (!showSaveFilePicker) {
    return { kind: "download", filename };
  }

  try {
    const handle = await showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description,
          accept: {
            [mimeType]: [normalizeExtension(extension)]
          }
        }
      ]
    });
    return { kind: "picker", filename, handle };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { kind: "cancelled", filename };
    }
    return { kind: "download", filename, warning: error };
  }
}

function scheduleDownloadCleanup(environment, cleanup) {
  if (typeof environment.setTimeout === "function") {
    environment.setTimeout(cleanup, DOWNLOAD_CLEANUP_DELAY_MS);
    return;
  }
  globalThis.setTimeout(cleanup, DOWNLOAD_CLEANUP_DELAY_MS);
}

function triggerBrowserDownload(filename, blob, environment) {
  const documentObject = environment.document ?? globalThis.document;
  const urlApi = environment.URL ?? globalThis.URL;

  if (!documentObject?.createElement || !documentObject.body?.appendChild) {
    throw new Error("이 브라우저에서는 파일 다운로드를 시작할 수 없습니다.");
  }
  if (!urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
    throw new Error("이 브라우저에서는 파일 다운로드 주소를 만들 수 없습니다.");
  }

  const url = urlApi.createObjectURL(blob);
  const link = documentObject.createElement("a");
  link.href = url;
  link.download = filename;
  documentObject.body.appendChild(link);
  link.click();

  scheduleDownloadCleanup(environment, () => {
    link.remove();
    urlApi.revokeObjectURL(url);
  });
}

export async function saveBlobToTarget(target, blob, environment = {}) {
  if (target.kind === "cancelled") {
    return { outcome: "cancelled", filename: target.filename };
  }

  if (target.kind === "picker") {
    const writable = await target.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { outcome: "written", filename: target.filename };
  }

  if (target.kind === "download") {
    if (typeof environment.triggerDownload === "function") {
      await environment.triggerDownload(target.filename, blob);
    } else {
      triggerBrowserDownload(target.filename, blob, environment);
    }
    return { outcome: "requested", filename: target.filename };
  }

  throw new TypeError("지원하지 않는 파일 저장 방식입니다.");
}
