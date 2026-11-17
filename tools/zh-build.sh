#!/usr/bin/env bash
# 构建中文版 esp32sim:先用 apply-zh 生成 build-src,再交叉编译三个目标并打包。
# 用法:
#   tools/zh-build.sh [--out dist] [--no-smoke] [--targets "x86_64-unknown-linux-gnu ..."]
# 依赖: node >= 18、rustup、cargo、gcc-mingw-w64-x86-64、gcc-aarch64-linux-gnu
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT="$REPO/dist"
SMOKE=1
TARGETS="x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-pc-windows-gnu"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --no-smoke) SMOKE=0; shift ;;
    --targets) TARGETS="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

VERSION=$(tr -d '\r' < "$REPO/Cargo.toml" | sed -n 's/^version = "\(.*\)"$/\1/p' | head -1)
BUILD="$REPO/.build/build-src"
export CARGO_TARGET_DIR="$REPO/.build/target"

echo "== 生成 build-src(模式 B:上游 + 翻译) =="
OVL="$REPO/.build/overlay"
rm -rf "$OVL"; mkdir -p "$OVL/docs"
cp -r "$REPO/docs/zh" "$OVL/docs/zh"
node "$REPO/tools/apply-zh.mjs" --upstream "$REPO" --out "$BUILD" --strings "$REPO/zh/strings.json" --overlay "$OVL"

platform_name() {
  case "$1" in
    x86_64-unknown-linux-gnu) echo linux-x86_64 ;;
    aarch64-unknown-linux-gnu) echo linux-arm64 ;;
    x86_64-pc-windows-gnu) echo windows-x86_64 ;;
    *) echo "$1" ;;
  esac
}

mkdir -p "$OUT"
cd "$BUILD"

for t in $TARGETS; do
  echo "== 编译 $t =="
  case "$t" in
    aarch64-unknown-linux-gnu)
      # rustc 自带的 rust-lld 在交叉到 arm64 时会不接受 --fix-cortex-a53-843419,改用 bfd
      CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
      RUSTFLAGS="-C link-arg=-fuse-ld=bfd" \
      cargo build --release -p esp32sim --target "$t" ;;
    *) cargo build --release -p esp32sim --target "$t" ;;
  esac
done

for t in $TARGETS; do
  p=$(platform_name "$t")
  rel="$CARGO_TARGET_DIR/$t/release"
  pkg="esp32sim-$VERSION-zh-$p"
  work="$OUT/$pkg"
  rm -rf "$work"; mkdir -p "$work/docs" "$work/tools"

  for b in esp32sim esp32sim-c3 esp32sim-c6 esp32sim-p4 esp32sim-s31; do
    if [ "$t" = "x86_64-pc-windows-gnu" ]; then
      cp "$rel/$b.exe" "$work/$b.exe"
    else
      cp "$rel/$b" "$work/$b"
    fi
  done

  # 板子 UI:--web 需要它;不含演示固件(体积大,且用户自备)
  cp -r "$BUILD/web" "$work/web" 2>/dev/null || true
  rm -rf "$work/web/wasm/fw/public" 2>/dev/null || true

  cp "$REPO/LICENSE" "$work/" 2>/dev/null || true
  cp "$BUILD/README.md" "$work/" 2>/dev/null || true
  cp "$BUILD/docs/zh/"*.md "$work/docs/" 2>/dev/null || true
  cp "$BUILD/tools/fetch-rom-elfs.sh" "$work/tools/" 2>/dev/null || true

  tar -czf "$OUT/$pkg.tar.gz" -C "$OUT" "$pkg"
  rm -rf "$work"
  echo "  打包: $OUT/$pkg.tar.gz"
done

cd "$OUT"
sha256sum ./*.tar.gz > SHA256SUMS.txt
cat SHA256SUMS.txt

if [ "$SMOKE" = "1" ]; then
  echo "== 冒烟(linux-x86_64 真跑) =="
  exe="$CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/release/esp32sim"
  "$exe" --version
  "$exe" --help 2>&1 | head -1 | grep -q '^usage:' && echo "  --help ok"
  set +e
  "$exe" --adc x >/dev/null 2>&1; code=$?
  set -e
  [ "$code" = "2" ] && echo "  错误退出码 ok" || { echo "  错误退出码异常: $code" >&2; exit 1; }

  # 用仓库自带的 hello_world 固件跑一次(需要 mask ROM)
  FW="$REPO/web/wasm/fw/public"
  ROMS="$REPO/roms"
  if [ ! -f "$ROMS/esp32s3_rev0_rom.elf" ]; then
    echo "  跳过固件冒烟:没找到 mask ROM(先跑 tools/fetch-rom-elfs.sh roms)"
  else
    out=$(ESP32SIM_ROM_DIR="$ROMS" "$exe" --boot rom --board none --console uart0 \
      --bootloader "$FW/hello-bootloader.bin" --ptable "$FW/hello-ptable.bin" \
      --app "$FW/hello_world.bin" --max-seconds 3 --no-dump 2>/dev/null || true)
    echo "$out" | grep -q 'Hello world!' && echo "  hello_world ok" || { echo "  hello_world 失败" >&2; exit 1; }
  fi

  echo "== 交叉产物静态检查 =="
  for t in $TARGETS; do
    case "$t" in
      x86_64-pc-windows-gnu) f="$CARGO_TARGET_DIR/$t/release/esp32sim.exe" ;;
      *) f="$CARGO_TARGET_DIR/$t/release/esp32sim" ;;
    esac
    [ -f "$f" ] && file "$f" | sed 's/^/  /'
  done
fi

echo "完成:$VERSION,产物在 $OUT"
