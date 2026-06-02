#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

import UnityPy


def parse_args():
    parser = argparse.ArgumentParser(description="Extract Eco item icons from the Unity icon AssetBundle.")
    parser.add_argument("--eco-path", help="Eco installation path, for example C:\\Program Files (x86)\\Steam\\steamapps\\common\\Eco")
    parser.add_argument("--bundle", help="Explicit icons_assets_all_*.bundle path")
    parser.add_argument("--out", default="outputs/assets/eco-icons", help="Output directory for PNG icons")
    parser.add_argument("--skip-existing", action="store_true", help="Do not overwrite existing PNG files")
    return parser.parse_args()


def find_icon_bundle(eco_path):
    if not eco_path:
        return None

    bundle_dir = Path(eco_path) / "Eco_Data" / "StreamingAssets" / "aa" / "StandaloneWindows64"
    bundles = sorted(bundle_dir.glob("icons_assets_all_*.bundle"))
    return bundles[0] if bundles else None


def safe_icon_name(name):
    return "".join("_" if char in '<>:"/\\|?*' else char for char in name).strip()


def main():
    args = parse_args()
    bundle_path = Path(args.bundle) if args.bundle else find_icon_bundle(args.eco_path)
    if not bundle_path or not bundle_path.exists():
        raise SystemExit("Icon bundle not found. Pass --eco-path or --bundle.")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    env = UnityPy.load(str(bundle_path))
    exported = 0
    skipped = 0
    failed = []

    for obj in env.objects:
        if obj.type.name != "Sprite":
            continue

        sprite = obj.read()
        icon_name = safe_icon_name(getattr(sprite, "m_Name", "") or "")
        if not icon_name:
            skipped += 1
            continue

        output_path = out_dir / f"{icon_name}.png"
        if args.skip_existing and output_path.exists():
            skipped += 1
            continue

        try:
            image = sprite.image
            image.save(output_path)
            exported += 1
        except Exception as error:
            failed.append({"name": icon_name, "error": str(error)})

    manifest = {
        "sourceBundle": str(bundle_path),
        "exported": exported,
        "skipped": skipped,
        "failed": failed,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")

    print(f"Icon bundle: {bundle_path}")
    print(f"Output: {out_dir.resolve()}")
    print(f"Exported: {exported}")
    print(f"Skipped: {skipped}")
    print(f"Failed: {len(failed)}")


if __name__ == "__main__":
    main()
