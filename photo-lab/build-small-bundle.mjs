import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "vite";
const root = new URL("./", import.meta.url),
  generated = new URL("./generated-small/", root);
await mkdir(generated, { recursive: true });
const digest = (b) => createHash("sha256").update(b).digest("hex");
const dec = await readFile(
    new URL("./node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm", root),
  ),
  enc = await readFile(
    new URL("./node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm", root),
  );
if (
  digest(dec) !==
    "a7c4b12169817e779ff4af137981393ae924944e167ad1bd95747c9199162d3e" ||
  digest(enc) !==
    "24d4177f1c4963e2058b107189249651c61fdef125570e79b1dfb63c8bb49326"
)
  throw new Error("Pinned WASM bytes changed");
const source = `import {createSmallProcessor} from "../small-codec.ts";\nconst fromBase64=s=>Uint8Array.from(atob(s), c=>c.charCodeAt(0));\nexport async function initialize(){return createSmallProcessor(fromBase64(${JSON.stringify(dec.toString("base64"))}),fromBase64(${JSON.stringify(enc.toString("base64"))}));}\n`;
await writeFile(new URL("entry.js", generated), source);
await build({
  configFile: false,
  logLevel: "error",
  build: {
    outDir: new URL("bundle", generated).pathname,
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: new URL("entry.js", generated).pathname,
      formats: ["es"],
      fileName: () => "codec.js",
    },
  },
});
const output = await readFile(new URL("bundle/codec.js", generated));
if (output.length >= 1_500_000) throw new Error("Unexpected package growth");
// Runtime fetch is intentionally made unavailable during the packaged smoke test.
const oldFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("Unexpected runtime network access");
};
try {
  const { initialize } = await import(new URL("bundle/codec.js", generated));
  const processor = await initialize();
  const result = await processor(
    await readFile(new URL("fixtures/gradient.jpg", root)),
  );
  if (result.width !== 1280) throw new Error("Bundle smoke test failed");
} finally {
  globalThis.fetch = oldFetch;
}
const report = {
  package: "@jsquash/jpeg",
  version: "1.6.0",
  decoderBytes: dec.length,
  encoderBytes: enc.length,
  textBundleBytes: output.length,
  bundleSha256: digest(output),
  runtimeBinaryFetch: false,
  smokeTest: "passed",
  hostedDeploymentTested: false,
};
const fixtures = {};
for (const name of ["gradient", "portrait", "noise"])
  fixtures[name] = (
    await readFile(new URL(`fixtures/${name}.jpg`, root))
  ).toString("base64");
const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
const entry = `import {initialize} from './codec.js';\nimport {createBenchmarkHandler} from './handler.ts';\nimport {fixtures} from './fixtures.js';\nexport default {fetch:createBenchmarkHandler({adminKey:()=>Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),initialize,fixtures,expiresAt:${expiresAt},memory:()=>{try{return Deno.memoryUsage();}catch{return null;}}})};\n`;
const files = [
  { name: "index.ts", content: entry },
  { name: "codec.js", content: output.toString() },
  {
    name: "handler.ts",
    content: await readFile(new URL("benchmark-handler.ts", root), "utf8"),
  },
  {
    name: "fixtures.js",
    content: `export const fixtures=${JSON.stringify(fixtures)};\n`,
  },
  {
    name: "LICENSE",
    content: await readFile(
      new URL("node_modules/@jsquash/jpeg/LICENSE", root),
      "utf8",
    ),
  },
  {
    name: "LICENSE.codec.md",
    content: await readFile(
      new URL("node_modules/@jsquash/jpeg/codec/LICENSE.codec.md", root),
      "utf8",
    ),
  },
];
const payload = {
  project_id: "qmpdinzendwpkqhtqskz",
  name: "qlist-photo-benchmark",
  verify_jwt: true,
  entrypoint_path: "index.ts",
  files,
};
const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
if (payloadBytes > 3_000_000) throw new Error("Unexpected payload growth");
await writeFile(
  new URL("deploy-payload.json", generated),
  JSON.stringify(payload),
);
report.deploymentPayloadBytes = payloadBytes;
report.benchmarkExpiresAt = new Date(expiresAt).toISOString();
await writeFile(
  new URL("results/small-codec-packaging.json", root),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
