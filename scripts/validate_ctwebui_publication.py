from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from typing import Any, Mapping, Sequence


WEBUI_FORMAT = "Climate Time Capsule WebUI Hybrid Export"
WEBUI_FORMAT_VERSION = 3
WEBUI_PUBLICATION_CONTRACT = "atomic-directory-v2"
DATASET_SEAL_CONTRACT = "ctc.webui.canonical-dataset-seal"
DATASET_SEAL_VERSION = 1
INPUT_FINGERPRINT_CONTRACT = "ctc.immutable-artifact-inputs"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
FULL_VALIDATION_MODE = "full"
STARTUP_VALIDATION_MODE = "startup"
VALIDATION_MODES = (FULL_VALIDATION_MODE, STARTUP_VALIDATION_MODE)
REQUIRED_ARRAY_KEYS = ("raw_daily", "corrected_daily", "coverage_mask")
REQUIRED_DATASET_DIRECTORIES = ("meta", "arrays", "data")


class PublicationValidationError(RuntimeError):
    pass


def validate_ctwebui_publication(
    root: Path,
    *,
    mode: str = FULL_VALIDATION_MODE,
) -> dict[str, Any]:
    if mode not in VALIDATION_MODES:
        raise PublicationValidationError("기후자료 검증 방식이 올바르지 않습니다.")
    resolved_root = root.expanduser().resolve(strict=True)
    if (
        not resolved_root.is_dir()
        or root.is_symlink()
        or _is_junction(root)
    ):
        raise PublicationValidationError("기후자료 폴더를 확인할 수 없습니다.")
    manifest = _read_json(resolved_root / "manifest.json", "기후자료 manifest")
    if manifest.get("format") != WEBUI_FORMAT:
        raise PublicationValidationError("기후자료 manifest 형식이 올바르지 않습니다.")

    publication_contract = _text(manifest.get("publication_contract"))
    completion = manifest.get("completion")
    export_policy = manifest.get("export_policy")
    atomic_publish = isinstance(export_policy, Mapping) and export_policy.get("atomic_publish") is True
    if publication_contract != WEBUI_PUBLICATION_CONTRACT:
        raise PublicationValidationError("원자적 완료 표식이 없는 자료판은 출시할 수 없습니다.")
    if (
        manifest.get("format") != WEBUI_FORMAT
        or _integer(manifest.get("format_version"), default=0) != WEBUI_FORMAT_VERSION
        or manifest.get("root") != "."
        or manifest.get("manifest_path") != "manifest.json"
        or not atomic_publish
        or not isinstance(completion, Mapping)
        or not completion
    ):
        raise PublicationValidationError("원자적 자료 게시 계약이 올바르지 않습니다.")

    artifacts = _artifact_rows(manifest)
    table_counts = _table_counts(manifest)
    if _text(completion.get("status")).lower() != "complete":
        raise PublicationValidationError("기후자료 완료 상태가 올바르지 않습니다.")
    if _integer(completion.get("table_count")) != len(table_counts):
        raise PublicationValidationError("기후자료 완료 표식의 표 수가 일치하지 않습니다.")
    if _integer(completion.get("artifact_count")) != len(artifacts):
        raise PublicationValidationError("기후자료 완료 표식의 파일 수가 일치하지 않습니다.")
    if completion.get("atomic_publish") is not True:
        raise PublicationValidationError("기후자료 완료 표식의 게시 상태가 일치하지 않습니다.")
    if _integer(completion.get("contract_version")) != 3:
        raise PublicationValidationError("봉인되지 않은 이전 완료 계약은 출시할 수 없습니다.")

    generation_id = _text(manifest.get("generation_id")).lower()
    if (
        not SHA256_PATTERN.fullmatch(generation_id)
        or _text(completion.get("generation_id")).lower() != generation_id
    ):
        raise PublicationValidationError("기후자료 생성 식별자가 일치하지 않습니다.")
    observation_contract_version = _integer(
        manifest.get("observation_contract_version"),
        default=0,
    )
    if (
        observation_contract_version != 1
        or _integer(completion.get("observation_contract_version")) != observation_contract_version
    ):
        raise PublicationValidationError("관측자료 계약 버전이 일치하지 않습니다.")

    completion_marker = _normalized_relative_path(
        export_policy.get("completion_marker") or "meta/completion.json"
    )
    if not any(
        _normalized_relative_path(artifact.get("path") or artifact.get("arcname"))
        == completion_marker
        for artifact in artifacts
    ):
        raise PublicationValidationError("기후자료 완료 표식이 artifact 목록에 없습니다.")
    marker = _read_json(
        resolved_root.joinpath(*PurePosixPath(completion_marker).parts),
        "기후자료 완료 표식",
    )
    if marker != dict(completion):
        raise PublicationValidationError("기후자료 완료 표식이 manifest와 일치하지 않습니다.")

    expected_binding = _manifest_binding_sha256(
        manifest=manifest,
        artifacts=artifacts,
        table_counts=table_counts,
        completion_marker=completion_marker,
    )
    actual_binding = _text(completion.get("manifest_binding_sha256")).lower()
    if not SHA256_PATTERN.fullmatch(actual_binding) or actual_binding != expected_binding:
        raise PublicationValidationError("기후자료 완료 표식이 manifest와 결합되지 않았습니다.")

    fingerprint = manifest.get("immutable_input_fingerprint")
    expected_seal = _canonical_dataset_seal(fingerprint, manifest_hash=actual_binding)
    if (
        manifest.get("dataset_seal") != expected_seal
        or _text(manifest.get("dataset_id")).lower() != expected_seal["dataset_id"]
        or _text(manifest.get("manifest_hash")).lower() != actual_binding
        or manifest.get("source_fingerprint") != expected_seal["source_fingerprint"]
    ):
        raise PublicationValidationError("기후자료 정본 봉인이 manifest와 일치하지 않습니다.")

    array_index = _read_json(resolved_root / "meta" / "array_index.json", "기후자료 배열 색인")
    raw_index = _read_json(resolved_root / "meta" / "raw_cmip6_index.json", "원자료 연결 색인")
    required_paths = _validate_required_structure(array_index, raw_index)
    inventory = _validate_artifact_inventory(
        resolved_root,
        artifacts,
        required_paths=required_paths,
        full=mode == FULL_VALIDATION_MODE,
    )

    return {
        "artifactCount": len(artifacts),
        "contract": publication_contract,
        "contractVersion": _integer(completion.get("contract_version")),
        "datasetId": expected_seal["dataset_id"],
        "fileCount": inventory["file_count"],
        "generationId": generation_id,
        "integrityMode": mode,
        "manifestBindingSha256": actual_binding,
        "status": "complete",
    }


def _validate_required_structure(
    array_index: Mapping[str, Any],
    raw_index: Mapping[str, Any],
) -> set[str]:
    for key in ("dates", "scenarios", "models", "variables", "locations"):
        value = array_index.get(key)
        if not isinstance(value, list) or not value:
            raise PublicationValidationError("기후자료 배열 축이 비어 있습니다.")
    arrays = array_index.get("arrays")
    if not isinstance(arrays, Mapping):
        raise PublicationValidationError("기후자료 배열 경로 설명이 올바르지 않습니다.")
    required_paths = {
        _normalized_relative_path(arrays.get(key))
        for key in REQUIRED_ARRAY_KEYS
    }
    if (
        raw_index.get("format")
        != "Climate Time Capsule WebUI Raw CMIP6 Connector Index"
        or not isinstance(raw_index.get("entries"), list)
        or not raw_index["entries"]
        or _integer(raw_index.get("entry_count")) != len(raw_index["entries"])
    ):
        raise PublicationValidationError("원자료 연결 색인이 비어 있거나 불완전합니다.")
    required_paths.update(
        {
            "meta/array_index.json",
            "meta/raw_cmip6_index.json",
        }
    )
    return required_paths


def _validate_artifact_inventory(
    root: Path,
    artifacts: Sequence[Mapping[str, Any]],
    *,
    required_paths: set[str],
    full: bool,
) -> dict[str, int]:
    for directory_name in REQUIRED_DATASET_DIRECTORIES:
        target_directory = root / directory_name
        if not target_directory.exists() or not target_directory.is_dir():
            raise PublicationValidationError("기후자료 필수 폴더가 아직 준비되지 않았습니다.")
        _assert_safe_existing_path(root, target_directory)
    artifact_by_path = {
        _normalized_relative_path(item.get("path") or item.get("arcname")): item
        for item in artifacts
    }
    if not required_paths.issubset(artifact_by_path):
        raise PublicationValidationError("필수 기후자료가 manifest에 없습니다.")

    directory_artifacts: set[str] = set()
    file_artifacts: set[str] = set()
    for relative_path, artifact in artifact_by_path.items():
        target = root.joinpath(*PurePosixPath(relative_path).parts)
        if not target.exists():
            raise PublicationValidationError("기후자료 artifact가 아직 준비되지 않았습니다.")
        _assert_safe_existing_path(root, target)
        expected_size = _integer(artifact.get("size_bytes"), default=-1)
        expected_count = _integer(artifact.get("file_count"), default=-1)
        expected_sha256 = _text(artifact.get("sha256")).lower()
        hash_mode = _text(artifact.get("hash_mode"))
        if target.is_file():
            if hash_mode != "sha256" or expected_count != 1:
                raise PublicationValidationError("기후자료 파일 해시 방식이 올바르지 않습니다.")
            file_artifacts.add(relative_path)
            actual_size = int(target.stat().st_size)
            if actual_size != expected_size:
                raise PublicationValidationError("기후자료 파일 크기가 manifest와 일치하지 않습니다.")
            if full and _sha256_file(target) != expected_sha256:
                raise PublicationValidationError("기후자료 파일 SHA-256이 manifest와 일치하지 않습니다.")
            continue
        if not target.is_dir() or hash_mode != "directory_listing_v1":
            raise PublicationValidationError("기후자료 폴더 해시 방식이 올바르지 않습니다.")
        directory_artifacts.add(relative_path)

    for relative_path in artifact_by_path:
        parts = PurePosixPath(relative_path).parts
        for index in range(1, len(parts)):
            if "/".join(parts[:index]) in artifact_by_path:
                raise PublicationValidationError("기후자료 artifact 경로가 서로 겹칩니다.")
    if not any(
        path.startswith("data/") and _integer(artifact_by_path[path].get("size_bytes"), default=0) > 0
        for path in artifact_by_path
    ):
        raise PublicationValidationError("기후자료 테이블이 비어 있습니다.")
    if any(path not in directory_artifacts for path in required_paths if path.startswith("arrays/")):
        raise PublicationValidationError("필수 기후자료 배열이 폴더 artifact가 아닙니다.")

    actual_files = _walk_files(root)
    directory_files: dict[str, list[tuple[str, os.stat_result]]] = {
        relative_path: []
        for relative_path in directory_artifacts
    }
    uncovered = []
    for relative_path in actual_files:
        if relative_path == "manifest.json" or relative_path in file_artifacts:
            continue
        parts = PurePosixPath(relative_path).parts
        owner = ""
        for index in range(len(parts) - 1, 0, -1):
            candidate = "/".join(parts[:index])
            if candidate in directory_artifacts:
                owner = candidate
                break
        if not owner:
            uncovered.append(relative_path)
            continue
        child_relative_path = relative_path[len(owner) + 1 :]
        directory_files[owner].append((child_relative_path, actual_files[relative_path]))
    if uncovered:
        raise PublicationValidationError(
            f"manifest에 없는 파일이 자료판에 포함되어 있습니다: {uncovered[0]}"
        )
    for relative_path in directory_artifacts:
        artifact = artifact_by_path[relative_path]
        summary = _directory_listing_summary(directory_files[relative_path])
        if (
            summary["size_bytes"] != _integer(artifact.get("size_bytes"), default=-1)
            or summary["file_count"] != _integer(artifact.get("file_count"), default=-1)
            or summary["sha256"] != _text(artifact.get("sha256")).lower()
        ):
            raise PublicationValidationError("기후자료 폴더 해시가 manifest와 일치하지 않습니다.")
    return {"file_count": len(actual_files)}


def _walk_files(root: Path) -> dict[str, os.stat_result]:
    result: dict[str, os.stat_result] = {}
    pending = [root]
    while pending:
        directory = pending.pop()
        _assert_safe_existing_path(root, directory)
        try:
            entries = list(os.scandir(directory))
        except OSError as exc:
            raise PublicationValidationError("기후자료 inventory를 읽을 수 없습니다.") from exc
        for entry in entries:
            target = Path(entry.path)
            if entry.is_symlink() or _is_junction(target):
                raise PublicationValidationError("기후자료에 링크 또는 junction을 사용할 수 없습니다.")
            relative_path = target.relative_to(root).as_posix()
            try:
                if entry.is_dir(follow_symlinks=False):
                    pending.append(target)
                elif entry.is_file(follow_symlinks=False):
                    result[relative_path] = entry.stat(follow_symlinks=False)
                else:
                    raise PublicationValidationError("기후자료 inventory 항목 형식을 확인할 수 없습니다.")
            except OSError as exc:
                raise PublicationValidationError("기후자료 inventory 항목을 확인할 수 없습니다.") from exc
    return result


def _directory_listing_summary(
    files: Sequence[tuple[str, os.stat_result]],
) -> dict[str, Any]:
    digest = hashlib.sha256()
    size_bytes = 0
    for relative_path, stat in sorted(files, key=lambda item: item[0]):
        child_size = int(stat.st_size)
        size_bytes += child_size
        digest.update(
            f"{relative_path}\0{child_size}\0{int(stat.st_mtime_ns)}\n".encode(
                "utf-8",
                errors="ignore",
            )
        )
    return {
        "file_count": len(files),
        "sha256": digest.hexdigest(),
        "size_bytes": size_bytes,
    }


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise PublicationValidationError("기후자료 파일 SHA-256을 계산할 수 없습니다.") from exc
    return digest.hexdigest()


def _assert_safe_existing_path(root: Path, target: Path) -> None:
    try:
        resolved = target.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise PublicationValidationError("기후자료 경로가 자료판 밖을 가리킵니다.") from exc
    current = root
    for part in target.relative_to(root).parts:
        current /= part
        if current.is_symlink() or _is_junction(current):
            raise PublicationValidationError("기후자료에 링크 또는 junction을 사용할 수 없습니다.")


def _is_junction(path: Path) -> bool:
    checker = getattr(os.path, "isjunction", None)
    if checker is None:
        return False
    try:
        return bool(checker(path))
    except OSError:
        return True


def _manifest_binding_sha256(
    *,
    manifest: Mapping[str, Any],
    artifacts: Sequence[Mapping[str, Any]],
    table_counts: Mapping[str, int],
    completion_marker: str,
) -> str:
    completion = dict(manifest["completion"])
    completion.pop("manifest_binding_sha256", None)
    artifact_bindings = []
    for artifact in artifacts:
        relative_path = _normalized_relative_path(
            artifact.get("path") or artifact.get("arcname")
        )
        if relative_path == completion_marker:
            continue
        artifact_bindings.append(
            {
                "path": relative_path,
                "size_bytes": _integer(artifact.get("size_bytes"), default=0),
                "sha256": _text(artifact.get("sha256")).lower(),
                "file_count": _integer(artifact.get("file_count"), default=1) or 1,
                "hash_mode": _text(artifact.get("hash_mode")),
                "table_name": _text(artifact.get("table_name")),
                "row_count": _integer(artifact.get("row_count"), default=0),
            }
        )
    payload: dict[str, Any] = {
        "format": _text(manifest.get("format")),
        "format_version": _integer(manifest.get("format_version"), default=0),
        "observation_contract_version": _integer(
            manifest.get("observation_contract_version"),
            default=0,
        ),
        "generation_id": _text(manifest.get("generation_id")),
        "export_policy": dict(manifest["export_policy"]),
        "table_row_counts": dict(sorted(table_counts.items())),
        "artifacts": sorted(artifact_bindings, key=lambda item: item["path"]),
        "completion": completion,
        "publication_contract": _text(manifest.get("publication_contract")),
    }
    fingerprint = manifest.get("immutable_input_fingerprint")
    if fingerprint:
        if not isinstance(fingerprint, Mapping):
            raise PublicationValidationError("기후자료 입력 지문 형식이 올바르지 않습니다.")
        payload["immutable_input_fingerprint"] = dict(fingerprint)
    if _integer(completion.get("contract_version"), default=0) >= 3:
        seal = _canonical_dataset_seal(fingerprint)
        payload["dataset_id"] = seal["dataset_id"]
        payload["source_fingerprint"] = seal["source_fingerprint"]
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


def _canonical_dataset_seal(
    fingerprint: Any,
    *,
    manifest_hash: str = "",
) -> dict[str, Any]:
    if not isinstance(fingerprint, Mapping):
        raise PublicationValidationError("기후자료 입력 지문이 없습니다.")
    value = dict(fingerprint)
    component_sha256 = value.get("component_sha256")
    dataset_id = _text(value.get("sha256")).lower()
    if (
        value.get("contract") != INPUT_FINGERPRINT_CONTRACT
        or _integer(value.get("contract_version"), default=0) != 2
        or _text(value.get("algorithm")).lower() != "sha256"
        or not SHA256_PATTERN.fullmatch(dataset_id)
        or not isinstance(component_sha256, Mapping)
        or not component_sha256
        or any(
            not _text(name)
            or not SHA256_PATTERN.fullmatch(_text(digest).lower())
            for name, digest in component_sha256.items()
        )
    ):
        raise PublicationValidationError("기후자료 입력 지문이 올바르지 않습니다.")
    normalized_manifest_hash = _text(manifest_hash).lower()
    if normalized_manifest_hash and not SHA256_PATTERN.fullmatch(normalized_manifest_hash):
        raise PublicationValidationError("기후자료 manifest 해시가 올바르지 않습니다.")
    return {
        "contract": DATASET_SEAL_CONTRACT,
        "contract_version": DATASET_SEAL_VERSION,
        "status": "sealed",
        "dataset_id": dataset_id,
        "manifest_hash": normalized_manifest_hash,
        "source_fingerprint": value,
    }


def _artifact_rows(manifest: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    raw_artifacts = manifest.get("artifacts")
    if not isinstance(raw_artifacts, list) or not raw_artifacts:
        raise PublicationValidationError("기후자료 artifact 목록이 비어 있습니다.")
    artifacts = []
    seen_paths: set[str] = set()
    for raw in raw_artifacts:
        if not isinstance(raw, Mapping):
            raise PublicationValidationError("기후자료 artifact 항목이 올바르지 않습니다.")
        relative_path = _normalized_relative_path(raw.get("path") or raw.get("arcname"))
        if relative_path in seen_paths:
            raise PublicationValidationError("기후자료 artifact 경로가 중복되었습니다.")
        if (
            _integer(raw.get("size_bytes"), default=-1) < 0
            or _integer(raw.get("file_count"), default=-1) < 0
            or not SHA256_PATTERN.fullmatch(_text(raw.get("sha256")).lower())
        ):
            raise PublicationValidationError("기후자료 artifact 설명이 올바르지 않습니다.")
        seen_paths.add(relative_path)
        artifacts.append(raw)
    return artifacts


def _table_counts(manifest: Mapping[str, Any]) -> dict[str, int]:
    raw = manifest.get("table_row_counts")
    if not isinstance(raw, Mapping):
        raise PublicationValidationError("기후자료 표 행수 설명이 올바르지 않습니다.")
    result: dict[str, int] = {}
    for key, value in raw.items():
        name = _text(key)
        count = _integer(value, default=-1)
        if not name or count < 0:
            raise PublicationValidationError("기후자료 표 행수 설명이 올바르지 않습니다.")
        result[name] = count
    return result


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(
            path.read_text(encoding="utf-8-sig"),
            parse_constant=lambda value: (_raise_json_constant(value)),
            object_pairs_hook=_reject_duplicate_keys,
        )
    except PublicationValidationError:
        raise
    except (OSError, UnicodeError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise PublicationValidationError(f"{label} JSON을 읽을 수 없습니다.") from exc
    if not isinstance(payload, dict):
        raise PublicationValidationError(f"{label} 형식이 올바르지 않습니다.")
    return payload


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PublicationValidationError(f"중복 JSON 키가 있습니다: {key}")
        result[key] = value
    return result


def _raise_json_constant(value: str) -> None:
    raise PublicationValidationError(f"비표준 JSON 숫자 상수가 있습니다: {value}")


def _normalized_relative_path(value: Any) -> str:
    relative_path = _text(value)
    posix_path = PurePosixPath(relative_path)
    if (
        not relative_path
        or "\\" in relative_path
        or posix_path.is_absolute()
        or any(part in {"", ".", ".."} for part in posix_path.parts)
        or posix_path.as_posix() != relative_path
    ):
        raise PublicationValidationError("기후자료 내부 경로가 올바르지 않습니다.")
    return relative_path


def _integer(value: Any, *, default: int = -1) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def _text(value: Any) -> str:
    return str(value or "").strip()


def _canonical_json(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, OverflowError) as exc:
        raise PublicationValidationError("기후자료 manifest를 정규화할 수 없습니다.") from exc


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WebUI 자료 게시 완료 계약을 검증합니다.")
    parser.add_argument("--root", required=True, help="검증할 .ctwebui 폴더")
    parser.add_argument(
        "--mode",
        choices=VALIDATION_MODES,
        default=FULL_VALIDATION_MODE,
        help="full은 게시 전 전수 검사, startup은 실행 전 빠른 검사",
    )
    return parser


def main() -> int:
    try:
        arguments = _parser().parse_args()
        result = validate_ctwebui_publication(
            Path(arguments.root),
            mode=arguments.mode,
        )
    except (OSError, PublicationValidationError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
