import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoxClient } from "box-typescript-sdk-gen/client.generated";
import {
  collectBoxRecursiveFileInventory,
  fetchBoxFolderInventory,
  mapBoxFolderListEntry,
  resolveBoxConnectionScope,
  resolveBoxProviderConfig
} from "../box-provider.js";

describe("box provider config", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const rawJwtConfig = JSON.stringify({
    boxAppSettings: {
      clientID: "client-id",
      clientSecret: "client-secret",
      appAuth: {
        publicKeyID: "public-key-id",
        privateKey: "private-key",
        passphrase: "passphrase"
      }
    },
    enterpriseID: "enterprise-123"
  });

  it("returns null when no Box config env is present", () => {
    const config = resolveBoxProviderConfig({});
    expect(config).toBeNull();
  });

  it("loads a raw Box JWT config JSON blob from env", () => {
    const config = resolveBoxProviderConfig({
      BOX_JWT_CONFIG_JSON: rawJwtConfig,
      BOX_ENTERPRISE_ID: "enterprise-override",
      BOX_USER_ID: "user-123",
      BOX_PP_ROOT_FOLDER_ID: "folder-456"
    });

    expect(config).toEqual({
      jwtConfigJson: rawJwtConfig,
      enterpriseId: "enterprise-override",
      userId: "user-123",
      rootFolderId: "folder-456",
      incomingMailFolderId: null
    });
  });

  it("loads the nested local wrapper config shape from file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-box-provider-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        box_jwt_config: JSON.parse(rawJwtConfig),
        box_enterprise_id: "enterprise-123",
        box_user_id: "user-123"
      })
    );

    const config = resolveBoxProviderConfig({
      BOX_JWT_CONFIG_FILE: configPath,
      BOX_USER_ID: "user-123"
    });

    expect(config?.jwtConfigJson).toBe(rawJwtConfig);
    expect(config?.userId).toBe("user-123");
  });

  it("resolves app-user scope when BOX_USER_ID is present", () => {
    const scope = resolveBoxConnectionScope({
      jwtConfigJson: rawJwtConfig,
      enterpriseId: "enterprise-123",
      userId: "user-123"
    });

    expect(scope).toEqual({
      connectionScope: "global_box_app_user",
      subjectType: "user",
      subjectId: "user-123"
    });
  });

  it("falls back to enterprise scope when no BOX_USER_ID is provided", () => {
    const scope = resolveBoxConnectionScope({
      jwtConfigJson: rawJwtConfig,
      enterpriseId: "enterprise-123",
      userId: null
    });

    expect(scope).toEqual({
      connectionScope: "global_box_enterprise_service_account",
      subjectType: "enterprise",
      subjectId: "enterprise-123"
    });
  });
});

describe("mapBoxFolderListEntry", () => {
  it("maps SDK-style file entries from object properties (not rawData)", () => {
    const mapped = mapBoxFolderListEntry(
      {
        id: "file-1",
        type: "file",
        name: "Report.pdf",
        sha1: "abc",
        modifiedAt: { value: new Date("2024-01-02T03:04:05.000Z") }
      },
      "folder-parent"
    );

    expect(mapped.kind).toBe("file");
    if (mapped.kind === "file") {
      expect(mapped.file.remote_id).toBe("file-1");
      expect(mapped.file.filename).toBe("Report.pdf");
      expect(mapped.file.parent_folder_id).toBe("folder-parent");
      expect(mapped.file.content_hash).toBe("abc");
      expect(mapped.file.remote_modified_at).toBe("2024-01-02T03:04:05.000Z");
      expect(mapped.file.authoritative_asset_uri).toBe(
        "https://api.box.com/2.0/files/file-1/content"
      );
    }
  });

  it("maps folder entries for recursive sync", () => {
    expect(mapBoxFolderListEntry({ id: "sub", type: "folder", name: "Child" }, "p")).toEqual({
      kind: "folder",
      folderId: "sub"
    });
  });

  it("ignores web links and unknown types", () => {
    expect(mapBoxFolderListEntry({ id: "w", type: "web_link", name: "x" }, "p").kind).toBe("ignore");
    expect(mapBoxFolderListEntry({ id: "", type: "file", name: "x" }, "p").kind).toBe("ignore");
  });
});

describe("fetchBoxFolderInventory (mocked SDK)", () => {
  it("returns files when entries use top-level id/type/name (box-typescript-sdk-gen)", async () => {
    const client = {
      folders: {
        getFolderItems: vi.fn().mockResolvedValue({
          entries: [
            { id: "f1", type: "file", name: "a.pdf", sha1: "s1" },
            { id: "d1", type: "folder", name: "sub" }
          ],
          nextMarker: null,
          totalCount: 2
        })
      }
    } as unknown as BoxClient;

    const inv = await fetchBoxFolderInventory(client, "folder-xyz", { limit: 10 });
    expect(inv.files).toHaveLength(1);
    expect(inv.files[0]?.remote_id).toBe("f1");
    expect(inv.files[0]?.parent_folder_id).toBe("folder-xyz");
  });
});

describe("collectBoxRecursiveFileInventory (mocked SDK)", () => {
  it("walks nested folders breadth-first and collects files", async () => {
    const client = {
      folders: {
        getFolderItems: vi.fn().mockImplementation((folderId: string) => {
          if (folderId === "root") {
            return Promise.resolve({
              entries: [
                { id: "a.pdf", type: "file", name: "a.pdf" },
                { id: "sub1", type: "folder", name: "sub1" }
              ],
              nextMarker: null,
              totalCount: 2
            });
          }
          if (folderId === "sub1") {
            return Promise.resolve({
              entries: [{ id: "b.pdf", type: "file", name: "b.pdf" }],
              nextMarker: null,
              totalCount: 1
            });
          }
          return Promise.resolve({ entries: [], nextMarker: null, totalCount: 0 });
        })
      }
    } as unknown as BoxClient;

    const result = await collectBoxRecursiveFileInventory(client, "root", {
      maxFiles: 100,
      maxFoldersVisited: 100
    });

    expect(result.files.map((f) => f.remote_id)).toEqual(["a.pdf", "b.pdf"]);
    expect(result.foldersVisited).toBe(2);
    expect(result.truncated).toBe(false);
  });
});
