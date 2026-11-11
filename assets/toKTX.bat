@echo off

if "%1"=="8" (
    set "RES=8192"
)
if "%1"=="4" (
    set "RES=4096"
)
if "%1"=="2" (
    set "RES=2048"
)
if "%1"=="1" (
    set "RES=1024"
)

ktx create --format R16G16B16_SFLOAT --raw --width %RES% --height %RES% --encode uastc-hdr-4x4 --zstd 20 lightmap_%~2_%~1K.raw lightmap_%~2_%~1K.ktx2