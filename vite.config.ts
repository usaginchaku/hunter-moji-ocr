import { defineConfig } from "vite";

const configDirectory = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(
  /^\/([A-Za-z]:\/)/,
  "$1",
);

export default defineConfig({
  base: "/hunter-moji-ocr/",
  build: {
    rolldownOptions: {
      input: {
        main: `${configDirectory}index.html`,
        generator: `${configDirectory}generator.html`,
      },
    },
  },
});
