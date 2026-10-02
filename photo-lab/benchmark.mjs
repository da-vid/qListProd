import { spawnSync } from "node:child_process";
import { writeFile, mkdir, stat } from "node:fs/promises";
const results = [];
for (const name of ["gradient", "noise", "portrait"]) {
  const child = spawnSync(
    process.execPath,
    ["photo-lab/bench-worker.ts", `photo-lab/fixtures/${name}.jpg`],
    { encoding: "utf8", timeout: 30000, maxBuffer: 100000 },
  );
  if (child.status !== 0) {
    console.log(
      JSON.stringify({
        fixture: name,
        status: "worker failed",
        exitCode: child.status,
      }),
    );
    process.exit(1);
  }
  const result = JSON.parse(child.stdout);
  if (
    result.measures.some(
      (m) =>
        m.status !== "passed" &&
        !(name === "noise" && m.status.includes("too complex")),
    )
  ) {
    console.log(
      JSON.stringify({
        fixture: name,
        status: "unexpected rejection",
        reason: result.measures.find((m) => m.status !== "passed").status,
      }),
    );
    process.exit(1);
  }
  results.push(result);
}
const samples = results
  .flatMap((r) => r.measures.slice(1).map((m) => m.cpuMs))
  .sort((a, b) => a - b);
const report = {
  runtime: process.version,
  platform: process.platform,
  architecture: process.arch,
  wasmBytes: (
    await stat(
      "photo-lab/node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm",
    )
  ).size,
  hostedTestPerformed: false,
  coldMaxCpuMs: Math.max(...results.map((r) => r.measures[0].cpuMs)),
  warmP95CpuMs: samples[Math.ceil(samples.length * 0.95) - 1],
  maxRSSMiB: Math.max(...results.map((r) => r.maxRSSMiB)),
  results,
};
await mkdir("photo-lab/results", { recursive: true });
await writeFile(
  "photo-lab/results/benchmark.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
