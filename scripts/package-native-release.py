#!/usr/bin/env python3
"""Create updater-compatible native release archives and SHA-256 manifests."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import sys
import zipfile
import re


SUPPORTED_RIDS = {"win-x64", "osx-x64", "osx-arm64"}
ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "native" / "artifacts"
RELEASES = ARTIFACTS / "releases"
VERSION_PATTERN = re.compile(r"<Version>(\d+\.\d+\.\d+)</Version>")


def native_version() -> str:
    props = (ROOT / "Directory.Build.props").read_text(encoding="utf-8")
    match = VERSION_PATTERN.search(props)
    if not match:
        raise ValueError("Directory.Build.props must contain a three-part native Version")
    return match.group(1)


def archive_entries(rid: str) -> list[tuple[Path, str]]:
    source = ARTIFACTS / rid
    if rid == "win-x64":
        names = [
            "CodexNative.exe",
            "CodexNative.TerminalHost.exe",
            "CodexNative.Updater.exe",
        ]
        entries = [(source / name, name) for name in names]
    else:
        app = source / "CodexNative.app"
        entries = [
            (path, path.relative_to(source).as_posix())
            for path in sorted(app.rglob("*"))
            if path.is_file()
        ]

    missing = [str(path) for path, _ in entries if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"missing published native files: {', '.join(missing)}")
    if not entries:
        raise FileNotFoundError(f"no native files found for {rid}")
    return entries


def package(rid: str) -> Path:
    if rid not in SUPPORTED_RIDS:
        raise ValueError(f"unsupported native runtime: {rid}")
    RELEASES.mkdir(parents=True, exist_ok=True)
    archive = RELEASES / f"CodexNative-v{native_version()}-{rid}.zip"
    temporary = archive.with_suffix(".zip.tmp")
    temporary.unlink(missing_ok=True)

    with zipfile.ZipFile(
        temporary,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=False,
    ) as output:
        for path, name in archive_entries(rid):
            if path.is_symlink():
                raise ValueError(f"refusing to package symbolic link: {path}")
            info = zipfile.ZipInfo.from_file(path, arcname=name)
            info.compress_type = zipfile.ZIP_DEFLATED
            if rid.startswith("osx-") and "/Contents/MacOS/" in f"/{name}":
                info.external_attr = (0o100755 << 16)
            with path.open("rb") as source, output.open(info, "w") as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)

    os.replace(temporary, archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = archive.with_name(f"{archive.name}.sha256")
    checksum.write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    return archive


def main(arguments: list[str]) -> int:
    if not arguments:
        print(f"usage: {Path(sys.argv[0]).name} <{'|'.join(sorted(SUPPORTED_RIDS))}> [...]", file=sys.stderr)
        return 64
    for rid in arguments:
        result = package(rid)
        print(f"Native release archive ready: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
