module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Required by react-native-reanimated and must stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};
