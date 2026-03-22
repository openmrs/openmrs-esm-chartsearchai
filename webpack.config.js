const defaultConfig = require('openmrs/default-webpack-config');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

module.exports = (env) => {
  const config = defaultConfig(env);

  // Replace the ForkTsCheckerWebpackPlugin to exclude node_modules from
  // type checking. The OpenMRS framework ships .ts source files which
  // contain errors under strict mode that are not our concern.
  config.plugins = config.plugins.map((plugin) => {
    if (plugin instanceof ForkTsCheckerWebpackPlugin) {
      return new ForkTsCheckerWebpackPlugin({
        ...plugin.options,
        issue: {
          ...plugin.options?.issue,
          exclude: [...(plugin.options?.issue?.exclude ?? []), { origin: 'typescript', file: '**/node_modules/**' }],
        },
      });
    }
    return plugin;
  });

  return config;
};
