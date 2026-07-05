import js from "@eslint/js"
import globals from "globals"
import prettier from "eslint-config-prettier"

export default [
  { ignores: ["node_modules/**", "assets/cards/**", ".vercel/**"] },

  js.configs.recommended,

  // Server entry — CommonJS, Node globals.
  {
    files: ["main.js", "src/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: "latest",
      globals: { ...globals.node },
    },
  },

  // Build / admin scripts — ESM, Node globals, top-level await.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      globals: { ...globals.node },
    },
  },

  // Browser helper served to the LIFF pages, plus the admin dashboard's client JS.
  {
    files: ["assets/**/*.js", "admin/**/*.js"],
    languageOptions: {
      sourceType: "script",
      ecmaVersion: "latest",
      globals: { ...globals.browser },
    },
  },

  // Turn off rules that conflict with Prettier formatting.
  prettier,
]
