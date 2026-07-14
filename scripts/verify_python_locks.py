from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
HASH_PATTERN = re.compile(r"--hash=sha256:([0-9a-f]{64})(?:\s|$)")
REQUIREMENT_PATTERN = re.compile(
    r"^(?P<name>[A-Za-z0-9_.-]+)"
    r"(?P<operator>==|>=|<=|~=|!=|>|<)"
    r"(?P<version>[^\s;\\]+)"
    r"(?:\s*;\s*(?P<marker>.*?))?\s*\\?$"
)
APPROVED_RUNTIME = {
    "pymupdf": "1.26.7",
    "pyinstaller": "6.21.0",
    "pillow": "12.2.0",
}


def _normalize_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


@dataclass(frozen=True)
class LockedRequirement:
    name: str
    version: str
    marker: str
    hashes: tuple[str, ...]


def _parse_lock(lock_text: str, label: str) -> dict[str, LockedRequirement]:
    for required_header in (
        "uv pip compile",
        "--universal",
        "--python-version 3.12",
        "--generate-hashes",
        "--only-binary :all:",
    ):
        if required_header not in lock_text:
            raise ValueError(f"{label} lock is missing generator policy {required_header}")

    lines = lock_text.splitlines()
    starts: list[tuple[int, re.Match[str]]] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("--"):
            if line[:1].isspace() and stripped.startswith("--hash=sha256:"):
                continue
            raise ValueError(
                f"{label} lock contains an unsupported requirements directive: {stripped}"
            )
        if line[:1].isspace():
            continue
        match = REQUIREMENT_PATTERN.match(line)
        if not match:
            raise ValueError(f"{label} lock has an invalid requirement line: {line}")
        starts.append((index, match))

    if not starts:
        raise ValueError(f"{label} lock has no requirements")

    requirements: dict[str, LockedRequirement] = {}
    for position, (start, match) in enumerate(starts):
        end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        name = _normalize_name(match.group("name"))
        if match.group("operator") != "==":
            raise ValueError(f"{name} must use an exact == pin in the {label} lock")
        if name in requirements:
            raise ValueError(f"{label} lock contains duplicate requirement {name}")
        block = "\n".join(lines[start:end])
        hashes = tuple(HASH_PATTERN.findall(block))
        if not hashes:
            raise ValueError(f"{name} requirement is missing a sha256 hash in the {label} lock")
        requirements[name] = LockedRequirement(
            name=name,
            version=match.group("version"),
            marker=(match.group("marker") or "").strip(),
            hashes=hashes,
        )

    return requirements


def _require_version(
    requirements: dict[str, LockedRequirement],
    name: str,
    version: str,
    label: str,
) -> None:
    requirement = requirements.get(name)
    if requirement is None:
        raise ValueError(f"{label} lock is missing {name}")
    if requirement.version != version:
        raise ValueError(
            f"{name} version mismatch in {label} lock: expected {version}, got {requirement.version}"
        )


def _require_platform_marker(
    requirements: dict[str, LockedRequirement],
    name: str,
    marker: str,
    label: str,
) -> None:
    requirement = requirements.get(name)
    if requirement is None:
        raise ValueError(f"{label} lock is missing platform dependency {name}")
    if marker not in requirement.marker:
        raise ValueError(
            f"{name} must carry marker {marker!r} in the {label} lock; got {requirement.marker!r}"
        )


def verify_python_locks(runtime_lock: str, dev_lock: str, lock_tools: str) -> None:
    tool_lines = [
        line.strip()
        for line in lock_tools.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if tool_lines != ["uv==0.11.28"]:
        raise ValueError(f"uv lock builder must be pinned to 0.11.28; got {tool_lines}")

    runtime = _parse_lock(runtime_lock, "runtime")
    dev = _parse_lock(dev_lock, "dev")

    for name, version in APPROVED_RUNTIME.items():
        _require_version(runtime, name, version, "runtime")

    for name, runtime_requirement in runtime.items():
        dev_requirement = dev.get(name)
        if dev_requirement is None:
            raise ValueError(f"{name} is present in runtime but missing from dev lock")
        if (
            runtime_requirement.version != dev_requirement.version
            or runtime_requirement.marker != dev_requirement.marker
            or frozenset(runtime_requirement.hashes) != frozenset(dev_requirement.hashes)
        ):
            raise ValueError(
                f"{name} runtime/dev drift: "
                f"runtime={runtime_requirement.version} {runtime_requirement.marker!r}, "
                f"dev={dev_requirement.version} {dev_requirement.marker!r}, "
                f"hashes_match={frozenset(runtime_requirement.hashes) == frozenset(dev_requirement.hashes)}"
            )

    for name, version in APPROVED_RUNTIME.items():
        _require_version(dev, name, version, "dev")
    _require_version(dev, "pytest", "9.0.3", "dev")
    if "pytest" in runtime:
        raise ValueError("pytest must not be present in the runtime lock")

    for requirements, label in ((runtime, "runtime"), (dev, "dev")):
        _require_platform_marker(requirements, "macholib", "sys_platform == 'darwin'", label)
        _require_platform_marker(requirements, "pefile", "sys_platform == 'win32'", label)
        _require_platform_marker(
            requirements,
            "pywin32-ctypes",
            "sys_platform == 'win32'",
            label,
        )
    _require_platform_marker(dev, "colorama", "sys_platform == 'win32'", "dev")


def main() -> int:
    verify_python_locks(
        (ROOT / "requirements.lock").read_text(encoding="utf-8"),
        (ROOT / "requirements-dev.lock").read_text(encoding="utf-8"),
        (ROOT / "requirements-lock-tools.txt").read_text(encoding="utf-8"),
    )
    print("Python lock policy verified.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as error:
        print(f"Python lock policy verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
