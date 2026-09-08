#!/bin/sh
# omp 自解包壳（仅 Linux aarch64 发布包使用）。
#
# 为什么存在：omp 是 Go 编译的 arm64 二进制（64KB 页对齐），AppImage 打包时
# linuxdeploy 对 AppDir 内所有 ELF 无条件 patchelf --set-rpath，会把该二进制
# 打坏（patchelf 后 ldd 退出码 1、运行段错误；x64 不受影响）。本体因此以
# gzip 形式存为同目录 omp.gz（非 ELF，linuxdeploy 不扫描），首次运行时解包到
# 用户缓存再 exec。壳替代原二进制占据 binaries/omp 路径，调用方无感知。
#
# 注意：本脚本是 ACP stdio 链路的进程入口，stdout 一字节都不能多写
# （协议帧走 stdout）；解包输出一律落文件，报错只走 stderr。
set -eu

cache="${XDG_CACHE_HOME:-$HOME/.cache}/tod/bin"
real="$cache/omp-__OMP_VERSION__"

if [ ! -x "$real" ]; then
    mkdir -p "$cache"
    # mktemp 保证并发首跑各占唯一临时名（$$ 在部分 sh 里并发出重名）；
    # mv 同文件系统原子替换，读者要么见旧无文件（自行解包），要么见完整新文件
    tmp="$(mktemp "$cache/.omp.tmp.XXXXXX")"
    trap 'rm -f "$tmp"' EXIT
    gzip -dc "$(dirname "$0")/omp.gz" > "$tmp"
    chmod 755 "$tmp"
    mv -f "$tmp" "$real"
    # 清掉旧版本解包残留（保留当前版本）
    for f in "$cache"/omp-v*; do
        [ "$f" = "$real" ] || rm -f "$f"
    done
fi

exec "$real" "$@"
