from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath
from typing import Any

import pandas as pd


ATTRIBUTION_TABLE = "observation_attribution_manifest"
ATTRIBUTION_ROOT = PurePosixPath("data/observation_attribution_manifest")


def _text(value: Any) -> str:
    if value is None:
        return ""
    try:
        if bool(pd.isna(value)):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value).strip()


def _relative_path(value: Any) -> PurePosixPath:
    text = _text(value)
    candidate = PurePosixPath(text)
    if (
        not text
        or candidate.is_absolute()
        or "\\" in text
        or any(part in {"", ".", ".."} for part in candidate.parts)
    ):
        raise ValueError("WebUI attribution 경로가 올바르지 않습니다.")
    return candidate


def _manifest(root: Path) -> dict[str, Any]:
    value = json.loads((root / "manifest.json").read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict) or not isinstance(value.get("artifacts"), list):
        raise ValueError("WebUI manifest의 artifact 목록을 읽을 수 없습니다.")
    return value


def _attribution_part(manifest: dict[str, Any]) -> dict[str, Any]:
    matches: list[dict[str, Any]] = []
    for artifact in manifest["artifacts"]:
        if (
            not isinstance(artifact, dict)
            or _text(artifact.get("table_name")) != ATTRIBUTION_TABLE
        ):
            continue
        relative = _relative_path(artifact.get("path") or artifact.get("arcname"))
        if (
            relative.parent == ATTRIBUTION_ROOT
            and relative.name.startswith("part-")
            and relative.suffix.lower() == ".parquet"
        ):
            matches.append(artifact)
    if len(matches) != 1:
        raise ValueError("WebUI attribution parquet을 하나로 결정할 수 없습니다.")
    return matches[0]


def _mark_descriptors(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    descriptors: dict[str, dict[str, Any]] = {}
    for artifact in manifest["artifacts"]:
        if not isinstance(artifact, dict):
            continue
        raw_path = _text(artifact.get("path") or artifact.get("arcname"))
        if not raw_path.startswith("licenses/"):
            continue
        relative = _relative_path(raw_path)
        if relative.parent != PurePosixPath("licenses") or relative.suffix.lower() != ".png":
            continue
        sha256 = _text(artifact.get("sha256")).lower()
        size_bytes = artifact.get("size_bytes")
        if len(sha256) != 64 or any(character not in "0123456789abcdef" for character in sha256):
            raise ValueError("WebUI 결과 표장 SHA-256이 올바르지 않습니다.")
        if not isinstance(size_bytes, int) or isinstance(size_bytes, bool) or size_bytes <= 0:
            raise ValueError("WebUI 결과 표장 크기가 올바르지 않습니다.")
        descriptors[relative.name] = {
            "name": relative.name,
            "path": relative.as_posix(),
            "sha256": sha256,
            "sizeBytes": size_bytes,
            "mediaType": "image/png",
        }
    return descriptors


def build_public_attribution(root: Path) -> dict[str, Any]:
    manifest = _manifest(root)
    attribution_artifact = _attribution_part(manifest)
    relative = _relative_path(
        attribution_artifact.get("path") or attribution_artifact.get("arcname")
    )
    parquet_path = root.joinpath(*relative.parts)
    frame = pd.read_parquet(parquet_path)
    required_columns = {
        "provider_id",
        "provider_name",
        "dataset_id",
        "license_name",
        "license_url",
        "citation",
        "attribution_text",
        "redistribution_policy",
        "required_mark_assets",
        "used_row_count",
        "attribution_required",
    }
    if not required_columns.issubset(frame.columns):
        raise ValueError("WebUI attribution parquet의 공개 필드가 부족합니다.")

    mark_descriptors = _mark_descriptors(manifest)
    provider_ids: list[str] = []
    providers: list[dict[str, Any]] = []
    for row in frame.to_dict(orient="records"):
        provider_id = _text(row.get("provider_id")).lower()
        used_row_count = int(row.get("used_row_count") or 0)
        if not provider_id or used_row_count <= 0:
            continue
        if provider_id in provider_ids:
            raise ValueError("WebUI attribution provider가 중복되었습니다.")
        required_mark_names = [
            item.strip()
            for item in _text(row.get("required_mark_assets")).split(",")
            if item.strip()
        ]
        marks: list[dict[str, Any]] = []
        for name in required_mark_names:
            descriptor = mark_descriptors.get(name)
            if descriptor is None:
                raise ValueError("WebUI attribution이 요구한 결과 표장이 없습니다.")
            marks.append(descriptor)
        provider_ids.append(provider_id)
        providers.append(
            {
                "providerId": provider_id,
                "name": _text(row.get("provider_name")),
                "dataset": _text(row.get("dataset_id")),
                "licenseName": _text(row.get("license_name")),
                "licenseUrl": _text(row.get("license_url")),
                "citation": _text(row.get("citation")),
                "attributionText": _text(row.get("attribution_text")),
                "redistributionPolicy": _text(row.get("redistribution_policy")),
                "usedRowCount": used_row_count,
                "attributionRequired": bool(row.get("attribution_required")),
                "requiresResultMark": bool(required_mark_names),
                "markAssets": marks,
            }
        )

    return {
        "schemaVersion": 1,
        "ready": True,
        "usesObservationData": bool(provider_ids),
        "providerIds": provider_ids,
        "providers": providers,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    root = Path(args.root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("WebUI 자료 루트가 디렉터리가 아닙니다.")
    print(json.dumps(build_public_attribution(root), ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
