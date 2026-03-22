const reactI18next = jest.createMockFromModule('react-i18next');
const useTranslation = () => ({
  t: (key, defaultValue) => defaultValue ?? key,
});
reactI18next.useTranslation = useTranslation;
module.exports = reactI18next;
