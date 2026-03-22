import { afterEach, describe, expect, it } from "vitest";
import { beginSourceConnectionAuth, ensureSourceConnection } from "../runtime.js";
import { createTestDb } from "./test-helpers.js";

describe("source connection selection", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("reuses the most recently updated provider row for direct connections", () => {
    const db = createTestDb();
    openDbs.push(db);

    db.prepare(
      `
        INSERT INTO source_connections
          (id, provider, account_label, auth_mode, scopes, status, metadata_json, created_at, updated_at)
        VALUES
          (?, 'box', 'Old Box', 'development_local_process', '[]', 'active', '{}', ?, ?),
          (?, 'box', 'New Box', 'development_local_process', '[]', 'active', '{}', ?, ?)
      `
    ).run(
      "conn-old",
      "2025-01-01 00:00:00",
      "2025-01-01 00:00:00",
      "conn-new",
      "2025-02-01 00:00:00",
      "2025-02-01 00:00:00"
    );

    const connection = ensureSourceConnection(db, {
      provider: "box",
      accountLabel: "Updated Box"
    });

    expect(connection.id).toBe("conn-new");

    const newest = db
      .prepare(`SELECT account_label, status, last_verified_at FROM source_connections WHERE id = ? LIMIT 1`)
      .get("conn-new") as
      | {
          account_label: string | null;
          status: string;
          last_verified_at: string | null;
        }
      | undefined;
    expect(newest?.account_label).toBe("Updated Box");
    expect(newest?.status).toBe("active");
    expect(newest?.last_verified_at).not.toBeNull();

    const oldest = db
      .prepare(`SELECT account_label, last_verified_at FROM source_connections WHERE id = ? LIMIT 1`)
      .get("conn-old") as
      | {
          account_label: string | null;
          last_verified_at: string | null;
        }
      | undefined;
    expect(oldest?.account_label).toBe("Old Box");
    expect(oldest?.last_verified_at).toBeNull();
  });

  it("starts browser auth on the most recently updated provider row", () => {
    const db = createTestDb();
    openDbs.push(db);

    db.prepare(
      `
        INSERT INTO source_connections
          (id, provider, account_label, auth_mode, scopes, status, metadata_json, created_at, updated_at)
        VALUES
          (?, 'practicepanther', 'Old PP', 'development_local_process', '[]', 'active', '{}', ?, ?),
          (?, 'practicepanther', 'New PP', 'development_local_process', '[]', 'active', '{}', ?, ?)
      `
    ).run(
      "pp-old",
      "2025-01-01 00:00:00",
      "2025-01-01 00:00:00",
      "pp-new",
      "2025-02-01 00:00:00",
      "2025-02-01 00:00:00"
    );

    const connection = beginSourceConnectionAuth(db, {
      provider: "practicepanther",
      accountLabel: "Fresh PP",
      scopes: ["matters.read"],
      authMode: "oauth_browser"
    });

    expect(connection.id).toBe("pp-new");
    expect(connection.auth_mode).toBe("oauth_browser");
    expect(connection.callback_state).toBeTruthy();
    expect(connection.authorization_url).toContain("auth.placeholder.local/practicepanther");

    const newest = db
      .prepare(
        `
          SELECT account_label, status, callback_state, authorization_url
          FROM source_connections
          WHERE id = ?
          LIMIT 1
        `
      )
      .get("pp-new") as
      | {
          account_label: string | null;
          status: string;
          callback_state: string | null;
          authorization_url: string | null;
        }
      | undefined;
    expect(newest?.account_label).toBe("Fresh PP");
    expect(newest?.status).toBe("auth_pending");
    expect(newest?.callback_state).toBe(connection.callback_state);
    expect(newest?.authorization_url).toBe(connection.authorization_url);

    const oldest = db
      .prepare(`SELECT callback_state, authorization_url FROM source_connections WHERE id = ? LIMIT 1`)
      .get("pp-old") as
      | {
          callback_state: string | null;
          authorization_url: string | null;
        }
      | undefined;
    expect(oldest?.callback_state).toBeNull();
    expect(oldest?.authorization_url).toBeNull();
  });
});
