// Owner-confirmed project/database. These are public Firebase identifiers, not credentials.
// No environment, URL, or localStorage overrides are accepted.
export const PRODUCTION_CONFIG = Object.freeze({
  projectId: "project-8156335338801733535",
  databaseURL: "https://qwiklist.firebaseio.com",
});
export const PRODUCTION_NAMESPACE = "v2" as const;
export function assertProductionHost(hostname: string): void {
  if (!["qlist.cc", "www.qlist.cc", "qlist.netlify.app"].includes(hostname))
    throw new Error("This release is restricted to the qList production site.");
}
