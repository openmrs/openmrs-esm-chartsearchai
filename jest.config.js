module.exports = {
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
    '^.+\\.mjs$': ['@swc/jest'],
  },
  transformIgnorePatterns: ['/node_modules/(?!@openmrs|dexie)'],
  moduleNameMapper: {
    '\\.(s?css)$': 'identity-obj-proxy',
    '@openmrs/esm-framework': '@openmrs/esm-framework/mock',
    'lodash-es': 'lodash',
    '^dexie$': require.resolve('dexie'),
  },
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
};
