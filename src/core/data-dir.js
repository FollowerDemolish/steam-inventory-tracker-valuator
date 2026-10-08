// Decides where Glasscase keeps its data.
//   1. Windows portable exe: next to the exe, in "Glasscase Data".
//   2. Linux AppImage: next to the .AppImage file, in "Glasscase Data".
//   3. Otherwise: Electron's per-user userData folder.

import path from 'node:path';

export const DATA_FOLDER_NAME = 'Glasscase Data';

export function resolveDataDir({ env = {}, userData, override = null }) {
  if (override) return { dir: path.resolve(override), mode: 'custom' };
  if (env.PORTABLE_EXECUTABLE_DIR) {
    return { dir: path.join(env.PORTABLE_EXECUTABLE_DIR, DATA_FOLDER_NAME), mode: 'portable-exe' };
  }
  if (env.APPIMAGE) {
    return { dir: path.join(path.dirname(env.APPIMAGE), DATA_FOLDER_NAME), mode: 'appimage' };
  }
  return { dir: userData, mode: 'user-data' };
}
