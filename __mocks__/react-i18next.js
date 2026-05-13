const reactI18next = require('react-i18next');

module.exports = {
  ...reactI18next,
  useTranslation: () => ({
    t: (key, defaultValue) => defaultValue ?? key,
    i18n: { language: 'en' },
  }),
};
