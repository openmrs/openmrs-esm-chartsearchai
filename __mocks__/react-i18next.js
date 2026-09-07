const reactI18next = require('react-i18next');

// Substitutes i18next's {{name}} placeholders from the options object, so a test asserting an
// interpolated string sees what the user sees ("Interaction pairs shown: 5 of 5.") rather than
// the raw template. Nothing else about i18next's interpolation is emulated.
function interpolate(text, options) {
  if (!options || typeof text !== 'string') return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (name in options ? String(options[name]) : match));
}

module.exports = {
  ...reactI18next,
  useTranslation: () => ({
    t: (key, defaultValue, options) => interpolate(defaultValue ?? key, options),
    i18n: { language: 'en' },
  }),
};
