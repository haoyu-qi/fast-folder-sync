const { build } = require('./package.json');
module.exports = {
  ...build,
  directories: { output: 'release/mac-glass' },
  files: [...build.files, 'mac/**'],
  artifactName: 'Fast-Folder-Sync-${version}-macOS-${arch}.${ext}',
  mac: {
    category: 'public.app-category.utilities',
    icon: 'mac/icon.icns',
    target: [{ target: 'zip', arch: ['arm64', 'x64'] }],
    darkModeSupport: true,
    extendInfo: { NSHighResolutionCapable: true }
  }
};
