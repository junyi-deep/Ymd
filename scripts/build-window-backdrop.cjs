const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'dist', 'main')
const library = path.join(output, 'window-backdrop.dll')
const macLibrary = path.join(output, 'window-shadow.dylib')

function build() {
  mkdirSync(output, { recursive: true })
  const vswhere = path.join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  const visualStudio = existsSync(vswhere) && execFileSync(vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8' }).trim()
  if (!visualStudio) throw new Error('Install Visual Studio C++ Build Tools and a Windows 11 SDK to build the Windows backdrop.')
  const environment = path.join(visualStudio, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  const source = path.join(root, 'src', 'main', 'native')
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'ymd-backdrop-'))
  try {
    execFileSync('cmd.exe', ['/d', '/s', '/c',
      `"call "${environment}" && cl /nologo /std:c++20 /EHsc /O2 /MT /LD "${source}\\window-backdrop.cpp" "${source}\\window-shadow.cpp" /link /OUT:"${library}" dwmapi.lib coremessaging.lib windowsapp.lib user32.lib gdi32.lib"`,
    ], { cwd: temporary, windowsVerbatimArguments: true, stdio: 'inherit' })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (require.main === module && process.platform === 'win32') build()
if (require.main === module && process.platform === 'darwin') {
  mkdirSync(output, { recursive: true })
  execFileSync('xcrun', ['clang++', '-std=c++20', '-O2', '-dynamiclib', '-fobjc-arc', '-arch', 'arm64',
    '-framework', 'AppKit', '-framework', 'CoreGraphics', path.join(root, 'src', 'main', 'native', 'mac-window-shadow.mm'),
    '-o', macLibrary], { stdio: 'inherit' })
}

module.exports = ({ electronPlatformName }) => {
  if (electronPlatformName === 'darwin' && !existsSync(macLibrary)) {
    throw new Error('Build the macOS shadow library before packaging.')
  }
  if (electronPlatformName === 'win32' && !existsSync(library)) {
    throw new Error('Run the Windows build with Visual Studio C++ Build Tools and a Windows 11 SDK before packaging.')
  }
}
