// Locate a C++17 compiler for the C++ contract suites and build programs with it.
//
// Order: `CXX` from the environment, then g++ / clang++ on PATH, then (Windows)
// MSVC through vswhere + vcvars64.bat. No compiler means the suites skip with
// that reason stated — the runtime cannot be exercised without one. Warnings
// are errors on every compiler, so a runtime change that warns fails here.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type CppBuild = { readonly executable: string } | { readonly unavailable: string };

/** What to compile: one program from several sources, with extra include directories. */
export type CppProgram = {
  readonly sources: readonly string[];
  readonly includeDirs?: readonly string[];
  readonly outDir: string;
  readonly name: string;
};

const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
const CRLF = '\r\n';

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

/** Compile a program; a compile error throws (it is a real failure, not a skip). */
export function buildProgram(program: CppProgram): CppBuild {
  const { sources, includeDirs = [], outDir, name } = program;
  const exe = join(outDir, process.platform === 'win32' ? `${name}.exe` : name);
  const gnu = process.env.CXX || ['g++', 'clang++'].find(onPath);
  if (gnu) {
    const includes = includeDirs.flatMap((dir) => ['-I', dir]);
    report(spawnSync(gnu, ['-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', ...includes, ...sources, '-o', exe], { encoding: 'utf8' }), gnu);
    return { executable: exe };
  }
  const vcvars = msvcVcvars();
  if (vcvars) {
    const objects = join(outDir, `obj-${name}`);
    const script = join(outDir, `build-${name}.cmd`);
    const includes = includeDirs.map((dir) => `/I"${dir}"`).join(' ');
    const files = sources.map((source) => `"${source}"`).join(' ');
    // cmd.exe needs the environment vcvars sets, so the compile runs inside one batch file.
    // `/Fo` names a directory by its trailing separator; it is created first.
    const lines = [
      '@echo off',
      `if not exist "${objects}" mkdir "${objects}"`,
      `call "${vcvars}" >nul`,
      `cl /nologo /std:c++17 /EHsc /W4 /WX /utf-8 ${includes} ${files} /Fe:"${exe}" /Fo:"${objects}/"`,
    ];
    writeFileSync(script, `${lines.join(CRLF)}${CRLF}`);
    report(spawnSync('cmd.exe', ['/d', '/c', script], { encoding: 'utf8', cwd: outDir }), 'cl');
    return { executable: exe };
  }
  return { unavailable: 'no C++17 compiler (CXX, g++, clang++ or MSVC) on this host' };
}

/** Compile the runtime driver into `outDir`. */
export function buildDriver(source: string, outDir: string): CppBuild {
  return buildProgram({ sources: [source], outDir, name: 'driver' });
}
