import { readFile } from "node:fs/promises";
import { processPhoto } from "./processor.ts";
const data = new Uint8Array(await readFile(process.argv[2]));
const measures = [];
let fullBytes = 0,
  thumbnailBytes = 0;
for (let i = 0; i < 12; i++) {
  const cpu = process.cpuUsage(),
    wall = performance.now();
  let status = "passed";
  try {
    const out = await processPhoto(data);
    fullBytes = out.full.length;
    thumbnailBytes = out.thumbnail.length;
  } catch (e) {
    status = e instanceof Error ? e.message : "rejected";
  }
  const elapsed = process.cpuUsage(cpu);
  measures.push({
    cpuMs: (elapsed.user + elapsed.system) / 1000,
    wallMs: performance.now() - wall,
    status,
  });
}
console.log(
  JSON.stringify({
    fixture: process.argv[2],
    inputBytes: data.length,
    fullBytes,
    thumbnailBytes,
    measures,
    maxRSSMiB: process.resourceUsage().maxRSS / 1024,
    totalProcessCpuMs:
      (process.cpuUsage().user + process.cpuUsage().system) / 1000,
  }),
);
