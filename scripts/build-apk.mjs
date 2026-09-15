/**
 * Builds the signed Android app.
 *
 *   npm run mobile:apk
 *
 * Syncs the Capacitor config and plugins into the Android project, runs
 * Gradle's release build, and copies the result to release/Kayv-<version>.apk
 * with a name that says what it is — Gradle's own is app-release.apk, deep in
 * a build folder.
 *
 * Needs a JDK (JAVA_HOME) and the Android SDK (ANDROID_HOME). Needs
 * android/keystore.properties too; without it the APK would be unsigned and
 * no phone would install it, so this stops before spending minutes on Gradle.
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const android = join(root, "android");

if (!existsSync(join(android, "keystore.properties"))) {
  console.error(
    "android/keystore.properties is missing, so the APK cannot be signed.\n" +
      "Restore the key from your backup — see SETUP-ANDROID.md.",
  );
  process.exit(1);
}

const run = (command, cwd = root) =>
  execSync(command, { cwd, stdio: "inherit", shell: true });

run("npx cap sync android");
run(
  process.platform === "win32"
    ? // A path, not a bare name: cmd may be set not to look in the
      // current folder for commands.
      `"${join(android, "gradlew.bat")}" assembleRelease`
    : "./gradlew assembleRelease",
  android,
);

const gradle = readFileSync(join(android, "app", "build.gradle"), "utf8");
const version = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? "dev";

const built = join(android, "app", "build", "outputs", "apk", "release", "app-release.apk");
const out = join(root, "release");
mkdirSync(out, { recursive: true });

const target = join(out, `Kayv-${version}.apk`);
copyFileSync(built, target);
console.log(`\nSigned APK: ${target}`);
