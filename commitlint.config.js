module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0], // Disables the subject-case rule
    'body-max-line-length': [0], // Disables the body-max-line-length rule
    'body-leading-blank': [0], // Disables the body-leading-blank rule
    'header-max-length': [2, 'always', 150] // Sets the maximum header length to 150 characters
  }
};
