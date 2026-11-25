import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.resolve(appRoot, '..', 'android-sdk');
const buildToolsVersion = process.env.ANDROID_BUILD_TOOLS_VERSION || '36.1.0';
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gradle = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} terminó con código ${result.status}`);
}

if (!sdk || !existsSync(sdk)) throw new Error('Configura ANDROID_HOME o ANDROID_SDK_ROOT con tu Android SDK');
await mkdir(path.join(appRoot, 'release'), { recursive: true });
run(npm, ['run', 'android:sync'], { cwd: appRoot });
run(path.join(appRoot, 'android', gradle), ['assembleRelease', '--no-daemon'], { cwd: path.join(appRoot, 'android') });

const signedApk = path.join(appRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(signedApk)) {
  throw new Error('La release no quedó firmada. Configura las variables FOLIO_ANDROID_* o app/android/keystore.properties.');
}
const finalApk = path.join(appRoot, 'release', `Folio-${version}-Android.apk`);
await copyFile(signedApk, finalApk);

const apksigner = path.join(sdk, 'build-tools', buildToolsVersion, 'lib', 'apksigner.jar');
if (existsSync(apksigner)) {
  const javaHome = process.env.JAVA_HOME;
  if (!javaHome) throw new Error('Configura JAVA_HOME para verificar la firma del APK');
  const javaBinary = process.platform === 'win32' ? 'java.exe' : 'java';
  run(path.join(javaHome, 'bin', javaBinary), ['-jar', apksigner, 'verify', '--verbose', finalApk]);
}

const bytes = await readFile(finalApk);
const hash = createHash('sha256').update(bytes).digest('hex').toUpperCase();
await writeFile(path.join(appRoot, 'release', `Folio-${version}-Android.sha256.json`), JSON.stringify({
  file: path.basename(finalApk), bytes: bytes.byteLength, sha256: hash,
}, null, 2));
console.log(`APK release: ${path.basename(finalApk)} (${bytes.byteLength} bytes)`);
console.log(`SHA-256: ${hash}`);
