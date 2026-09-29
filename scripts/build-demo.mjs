// Builds a single-file static demo (no server, no database) into dist-demo/ledgerlens-demo.html.
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const common = { bundle: true, write: false, format: "iife", target: "es2020", platform: "browser", minify: true, legalComments: "none" };
const backend = await build({
  ...common, entryPoints: [`${root}packages/api/demo/backend.ts`], loader: { ".csv": "text" },
  alias: {
    "node:crypto": `${root}packages/api/demo/shims/crypto.ts`,
    "@anthropic-ai/sdk": `${root}packages/api/demo/shims/empty.ts`,
    "@ledgerlens/core": `${root}packages/api/demo/shims/core.ts`,
    "csv-parse/sync": `${root}node_modules/csv-parse/dist/esm/sync.js`,
  },
});
const app = await build({ ...common, entryPoints: [`${root}packages/api/public/app.js`] });
const css = readFileSync(`${root}packages/api/public/app.css`, "utf8");
const html = readFileSync(`${root}packages/api/public/index.html`, "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).trim();
const safe = (js) => js.replace(/<\/script/gi, "<\\/script");
const out = `<title>LedgerLens</title>
<style>${css}</style>
${body}
<script>${safe(backend.outputFiles[0].text)}</script>
<script>${safe(app.outputFiles[0].text)}</script>
`;
mkdirSync(`${root}dist-demo`, { recursive: true });
writeFileSync(`${root}dist-demo/ledgerlens-demo.html`, out);
console.log(`dist-demo/ledgerlens-demo.html ${(out.length / 1024).toFixed(0)} KB`);
