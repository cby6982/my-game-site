#!/usr/bin/env python3
"""
重新產生 assets/fonts/ 的 Noto Sans TC 字型

網站把 Noto Sans TC 裁切成「只包含實際用到的字」以縮小檔案（每字重約 78 KB），
並另外產生一個只含全形標點與箭頭的迷你字型（約 2 KB）。

只要新增或修改中文文案，就要重跑這支腳本，否則新字會退回系統字型。

需要：
    pip install fonttools brotli
    npm install --no-save @fontsource/noto-sans-tc@5.3.1   # 取得原始字型

用法：
    python3 tools/subset-fonts.py
"""

import os
import sys
from pathlib import Path

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "fonts"
WEIGHTS = (400, 500, 700, 900)

SRC_MAIN = "noto-sans-tc-chinese-traditional-{w}-normal.woff2"

TEXT_FILES = ["index.html"] + sorted(
    str(p.relative_to(ROOT)) for p in (ROOT / "js").rglob("*.js")
)

# 除了頁面用到的字，再補齊 ASCII，避免動態文字缺字
EXTRA = "".join(chr(c) for c in range(0x20, 0x7F))

# Noto Sans TC 的「chinese-traditional」subset 不含下列全形標點與符號，
# 這些字要另外做成一個 unicode-range 限定的迷你字型。
# 對應 CSS 中的 "Neon Symbols" @font-face。
SYMBOLS = "←→↔◆♥！（），：；？｜＃％＆＊＋－／"


def collect_chars() -> set[str]:
    chars: set[str] = set(EXTRA)
    for rel in TEXT_FILES:
        chars.update(
            c for c in (ROOT / rel).read_text(encoding="utf-8") if ord(c) > 0x2000
        )
    return chars


def find_source_root() -> Path:
    """找出 @fontsource/noto-sans-tc 安裝在哪裡。"""
    for base in (Path.cwd(), ROOT, Path.home()):
        candidate = base / "node_modules" / "@fontsource" / "noto-sans-tc" / "files"
        if candidate.is_dir():
            return candidate
    sys.exit(
        "找不到 @fontsource/noto-sans-tc。請先執行：\n"
        "    npm install --no-save @fontsource/noto-sans-tc@5.3.1"
    )


def build_weights(src_root: Path, unicodes: list[int]) -> None:
    """裁切 400/500/700/900 四個字重。"""
    for weight in WEIGHTS:
        src = src_root / SRC_MAIN.format(w=weight)
        out = OUT_DIR / f"noto-sans-tc-{weight}.woff2"
        subset.main(
            [
                str(src),
                f"--output-file={out}",
                "--flavor=woff2",
                "--unicodes=" + ",".join(f"U+{u:04X}" for u in unicodes),
                "--layout-features=kern,liga,lnum,tnum",
                "--no-hinting",
                "--desubroutinize",
                "--drop-tables+=DSIG",
            ]
        )

        check = TTFont(out).getBestCmap()
        missing = [c for c in unicodes if c not in check]
        print(
            f"  {out.name}: {os.path.getsize(out) // 1024} KB"
            f"，缺少 {len(missing)} 字"
        )


def build_symbols(src_root: Path) -> None:
    """
    建立只含全形標點與箭頭的迷你字型。
    做法：找出含有這些字的編號 subset，各自裁切所需的字，再用 Merger 合併。
    （不要事後手動改 glyf，會讓字型無法被瀏覽器解析）
    """
    needed = {ord(c) for c in SYMBOLS}
    pieces: list[Path] = []

    for weight in WEIGHTS:
        for src_path in sorted(src_root.glob(f"noto-sans-tc-*-{weight}-normal.woff2")):
            stem = src_path.name[len("noto-sans-tc-") : -len(f"-{weight}-normal.woff2")]
            if not stem.isdigit():
                continue
            try:
                cmap = TTFont(src_path).getBestCmap()
            except Exception:
                continue
            have = sorted(cp for cp in needed if cp in cmap)
            if not have:
                continue
            piece = Path(f"/tmp/neon-symbol-{weight}-{stem}.woff2")
            subset.main(
                [
                    str(src_path),
                    f"--output-file={piece}",
                    "--flavor=woff2",
                    "--unicodes=" + ",".join(f"U+{cp:04X}" for cp in have),
                ]
            )
            pieces.append(piece)
        if pieces:
            break  # 一個字重就足夠，符號字形各字重差異不大

    if not pieces:
        print("  ! 找不到符號來源 subset，略過 symbols 字型")
        return

    merged = Merger().merge([str(p) for p in pieces])
    out = OUT_DIR / "noto-sans-tc-symbols.woff2"
    merged.flavor = "woff2"
    merged.save(out)

    check = TTFont(out).getBestCmap()
    missing = [c for c in SYMBOLS if ord(c) not in check]
    print(
        f"  {out.name}: {os.path.getsize(out) // 1024} KB"
        f"，缺少 {len(missing)} 字"
    )


def main() -> None:
    src_root = find_source_root()
    chars = sorted(collect_chars())
    unicodes = sorted({ord(c) for c in chars})
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"字元數：{len(unicodes)}")
    build_weights(src_root, unicodes)
    build_symbols(src_root)
    print("完成。記得一起提交 assets/fonts/ 的變更。")


if __name__ == "__main__":
    main()
