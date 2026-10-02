import { readFile, writeFile } from "node:fs/promises";
import { createSmallProcessor } from "./small-codec.ts";
const measurements = [];
const start = process.cpuUsage(),
  started = performance.now();
const processPhoto = await createSmallProcessor(
  await readFile(
    new URL(
      "./node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm",
      import.meta.url,
    ),
  ),
  await readFile(
    new URL(
      "./node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm",
      import.meta.url,
    ),
  ),
);
const initCpuMs =
    Object.values(process.cpuUsage(start)).reduce((a, b) => a + b, 0) / 1000,
  initWallMs = performance.now() - started;
for (let round = 0; round < 12; round++)
  for (const fixture of ["gradient", "portrait", "noise"]) {
    const data = await readFile(
      new URL(`./fixtures/${fixture}.jpg`, import.meta.url),
    );
    const cpu = process.cpuUsage(),
      wall = performance.now();
    let status = "passed",
      sizes;
    try {
      const p = await processPhoto(data);
      sizes = { full: p.full.length, thumbnail: p.thumbnail.length };
    } catch (e) {
      status = e.message;
      if (!status.includes("too complex")) throw e;
    }
    measurements.push({
      round,
      fixture,
      status,
      sizes,
      cpuMs:
        Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b, 0) / 1000,
      wallMs: performance.now() - wall,
    });
  }
const sorted = measurements
  .filter((m) => m.round > 0)
  .map((m) => m.cpuMs)
  .sort((a, b) => a - b);
const report = {
  runtime: process.version,
  platform: process.platform,
  architecture: process.arch,
  hostedTestPerformed: false,
  initCpuMs,
  initWallMs,
  maxRSSMiB: process.resourceUsage().maxRSS / 1024,
  warmP95CpuMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
  measurements,
};
await writeFile(
  new URL("./results/small-codec-benchmark.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { ...report, measurements: measurements.slice(0, 3) },
    null,
    2,
  ),
);
