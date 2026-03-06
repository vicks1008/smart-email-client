#!/usr/bin/env python3

import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(
            json.dumps(
                {
                    "error": "Usage: extract_olm.py <olm_path> <output_dir>"
                }
            ),
            file=sys.stderr,
        )
        return 1

    olm_path = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    repo_script = Path(__file__).resolve().parent.parent / "tools" / "olm-convert" / "olmConvert.py"

    if repo_script.exists():
        command = [
            sys.executable,
            str(repo_script),
            str(olm_path),
            str(output_dir),
            "--format",
            "eml",
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            print(
                json.dumps(
                    {
                        "error": result.stderr or result.stdout or "OLM conversion failed."
                    }
                ),
                file=sys.stderr,
            )
            return 4

        extracted = [str(path) for path in output_dir.rglob("*.eml")]
        print(json.dumps({"eml_files": extracted}))
        return 0

    try:
        import olmConvert  # type: ignore
    except Exception as exc:  # pragma: no cover
        print(
            json.dumps(
                {
                    "error": f"Failed to import olmConvert: {exc}",
                    "hint": "Install it with: python3 -m pip install git+https://github.com/PeterWarrington/olm-convert.git"
                }
            ),
            file=sys.stderr,
        )
        return 2

    try:
        olmConvert.convertOLM(str(olm_path), str(output_dir))
    except Exception as exc:  # pragma: no cover
        print(
            json.dumps(
                {
                    "error": f"OLM conversion failed: {exc}"
                }
            ),
            file=sys.stderr,
        )
        return 4

    extracted = [str(path) for path in output_dir.rglob("*.eml")]
    print(json.dumps({"eml_files": extracted}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
