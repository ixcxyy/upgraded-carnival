#!/usr/bin/env python3
"""Fetch zig (the C compiler the game bundles) from PyPI and install a pruned copy.

    python3 toolchain/fetch-zig.py --platform linux-x86_64 --out app/src-tauri/resources/zig
    python3 toolchain/fetch-zig.py --wheel path/to/ziglang-...whl --out ...

Only what `zig cc` needs for freestanding RISC-V is kept: the zig binary, the standard
library and compiler-rt sources (zig builds its runtime on first use), and clang's
builtin headers. The libc sources for every other target (well over 100 MB) are dropped.
"""
import argparse, io, json, os, shutil, stat, sys, urllib.request, zipfile

VERSION = "0.13.0"
PLATFORMS = {
    "linux-x86_64": "manylinux_2_12_x86_64",
    "linux-aarch64": "manylinux_2_17_aarch64",
    "windows-x86_64": "win_amd64",
    "macos-x86_64": "macosx_12_0_x86_64",
    "macos-arm64": "macosx_12_0_arm64",
}
KEEP_LIB = ["std", "compiler_rt", "compiler_rt.zig", "c.zig", "zig.h", "include"]


def wheel_url(platform_tag):
    with urllib.request.urlopen(f"https://pypi.org/pypi/ziglang/{VERSION}/json") as r:
        meta = json.load(r)
    for f in meta["urls"]:
        if platform_tag in f["filename"]:
            return f["url"], f["filename"]
    sys.exit(f"no ziglang {VERSION} wheel for {platform_tag}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", choices=sorted(PLATFORMS))
    ap.add_argument("--wheel", help="use an already downloaded wheel")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.wheel:
        data = open(a.wheel, "rb").read()
    else:
        if not a.platform:
            sys.exit("give --platform or --wheel")
        url, name = wheel_url(PLATFORMS[a.platform])
        print("downloading", name)
        with urllib.request.urlopen(url) as r:
            data = r.read()
    z = zipfile.ZipFile(io.BytesIO(data))
    out = os.path.abspath(a.out)
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    n = 0
    for info in z.infolist():
        name = info.filename
        if not name.startswith("ziglang/") or info.is_dir():
            continue
        rel = name[len("ziglang/"):]
        if rel in ("zig", "zig.exe", "LICENSE"):
            pass
        elif rel.startswith("lib/"):
            top = rel.split("/")[1]
            if top not in KEEP_LIB:
                continue
            if top == "include" and rel.count("/") > 2:
                continue  # cuda/openmp/ppc wrapper subfolders
        else:
            continue
        dest = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with z.open(info) as src, open(dest, "wb") as dst:
            shutil.copyfileobj(src, dst)
        n += 1
    for exe in ("zig", "zig.exe"):
        p = os.path.join(out, exe)
        if os.path.exists(p):
            os.chmod(p, os.stat(p).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
    print(f"installed {n} files ({size / 1e6:.0f} MB) into {out}")


if __name__ == "__main__":
    main()
