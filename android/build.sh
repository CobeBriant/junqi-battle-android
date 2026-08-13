#!/usr/bin/env bash
# 离线构建脚本：无需 npm / gradle / 网络。
# 借助本地 Android SDK (build-tools + platform) 把 www/ 打包成可安装的签名 APK。
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="$HOME/android-sdk"
BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-34"
AAPT2="$BT/aapt2"
D8="$BT/d8"
ZIPALIGN="$BT/zipalign"
APKSIGNER="$BT/apksigner"
JAVAC="javac"
KEYTOOL="keytool"

BUILD="$ROOT/build"
APP="$ROOT/android/app"
PKG_DIR="$APP/src/com/junqi"
KS="$BUILD/release.keystore"
KS_PASS="junqi@2026"
ALIAS="junqi"

rm -rf "$BUILD"
mkdir -p "$BUILD"

# 1) 生成启动图标（靛蓝圆角底 + 白色棋子剪影）
python3 "$ROOT/android/gen_icon.py" "$APP/res/drawable/ic_launcher.png"

# 2) 编译 Java -> class
echo "== javac =="
"$JAVAC" -d "$BUILD/obj" -cp "$PLATFORM/android.jar" "$PKG_DIR/MainActivity.java"

# 3) class -> dex
echo "== d8 =="
rm -rf "$BUILD/dex"; mkdir -p "$BUILD/dex"
"$D8" --output "$BUILD/dex" $(find "$BUILD/obj" -name '*.class')
cp "$BUILD/dex/classes.dex" "$BUILD/classes.dex"

# 4) 资源编译 + 链接（生成不含代码/ assets 的底座 APK）
echo "== aapt2 compile/link =="
"$AAPT2" compile -o "$BUILD/res.flata" --dir "$APP/res"
"$AAPT2" link -o "$BUILD/base.apk" -I "$PLATFORM/android.jar" \
  --manifest "$APP/AndroidManifest.xml" -R "$BUILD/res.flata" \
  --auto-add-overlay --no-resource-deduping

# 5) 注入 assets/www 与 classes.dex
echo "== package assets + dex =="
STAGE="$BUILD/stage"
rm -rf "$STAGE"; mkdir -p "$STAGE/assets"
cp -R "$ROOT/www" "$STAGE/assets/www"
( cd "$STAGE" && zip -r -q "$BUILD/base.apk" . )
( cd "$BUILD" && zip -r -q base.apk classes.dex )

# 6) 对齐
echo "== zipalign =="
"$ZIPALIGN" -p 4 "$BUILD/base.apk" "$BUILD/aligned.apk"

# 7) 生成签名密钥（仅一次）
if [ ! -f "$KS" ]; then
  echo "== keytool (gen keystore) =="
  "$KEYTOOL" -genkeypair -v -keystore "$KS" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Junqi Dev, O=Junqi, C=CN"
fi

# 8) 签名
echo "== apksigner =="
"$APKSIGNER" sign --ks "$KS" --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$BUILD/junqi-release.apk" "$BUILD/aligned.apk"

echo "== DONE =="
ls -lh "$BUILD/junqi-release.apk"
"$APKSIGNER" verify -v "$BUILD/junqi-release.apk" | head -20
