const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

// Expo SDK 52+ configures Metro for a monorepo on its own: the workspace root
// is watched and both `apps/mobile/node_modules` and the hoisted root
// `node_modules` are on the resolution path. `@kasir/shared` is a symlinked
// workspace package that ships TypeScript sources, which Metro compiles like
// any other file under a watched folder. No `watchFolders` / `nodeModulesPaths`
// overrides are needed — and adding them is what breaks upgrades.
const config = getDefaultConfig(__dirname);

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
});
