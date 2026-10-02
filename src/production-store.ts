import { initializeApp } from "firebase/app";
import {
  forceWebSockets,
  getDatabase,
  onValue,
  ref,
  type Database,
} from "firebase/database";
import {
  assertProductionHost,
  PRODUCTION_CONFIG,
} from "./production-config.ts";
export function productionDatabase(name: string, hostname: string) {
  assertProductionHost(hostname);
  forceWebSockets();
  return getDatabase(initializeApp(PRODUCTION_CONFIG, name));
}
export function watchWrites(db: Database, changed: (enabled: boolean) => void) {
  return onValue(
    ref(db, "v2Control/writesEnabled"),
    (snapshot) => changed(snapshot.val() === true),
    () => changed(false),
  );
}
