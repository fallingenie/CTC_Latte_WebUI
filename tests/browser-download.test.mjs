import test from "node:test";
import assert from "node:assert/strict";
import {
  requestSaveTarget,
  saveBlobToTarget
} from "../source/browser-download.js";

const saveRequest = {
  filename: "climate-report.json",
  mimeType: "application/json",
  extension: ".json",
  description: "Climate report"
};

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("picker 성공은 write와 close가 끝난 뒤 완료된다", async () => {
  const blob = new Blob(["report"], { type: "application/json" });
  const closeGate = deferred();
  const events = [];
  const handle = {
    async createWritable() {
      events.push("createWritable");
      return {
        async write(value) {
          events.push("write");
          assert.equal(value, blob);
        },
        async close() {
          events.push("close");
          await closeGate.promise;
          events.push("closed");
        }
      };
    }
  };
  let pickerOptions;
  const target = await requestSaveTarget(saveRequest, {
    preferFilePicker: true,
    async showSaveFilePicker(options) {
      pickerOptions = options;
      return handle;
    }
  });

  assert.deepEqual(target, {
    kind: "picker",
    filename: saveRequest.filename,
    handle
  });
  assert.deepEqual(pickerOptions, {
    suggestedName: saveRequest.filename,
    types: [
      {
        description: saveRequest.description,
        accept: {
          [saveRequest.mimeType]: [saveRequest.extension]
        }
      }
    ]
  });

  let completed = false;
  const saving = saveBlobToTarget(target, blob).then((result) => {
    completed = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ["createWritable", "write", "close"]);
  assert.equal(completed, false);

  closeGate.resolve();
  assert.deepEqual(await saving, {
    outcome: "written",
    filename: saveRequest.filename
  });
  assert.deepEqual(events, ["createWritable", "write", "close", "closed"]);
});

test("picker 취소는 cancelled 대상으로 반환된다", async () => {
  const error = new Error("cancelled");
  error.name = "AbortError";

  const target = await requestSaveTarget(saveRequest, {
    preferFilePicker: true,
    async showSaveFilePicker() {
      throw error;
    }
  });

  assert.deepEqual(target, {
    kind: "cancelled",
    filename: saveRequest.filename
  });
  assert.deepEqual(await saveBlobToTarget(target, new Blob()), {
    outcome: "cancelled",
    filename: saveRequest.filename
  });
});

test("picker 미지원 환경은 download 대상으로 전환된다", async () => {
  const target = await requestSaveTarget(saveRequest, {
    preferFilePicker: true,
    showSaveFilePicker: null
  });

  assert.deepEqual(target, {
    kind: "download",
    filename: saveRequest.filename
  });

  const blob = new Blob(["report"]);
  const calls = [];
  assert.deepEqual(
    await saveBlobToTarget(target, blob, {
      async triggerDownload(filename, value) {
        calls.push({ filename, value });
      }
    }),
    { outcome: "requested", filename: saveRequest.filename }
  );
  assert.deepEqual(calls, [{ filename: saveRequest.filename, value: blob }]);
});

test("picker 보안 오류는 warning을 보존하고 download로 전환된다", async () => {
  const error = new Error("blocked by browser policy");
  error.name = "SecurityError";

  const target = await requestSaveTarget(saveRequest, {
    preferFilePicker: true,
    async showSaveFilePicker() {
      throw error;
    }
  });

  assert.deepEqual(target, {
    kind: "download",
    filename: saveRequest.filename,
    warning: error
  });
});

test("기본 저장은 네이티브 파일을 먼저 자르지 않는 download 경로를 사용한다", async () => {
  let pickerCalled = false;
  const target = await requestSaveTarget(saveRequest, {
    async showSaveFilePicker() {
      pickerCalled = true;
      throw new Error("호출되면 안 됩니다.");
    }
  });

  assert.equal(pickerCalled, false);
  assert.deepEqual(target, {
    kind: "download",
    filename: saveRequest.filename
  });
});

test("picker write 실패는 close하지 않고 예외를 전달한다", async () => {
  const error = new Error("write failed");
  let closeCalled = false;
  const target = {
    kind: "picker",
    filename: saveRequest.filename,
    handle: {
      async createWritable() {
        return {
          async write() {
            throw error;
          },
          async close() {
            closeCalled = true;
          }
        };
      }
    }
  };

  await assert.rejects(saveBlobToTarget(target, new Blob()), error);
  assert.equal(closeCalled, false);
});

test("picker close 실패는 예외를 전달한다", async () => {
  const error = new Error("close failed");
  const events = [];
  const target = {
    kind: "picker",
    filename: saveRequest.filename,
    handle: {
      async createWritable() {
        return {
          async write() {
            events.push("write");
          },
          async close() {
            events.push("close");
            throw error;
          }
        };
      }
    }
  };

  await assert.rejects(saveBlobToTarget(target, new Blob()), error);
  assert.deepEqual(events, ["write", "close"]);
});

test("브라우저 download 경로는 앵커를 눌러 실제 저장을 요청하고 주소를 정리한다", async () => {
  const blob = new Blob(["기후 자료"], { type: "text/plain;charset=utf-8" });
  const events = [];
  const link = {
    href: "",
    download: "",
    click() {
      events.push("click");
    },
    remove() {
      events.push("remove");
    }
  };
  const environment = {
    document: {
      createElement(tagName) {
        assert.equal(tagName, "a");
        return link;
      },
      body: {
        appendChild(value) {
          assert.equal(value, link);
          events.push("append");
        }
      }
    },
    URL: {
      createObjectURL(value) {
        assert.equal(value, blob);
        events.push("create-url");
        return "blob:test-download";
      },
      revokeObjectURL(value) {
        assert.equal(value, "blob:test-download");
        events.push("revoke-url");
      }
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 2000);
      events.push("schedule-cleanup");
      callback();
    }
  };

  const result = await saveBlobToTarget(
    { kind: "download", filename: "기후-자료.txt" },
    blob,
    environment
  );

  assert.deepEqual(result, { outcome: "requested", filename: "기후-자료.txt" });
  assert.equal(link.href, "blob:test-download");
  assert.equal(link.download, "기후-자료.txt");
  assert.deepEqual(events, [
    "create-url",
    "append",
    "click",
    "schedule-cleanup",
    "remove",
    "revoke-url"
  ]);
});
