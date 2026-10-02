import { initializeApp } from "firebase/app";
import { getDatabase, forceWebSockets } from "firebase/database";
import { STAGING_CONFIG, assertStagingHost } from "./staging-config.ts";
export function stagingDatabase(name: string, hostname: string) {
  assertStagingHost(hostname);
  // Avoid remote JSONP script/iframe fallback: staging retains script-src 'self'.
  forceWebSockets();
  return getDatabase(initializeApp(STAGING_CONFIG, name));
}
