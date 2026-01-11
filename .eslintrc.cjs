module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  overrides: [
    {
      files: ["packages/runtime/src/core/**/*.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector: "CallExpression[callee.property.name='querySelector']",
            message: "Use IR + getElementById; querySelector is banned in runtime-core."
          },
          {
            selector: "CallExpression[callee.property.name='querySelectorAll']",
            message: "Use IR + getElementById; querySelectorAll is banned in runtime-core."
          },
          {
            selector: "CallExpression[callee.property.name='closest']",
            message: "Use IR + getElementById; closest is banned in runtime-core."
          },
          {
            selector: "CallExpression[callee.property.name='matches']",
            message: "Use IR + getElementById; matches is banned in runtime-core."
          },
          {
            selector: "CallExpression[callee.property.name=/^getElementsBy/]",
            message: "Use IR + getElementById; getElementsBy* is banned in runtime-core."
          },
          {
            selector: "CallExpression[callee.property.name='getAttribute']",
            message: "Use IR + getElementById; getAttribute is banned in runtime-core."
          },
          {
            selector: "CallExpression[callee.property.name='hasAttribute']",
            message: "Use IR + getElementById; hasAttribute is banned in runtime-core."
          }
        ]
      }
    }
  ]
};
