const reactI18next = require('react-i18next');

// Substitutes i18next's {{name}} placeholders from the options object, so a test asserting an
// interpolated string sees what the user sees ("Interaction pairs shown: 5 of 5.") rather than
// the raw template. Nothing else about i18next's interpolation is emulated.
function interpolate(text, options) {
  if (!options || typeof text !== 'string') return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (name in options ? String(options[name]) : match));
}

// English plural selection, the one other piece of i18next the panel relies on: a call passing
// `count` reads its `_other` form — `defaultValue_other` where the call gives one — for any count but 1.
function pluralDefault(defaultValue, options) {
  if (options && typeof options.count === 'number' && options.count !== 1 && options.defaultValue_other) {
    return options.defaultValue_other;
  }
  return defaultValue;
}

module.exports = {
  ...reactI18next,
  useTranslation: () => ({
    t: (key, defaultValue, options) => interpolate(pluralDefault(defaultValue, options) ?? key, options),
    i18n: { language: 'en' },
  }),
};
