"""Resource and font resolution shared by PDF editors."""

import os
import sys


SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))


def resource_path(*parts):
    roots = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        roots.append(meipass)
    roots.extend([PROJECT_ROOT, SCRIPT_DIR])

    for root in roots:
        candidate = os.path.join(root, *parts)
        if os.path.exists(candidate):
            return candidate

    return os.path.join(PROJECT_ROOT, *parts)


def first_existing_path(*paths):
    for path in paths:
        if path and os.path.exists(path):
            return path
    return paths[0] if paths else ""


def windows_font_path(filename):
    windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot") or r"C:\Windows"
    return os.path.join(windir, "Fonts", filename)


FONT_DIR = resource_path("assets", "fonts")
PROJECT_FONT_DIR = resource_path("fonts")
CALIBRI_REGULAR_FONT = first_existing_path(
    resource_path("assets", "fonts", "calibri.ttf"),
    resource_path("assets", "fonts", "Calibri-Embedded.ttf"),
    windows_font_path("calibri.ttf"),
    "/Library/Fonts/Calibri.ttf",
    resource_path("fonts", "LiberationSans-Regular.ttf"),
)
CALIBRI_BOLD_FONT = first_existing_path(
    resource_path("assets", "fonts", "calibri_bold.ttf"),
    resource_path("assets", "fonts", "Calibri-Bold-Embedded.ttf"),
    windows_font_path("calibrib.ttf"),
    "/Library/Fonts/Calibri Bold.ttf",
    resource_path("fonts", "LiberationSans-Bold.ttf"),
)
EMBED_INSERT_FONTS = os.environ.get("CABLE_REPORT_EMBED_INSERT_FONTS") == "1"

font_cache = {}
