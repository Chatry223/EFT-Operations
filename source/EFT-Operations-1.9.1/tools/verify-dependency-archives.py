#!/usr/bin/env python3
"""Validate the exact local EFT/SPT/Fika dependency set used by the client builder.

This checks archive integrity, required assembly presence, and SHA-256 fingerprints
captured from the user's verified SPT 3.11.1 / EFT 0.16.1.3.35392 / Fika 1.2.3 setup.
It never extracts or republishes the proprietary binaries.
"""
from __future__ import annotations

import hashlib
import sys
import zipfile
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parents[2]
EFT_ARCHIVE = SOURCE_DIR / "EscapeFromTarkov_Data.zip"
BEPINEX_ARCHIVE = SOURCE_DIR / "BepInEx.zip"

EXPECTED = {
    "EscapeFromTarkov_Data.zip": {
        "Managed/Assembly-CSharp.dll": "12d5fd1728c58a9cd71a454fb5eae506b5a0a3c2bb35d543c4022800e10f47d5",
        "Managed/UnityEngine.dll": "8a1b7a377c5ac8de13d8249ebda361073e5771579d964ca0d1523f1cfbe00c3e",
        "Managed/UnityEngine.CoreModule.dll": "f7cfb53eb5b6a652d6bef329b33c154d8ccb0de7448ac5bfa1318762e10f7241",
        "Managed/UnityEngine.IMGUIModule.dll": "a6bb11554b72c1a49c0333345092edb3857680f6bbcc8dab62de5fc0979cc8fa",
        "Managed/UnityEngine.InputLegacyModule.dll": "483a31d01a8fc3190e378c3f56e59b6242614e60044964ae61940da1ad06b944",
        "Managed/UnityEngine.TextRenderingModule.dll": "9815737853459a5a775f8ccf26729a354348461fa93995afac27e8b54c44ea6f",
        "Managed/UnityEngine.UnityWebRequestModule.dll": "2a92eec461655f7a19e1222094e708d68f3125fd95cc43a81b5458b41fa319ac",
        "Managed/UnityEngine.JSONSerializeModule.dll": "7b51d5f7edd879a6e52e176c9f1efcab3a0a31a5e107d16602fbe4aba875b8b5",
    },
    "BepInEx.zip": {
        "BepInEx/core/BepInEx.dll": "2674d3aecf3097bee817abe7e8bbcc42bf583df51402069d5fcd4fbed55017ce",
        "BepInEx/core/0Harmony.dll": "1a21cc03424fc82c3dd1346905d16494536b9595ae4162228d99fb7c285c1031",
        "BepInEx/plugins/Fika.Core.dll": "246d45e0f9ef445484802379383cb8bb52901d013a1e244ba2209048c7dce65a",
        "BepInEx/plugins/spt/spt-common.dll": "970dab34fa09f8c6930f5011aae4025d1f2dc4874a27ff0b3cd7da06899b964f",
    },
}

def locate_entry(archive: zipfile.ZipFile, suffix: str) -> zipfile.ZipInfo:
    normalized = suffix.replace("\\", "/").lower()
    matches = [entry for entry in archive.infolist()
               if entry.filename.replace("\\", "/").lower().endswith(normalized)]
    if len(matches) != 1:
        raise RuntimeError(
            f"{archive.filename}: expected exactly one entry ending in {suffix!r}; found {len(matches)}"
        )
    return matches[0]

def verify_archive(path: Path, expected: dict[str, str]) -> None:
    if not path.is_file():
        raise RuntimeError(f"Required dependency archive is missing: {path}")
    with zipfile.ZipFile(path) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise RuntimeError(f"{path.name}: CRC failure in {corrupt}")
        print(f"[OK] {path.name}: ZIP integrity passed ({len(archive.infolist())} entries)")
        for suffix, expected_hash in expected.items():
            entry = locate_entry(archive, suffix)
            digest = hashlib.sha256(archive.read(entry)).hexdigest()
            if digest.lower() != expected_hash.lower():
                raise RuntimeError(
                    f"{path.name}: wrong dependency {entry.filename}; "
                    f"expected SHA256 {expected_hash}, got {digest}"
                )
            print(f"[OK] {entry.filename} ({entry.file_size:,} bytes, SHA256 verified)")

        if path.name == "BepInEx.zip":
            cfg = locate_entry(archive, "BepInEx/config/com.fika.core.cfg")
            header = archive.read(cfg).decode("utf-8-sig", errors="replace").splitlines()[0]
            if "Fika.Core v1.2.3" not in header:
                raise RuntimeError(f"Wrong Fika client config marker: {header}")
            print(f"[OK] Fika config marker: {header}")

def main() -> int:
    try:
        verify_archive(EFT_ARCHIVE, EXPECTED[EFT_ARCHIVE.name])
        verify_archive(BEPINEX_ARCHIVE, EXPECTED[BEPINEX_ARCHIVE.name])
        print("[PASS] Bundled dependencies match the verified EFT 0.16.1.3.35392 / SPT 3.11.1 / Fika client 1.2.3 set.")
        return 0
    except (OSError, zipfile.BadZipFile, RuntimeError, KeyError) as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
