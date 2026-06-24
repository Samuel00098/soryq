// Tailwind CSS v4 is wired in entirely through its PostCSS plugin — no
// tailwind.config.js needed; tokens/utilities are declared in src/app/globals.css
// via the `@theme` block.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
