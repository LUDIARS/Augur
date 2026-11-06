// Locate a C++17 compiler for the C++ contract runtime suite and build the driver.
//
// Order: `CXX` from the environment, then g++ / clang++ on PATH, then (Windows)
// MSVC through vswhere + vcvars64.bat. No compiler means the suite is skipped
// with that reason stated — the runtime cannot be exercised without one.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type CppBuild = { readonly executable: string } | { readonly unavailable: string };

const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';

function onPath(command: string): boolean {
  return spawnSync(command, ['--version'], { stdio: 'ignore', shell: false }).status === 0;
}

function msvcVcvars(): string | null {
  if (process.platform !== 'win32' || !existsSync(VSWHERE)) return null;
  const install = execFileSync(VSWHERE, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath',
  ], { encoding: 'utf8' }).trim();
  const vcvars = join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  return install !== '' && existsSync(vcvars) ? vcvars : null;
}

function report(result: ReturnType<typeof spawnSync>, what: string): void {
  if (result.status !== 0) {
    throw new Error(`${what} failed:\n${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`);
  }
}

/** Compile `source` into `outDir`; a compile error throws (it is a real failure, not a skip). */
export function buildDriver(source: string, outDir: string): CppBuild {
  const exe = join(outDir, process.platform === 'win32' ? 'driver.exe' : 'driver');
  const gnu = process.env.CXX || ['g++', 'clang++'].find(onPath);
  if (gnu) {
    report(spawnSync(gnu, ['-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', source, '-o', exe], { encoding: 'utf8' }), gnu);
    return { executable: exe };
  }
  const vcvars = msvcVcvars();
  if (vcvars) {
    const script = join(outDir, 'build.cmd');
    // cmd.exe needs the environment vcvars sets, so the compile runs inside one batch file.
    const lines = [
      '@echo off',
      `call "${vcvars}" >nul`,
      `cl /nologo /std:c++17 /EHsc /W4 /WX /utf-8 "${source}" /Fe:"${exe}" /Fo:"${join(outDir, 'driver.obj')}"`,
    ];
    writeFileSync(script, `${lines.join('\r\n')}\r\n`);
    report(spawnSync('cmd.exe', ['/d', '/c', script], { encoding: 'utf8', cwd: outDir }), 'cl');
    return { executable: exe };
  }
  return { unavailable: 'no C++17 compiler (CXX, g++, clang++ or MSVC) on this host' };
}
