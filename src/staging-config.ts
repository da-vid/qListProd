// Verified new Spark project. No runtime/env/URL override is permitted.
export const STAGING_CONFIG = Object.freeze({
  projectId: "qlist-staging",
  databaseURL: "https://qlist-staging-default-rtdb.firebaseio.com",
});
export const STAGING_WEBSOCKET_HOSTS = [
  "qlist-staging-default-rtdb.firebaseio.com",
] as const;
export function assertStagingHost(hostname: string): void {
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "deploy-preview-1--qlist.netlify.app" &&
    hostname !== "codex-safe-development-baseline--qlist.netlify.app" &&
    !/^[a-f0-9]{24}--qlist\.netlify\.app$/.test(hostname)
  )
    throw new Error(
      "Shared staging is restricted to the approved qList review preview.",
    );
}
