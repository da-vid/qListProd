import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { digest, sha, insist } from "./migration-core.mjs";
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
insist(
  !execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  "clean-tree-required",
);
const artifacts = {};
for (const variant of ["modern", "maintenance", "rollback"]) {
  const base = `release-artifacts/${variant}`;
  const bytes = await readFile(`${base}/release.json`);
  const manifest = JSON.parse(bytes);
  insist(
    manifest.commit === commit &&
      !manifest.dirty &&
      manifest.variant === variant,
    "clean-rebuild-required",
  );
  for (const [file, checksum] of Object.entries(manifest.files))
    insist(
      sha(await readFile(`${base}/${file}`)) === checksum,
      "artifact-bytes-changed",
    );
  artifacts[variant] = sha(bytes);
}
const review = {
  commit,
  candidateRulesSHA256: digest(
    JSON.parse(await readFile("candidate/database.rules.json", "utf8")),
  ),
  artifacts,
};
await writeFile(
  "release-artifacts/review.json",
  JSON.stringify(review, null, 2) + "\n",
);
console.log(JSON.stringify(review));
