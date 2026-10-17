"""Export deterministic OpenAPI specification for ONEVUE LLM Service.

Usage:
    ./.venv/bin/python scripts/export_openapi.py
    ./.venv/bin/python scripts/export_openapi.py --output docs/openapi.json
"""

import argparse
import json
import sys
from pathlib import Path

# Ensure project root is on sys.path
_CURRENT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _CURRENT_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from app.main import app  # noqa: E402


def generate_openapi_json(output_path: Path | None = None) -> str:
    """Generate and optionally save the deterministic OpenAPI JSON contract."""
    target_path = output_path or (_PROJECT_ROOT / "docs" / "openapi.json")

    # Generate schema without initializing network calls or external provider sessions
    schema = app.openapi()

    # Deterministic formatting: 2-space indentation, trailing newline
    formatted_json = json.dumps(schema, indent=2, ensure_ascii=False) + "\n"

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(formatted_json, encoding="utf-8")

    return formatted_json


def main() -> None:
    """CLI entrypoint for exporting OpenAPI specification."""
    parser = argparse.ArgumentParser(
        description="Export deterministic OpenAPI specification for ONEVUE LLM Service."
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=_PROJECT_ROOT / "docs" / "openapi.json",
        help="Target output file path for openapi.json (default: docs/openapi.json)",
    )
    args = parser.parse_args()

    out_file = args.output.resolve()
    generate_openapi_json(out_file)
    print(f"Successfully exported OpenAPI specification to: {out_file}")


if __name__ == "__main__":
    main()
