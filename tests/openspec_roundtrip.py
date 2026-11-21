"""Verify exported Markdown with the official CLI and return an actual change to DSM."""
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "dsm.cjs"


def dsm(*args):
    return json.loads(subprocess.check_output(["node", CLI, *args], text=True))


def verify():
    tool = os.environ.get("OPENSPEC_BIN", "openspec")
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        project = folder / "project.json"
        shutil.copy(ROOT / "example/enterprise-architecture.dsm.json", project)
        base = dsm("show", project)["base"]
        assert not dsm("spec-check", project, "upgrade-memory")["errors"]
        original, edited = folder / "original.zip", folder / "edited.zip"
        dsm("spec-export", project, "upgrade-memory", original)
        assert dsm("import-preview", project, original)["changes"] == []
        tree = folder / "tree"
        with zipfile.ZipFile(original) as package:
            package.extractall(tree)
        requirement = next(tree.glob("openspec/changes/*/specs/*/spec.md"))
        requirement.write_text(requirement.read_text().replace("- **THEN** ", "- **THEN** Проверить паспорт. "))
        subprocess.run([tool, "validate", "upgrade-memory", "--strict"], cwd=tree, check=True)
        with zipfile.ZipFile(edited, "w", zipfile.ZIP_DEFLATED) as package:
            for file in tree.rglob("*"):
                if file.is_file():
                    package.write(file, file.relative_to(tree))
        diff = dsm("import-preview", project, edited)["changes"]
        assert len(diff) == 1 and diff[0]["key"] == "REQ-1"
        written = dsm("import", project, edited, base, "Архитектор", "Уточнена приёмка")
        req = next(n for n in written["data"]["nodes"] if n["id"] == "REQ-1")
        assert req["attrs"]["then"].startswith("Проверить паспорт.") and written["actor"] == "Архитектор"
        stale = subprocess.run(["node", CLI, "import-preview", project, edited], capture_output=True, text=True)
        assert stale.returncode and "база" in stale.stderr
    print("OpenSpec strict validation, clean export, edited ZIP, persisted change and stale rejection passed.")


if __name__ == "__main__":
    verify()
