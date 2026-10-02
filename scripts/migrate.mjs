import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  stat,
  open,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  parseJSON,
  parseRules,
  sha,
  digest,
  insist,
  legacyTree,
  prepare,
  verifyCopy,
} from "./migration-core.mjs";
const repository = await realpath(
  fileURLToPath(new URL("..", import.meta.url)),
);
const endpoint = "https://qwiklist.firebaseio.com";
const project = "project-8156335338801733535";
const rules = parseJSON(
  await readFile(
    new URL("../candidate/database.rules.json", import.meta.url),
    "utf8",
  ),
);
const activeRules = parseJSON(
  await readFile(
    new URL("../candidate/current-active.rules.json", import.meta.url),
    "utf8",
  ),
);
const rulesSHA = digest(rules);
export async function privateDirectory(directory) {
  insist(path.isAbsolute(directory), "private-directory-must-be-absolute");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const resolved = await realpath(directory);
  insist(
    resolved !== repository && !resolved.startsWith(repository + path.sep),
    "private-directory-cannot-be-in-repository",
  );
  insist(
    (await stat(resolved)).mode % 512 === 0o700,
    "private-directory-needs-mode-0700",
  );
  return resolved;
}
async function writeExclusive(directory, name, value) {
  const handle = await open(path.join(directory, name), "wx", 0o600);
  try {
    await handle.writeFile(
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function json(directory, name) {
  return parseJSON(await readFile(path.join(directory, name), "utf8"));
}
async function exists(directory, name) {
  try {
    await stat(path.join(directory, name));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function journal(directory, value) {
  await writeExclusive(directory, "journal.next", value);
  await rename(
    path.join(directory, "journal.next"),
    path.join(directory, "journal.json"),
  );
}
function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}
export function client(emulator, token) {
  const base = emulator ? "http://127.0.0.1:19000" : endpoint;
  return async (node, method = "GET", value, etag) => {
    const encoded = node.split("/").map(encodeURIComponent).join("/");
    const url = new URL(`${base}/${encoded}.json`);
    if (emulator) url.searchParams.set("ns", "demo-qlist-default-rtdb");
    if (method === "GET" && node !== ".settings/rules")
      url.searchParams.set("format", "export");
    const response = await fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${emulator ? "owner" : token}`,
        "Content-Type": "application/json",
        ...(method === "GET" && node !== ".settings/rules"
          ? { "X-Firebase-ETag": "true" }
          : {}),
        ...(etag ? { "if-match": etag } : {}),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    insist(response.ok, `database-request-failed-${response.status}`);
    const raw = await response.text();
    return {
      value: node === ".settings/rules" ? parseRules(raw) : parseJSON(raw),
      raw,
      etag: response.headers.get("etag"),
    };
  };
}
async function approvalFor(options, action) {
  insist(options.execute === true, "writes-require-execute");
  if (options.emulator) {
    insist(
      !options.live && !options.tokenFile && !options.approval,
      "emulator-cannot-use-live-options",
    );
    return null;
  }
  insist(
    options.live === true && options.approval && options.tokenFile,
    "live-needs-explicit-target-approval-and-token-file",
  );
  for (const filename of [options.approval, options.tokenFile]) {
    const resolved = await realpath(filename);
    insist(
      !resolved.startsWith(repository + path.sep) &&
        (await stat(resolved)).mode % 512 === 0o600,
      "live-inputs-must-be-private-files-outside-git",
    );
  }
  insist(
    !execFileSync("git", ["status", "--porcelain"], {
      cwd: repository,
      encoding: "utf8",
    }).trim(),
    "live-runner-requires-clean-committed-tree",
  );
  const approval = parseJSON(await readFile(options.approval, "utf8"));
  insist(
    approval.format === 1 &&
      approval.target === endpoint &&
      approval.projectId === project &&
      approval.namespace === "v2",
    "approval-target-mismatch",
  );
  insist(
    approval.commit === currentCommit() &&
      approval.candidateRulesSHA256 === rulesSHA,
    "approval-code-or-rules-mismatch",
  );
  insist(
    approval.actions?.includes(action) &&
      Date.parse(approval.expiresAt) > Date.now() &&
      Date.parse(approval.expiresAt) <= Date.now() + 24 * 3600000,
    "approval-action-or-expiry-invalid",
  );
  insist(
    approval.maintenanceAccepted === true &&
      approval.legacyOfflineAccepted === true &&
      approval.releaseQAApproved === true,
    "release-acceptance-missing",
  );
  return approval;
}
async function verifyPublished(approval, variant) {
  if (!approval) return; // Emulator tests have no production frontend dependency.
  const origin = "https://www.qlist.cc";
  const response = await fetch(`${origin}/release.json`, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  insist(response.ok, "release-manifest-unavailable");
  const text = await response.text();
  insist(
    sha(text) === approval.artifacts?.[variant],
    "published-artifact-not-approved",
  );
  const manifest = parseJSON(text);
  insist(
    manifest.format === 1 &&
      manifest.variant === variant &&
      !manifest.dirty &&
      manifest.commit === approval.commit,
    "published-release-mismatch",
  );
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (["_headers", "_redirects"].includes(file)) continue;
    insist(
      /^(index\.html|robots\.txt|assets\/[A-Za-z0-9_.-]+)$/.test(file),
      "invalid-artifact-file",
    );
    const asset = await fetch(`${origin}/${file}`, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    insist(
      asset.ok && sha(Buffer.from(await asset.arrayBuffer())) === hash,
      "published-asset-mismatch",
    );
    if (file === "index.html") {
      const csp = asset.headers.get("content-security-policy") ?? "";
      insist(
        csp.includes("script-src 'self';") &&
          csp.includes("frame-ancestors 'none'") &&
          !/unsafe-inline|unsafe-eval/.test(csp),
        "published-csp-mismatch",
      );
      insist(
        variant === "maintenance"
          ? csp.includes("connect-src 'self';")
          : csp.includes("connect-src 'self' wss://*.firebaseio.com;"),
        "published-transport-policy-mismatch",
      );
    }
  }
}
async function candidateState(api) {
  insist(
    digest((await api(".settings/rules")).value) === rulesSHA,
    "candidate-rules-not-active",
  );
  return await api("v2Control/writesEnabled");
}
export async function run(options) {
  const { action } = options;
  insist(
    [
      "plan",
      "freeze",
      "copy",
      "verify",
      "enable",
      "freeze-modern",
      "verify-recovery",
    ].includes(action),
    "unknown-action",
  );
  const directory = await privateDirectory(options.directory);
  if (action === "plan") {
    insist(
      options.export && !options.live && !options.emulator && !options.execute,
      "plan-is-offline-only",
    );
    const bytes = await readFile(options.export);
    const plan = prepare(parseJSON(bytes.toString("utf8")));
    await writeExclusive(directory, "plan.json", {
      format: 1,
      sourceFileSHA256: sha(bytes),
      sourceDigest: plan.sourceDigest,
      candidateRulesSHA256: rulesSHA,
      summary: plan.summary,
    });
    await writeExclusive(directory, "v2-export.json", plan.payload);
    return { action, status: "passed", ...plan.summary };
  }
  const approval = await approvalFor(options, action);
  const token = options.emulator
    ? null
    : (await readFile(options.tokenFile, "utf8")).trim();
  insist(
    options.emulator || (token && token !== "owner" && !/\s/.test(token)),
    "invalid-access-token-file",
  );
  const api = client(options.emulator, token);
  let record = (await exists(directory, "journal.json"))
    ? await json(directory, "journal.json")
    : null;
  if (record)
    insist(
      record.target === (options.emulator ? "demo-qlist" : endpoint) &&
        record.candidateRulesSHA256 === rulesSHA,
      "journal-target-or-rules-mismatch",
    );
  if (action === "freeze") {
    await verifyPublished(approval, "maintenance");
    if (!record) {
      const [beforeRules, before] = await Promise.all([
        api(".settings/rules"),
        api(""),
      ]);
      insist(
        digest(beforeRules.value) === digest(activeRules),
        "unexpected-current-rules",
      );
      insist(
        before.value && !before.value.v2 && !before.value.v2Control,
        "target-namespace-already-exists",
      );
      prepare(legacyTree(before.value));
      await writeExclusive(directory, "pre-freeze-export.json", before.raw);
      await writeExclusive(directory, "pre-freeze-rules.json", beforeRules.raw);
      record = {
        format: 1,
        target: options.emulator ? "demo-qlist" : endpoint,
        candidateRulesSHA256: rulesSHA,
        phase: "freezing",
        commit: currentCommit(),
        startedAt: new Date().toISOString(),
      };
      await journal(directory, record);
    }
    insist(record.phase === "freezing", "freeze-already-completed");
    const actualRules = (await api(".settings/rules")).value;
    if (digest(actualRules) === digest(activeRules))
      await api(".settings/rules", "PUT", rules);
    else
      insist(digest(actualRules) === rulesSHA, "rules-changed-during-freeze");
    const control = await candidateState(api);
    insist(control.value !== true, "modern-writes-already-enabled");
    insist(control.etag, "missing-control-etag");
    await api("v2Control/writesEnabled", "PUT", false, control.etag);
    const fresh = legacyTree((await api("")).value),
      prepared = prepare(fresh);
    if (await exists(directory, "post-freeze-export.json"))
      verifyCopy(await json(directory, "post-freeze-export.json"), fresh);
    else await writeExclusive(directory, "post-freeze-export.json", fresh);
    record = {
      ...record,
      phase: "frozen",
      sourceDigest: prepared.sourceDigest,
      summary: prepared.summary,
      frozenAt: new Date().toISOString(),
      snapshotSHA256: sha(
        await readFile(path.join(directory, "post-freeze-export.json")),
      ),
    };
    await journal(directory, record);
    return { action, status: "passed", ...prepared.summary };
  }
  insist(record, "freeze-journal-required");
  if (action === "freeze-modern") {
    const control = await candidateState(api);
    insist(control.etag, "missing-control-etag");
    await api("v2Control/writesEnabled", "PUT", false, control.etag);
    const latest = (await api("v2")).value;
    insist(latest, "modern-namespace-missing");
    const name = `recovery-${Date.now()}.json`;
    await writeExclusive(directory, name, latest);
    record = {
      ...record,
      phase: "recovery-frozen",
      recoveryFile: name,
      recoveryDigest: digest(latest),
      recoverySHA256: sha(await readFile(path.join(directory, name))),
    };
    await journal(directory, record);
    return { action, status: "passed", writesEnabled: false };
  }
  const control = await candidateState(api);
  insist(control.value === false, "writes-must-be-frozen");
  if (action === "verify-recovery") {
    insist(record.phase === "recovery-frozen", "recovery-snapshot-required");
    insist(
      sha(await readFile(path.join(directory, record.recoveryFile))) ===
        record.recoverySHA256,
      "recovery-backup-bytes-changed",
    );
    verifyCopy(
      (await api("v2")).value,
      await json(directory, record.recoveryFile),
    );
    insist(
      digest((await api("v2")).value) === record.recoveryDigest,
      "recovery-data-changed",
    );
    await verifyPublished(approval, "rollback");
    return { action, status: "passed" };
  }
  const fresh = legacyTree((await api("")).value);
  insist(
    digest(fresh) === record.sourceDigest,
    "legacy-data-changed-after-freeze",
  );
  insist(
    sha(await readFile(path.join(directory, "post-freeze-export.json"))) ===
      record.snapshotSHA256,
    "frozen-backup-bytes-changed",
  );
  const source = await json(directory, "post-freeze-export.json");
  insist(digest(source) === record.sourceDigest, "frozen-backup-changed");
  const prepared = prepare(source);
  if (action === "copy") {
    insist(["frozen", "copied"].includes(record.phase), "copy-phase-invalid");
    const existing = await api("v2");
    if (existing.value === null) {
      insist(existing.etag, "missing-namespace-etag");
      await api("v2", "PUT", prepared.payload, existing.etag);
    }
    // An interrupted successful copy may be verified again, but never overwritten.
    verifyCopy((await api("v2")).value, prepared.payload);
    insist(
      digest(legacyTree((await api("")).value)) === record.sourceDigest,
      "legacy-data-changed-during-copy",
    );
    record = {
      ...record,
      phase: "copied",
      payloadDigest: digest(prepared.payload),
    };
    await journal(directory, record);
    return { action, status: "passed", ...prepared.summary };
  }
  insist(
    ["copied", "recovery-frozen"].includes(record.phase),
    "verified-copy-required",
  );
  if (record.phase === "recovery-frozen")
    insist(
      sha(await readFile(path.join(directory, record.recoveryFile))) ===
        record.recoverySHA256,
      "recovery-backup-bytes-changed",
    );
  const expected =
    record.phase === "recovery-frozen"
      ? await json(directory, record.recoveryFile)
      : prepared.payload;
  insist(
    digest(expected) ===
      (record.phase === "recovery-frozen"
        ? record.recoveryDigest
        : record.payloadDigest),
    "expected-snapshot-changed",
  );
  verifyCopy((await api("v2")).value, expected);
  if (action === "verify")
    return { action, status: "passed", ...prepared.summary };
  insist(action === "enable", "invalid-phase-action");
  await verifyPublished(approval, "modern");
  // Recheck immediately before enablement after potentially slow asset verification.
  const finalControl = await candidateState(api);
  insist(
    finalControl.value === false && finalControl.etag,
    "control-changed-before-enable",
  );
  verifyCopy((await api("v2")).value, expected);
  await api("v2Control/writesEnabled", "PUT", true, finalControl.etag);
  record = { ...record, phase: "enabled", enabledAt: new Date().toISOString() };
  await journal(directory, record);
  return { action, status: "passed", writesEnabled: true };
}
function options(args) {
  const result = { action: args.shift() ?? "plan" };
  const flags = {
    "--out-dir": "directory",
    "--export": "export",
    "--approval": "approval",
    "--token-file": "tokenFile",
  };
  const booleans = {
    "--execute": "execute",
    "--emulator": "emulator",
    "--live": "live",
  };
  while (args.length) {
    const key = args.shift();
    if (booleans[key]) {
      insist(!result[booleans[key]], "duplicate-flag");
      result[booleans[key]] = true;
    } else {
      insist(
        flags[key] &&
          !result[flags[key]] &&
          args[0] &&
          !args[0].startsWith("--"),
        "unknown-or-invalid-flag",
      );
      result[flags[key]] = args.shift();
    }
  }
  insist(result.directory, "private-output-directory-required");
  return result;
}
if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  try {
    console.log(JSON.stringify(await run(options(process.argv.slice(2)))));
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "blocked",
        reason: /^[a-z0-9-]+$/.test(error.message)
          ? error.message
          : "operation-failed-private-details-suppressed",
      }),
    );
    process.exitCode = 1;
  }
}
