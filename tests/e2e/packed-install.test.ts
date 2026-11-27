import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createServer as createRegistryServer, type Server } from "node:http";
import { spawn } from "bun";
import { startOpenCodeE2ESession, type TempRepo } from "./fixtures";
import { isE2E, TmuxSession } from "./tmux";

const enabled = isE2E() && process.env.PACKED_E2E === "1";

async function run(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string | undefined>,
): Promise<string> {
  const proc = spawn([command, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${code}\n${stderr}`);
  }
  return stdout;
}

function labelLocation(
  screen: string,
  label: string,
): { col: number; row: number } {
  const lines = screen.split("\n");
  const row = lines.findIndex(
    (line) =>
      line.includes("Pull") &&
      line.includes("Requests") &&
      line.includes(label),
  );
  if (row < 0)
    throw new Error(
      `Could not find ${label} filter beside Pull Requests:\n${screen}`,
    );
  const col = lines[row].indexOf(label);
  return { col, row };
}

describe.skipIf(!enabled)("E2E: npm-packed plugin installation", () => {
  let repo: TempRepo;
  let session: TmuxSession;
  let stopSession: (() => Promise<void>) | undefined;
  let scratch: string;
  let homeDir: string;
  let registry: Server | undefined;
  let registryUrl: string;
  let metadataRequests = 0;
  let tarballRequests = 0;

  beforeAll(async () => {
    const sourceRoot = resolve(import.meta.dir, "../..");
    scratch = mkdtempSync(join(tmpdir(), "opencode-github-pr-packed-e2e-"));
    const artifactDir = join(scratch, "artifact");
    mkdirSync(artifactDir);
    const hostDir = join(scratch, "host");
    mkdirSync(hostDir);
    homeDir = join(scratch, "home");
    mkdirSync(homeDir);
    const xdgConfigHome = join(homeDir, ".config");
    mkdirSync(xdgConfigHome, { recursive: true });

    const packOutput = await run(
      "npm",
      ["pack", "--json", "--pack-destination", artifactDir, sourceRoot],
      sourceRoot,
    );
    const jsonStart = packOutput.indexOf("[\n");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const pack = JSON.parse(packOutput.slice(jsonStart)) as Array<{
      filename: string;
    }>;
    const tarball = join(artifactDir, pack[0]?.filename ?? "");
    expect(existsSync(tarball)).toBe(true);
    const archiveFiles = await run("tar", ["-tzf", tarball], artifactDir);
    expect(archiveFiles.split("\n")).toContain("package/demo/fixtures.ts");
    expect(archiveFiles.split("\n")).toContain(
      "package/plugins/pr-dashboard.tui.tsx",
    );
    expect(archiveFiles.split("\n")).toContain(
      "package/dist/pr-dashboard.tui.js",
    );
    const manifest = JSON.parse(
      readFileSync(join(sourceRoot, "package.json"), "utf8"),
    ) as Record<string, unknown> & { name: string; version: string };
    const tarballBytes = readFileSync(tarball);
    // OpenCode resolves a bare plugin name through npm, not the host project's
    // node_modules. Serve this tarball for the package name and proxy only its
    // normal runtime dependencies to the public npm registry.
    const address = await new Promise<{ port: number }>(
      (resolveAddress, reject) => {
        registry = createRegistryServer((request, response) => {
          const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
          if (path === `/${manifest.name}`) {
            metadataRequests += 1;
            const dist = {
              tarball: `${registryUrl}/${pack[0].filename}`,
              shasum: createHash("sha1").update(tarballBytes).digest("hex"),
              integrity: `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`,
            };
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                name: manifest.name,
                "dist-tags": { latest: manifest.version },
                versions: {
                  [manifest.version]: { ...manifest, dist },
                },
              }),
            );
            return;
          }
          if (path.endsWith(pack[0].filename)) {
            tarballRequests += 1;
            response.writeHead(200, {
              "content-type": "application/octet-stream",
            });
            response.end(tarballBytes);
            return;
          }
          void fetch(`https://registry.npmjs.org${request.url ?? "/"}`)
            .then(async (upstream) => {
              response.writeHead(upstream.status, {
                "content-type":
                  upstream.headers.get("content-type") ??
                  "application/octet-stream",
              });
              response.end(Buffer.from(await upstream.arrayBuffer()));
            })
            .catch((error: unknown) => {
              response.writeHead(502);
              response.end(String(error));
            });
        });
        registry.once("error", reject);
        registry.listen(0, "127.0.0.1", () => {
          const listeningAddress = registry?.address();
          if (!listeningAddress || typeof listeningAddress === "string") {
            reject(new Error("Could not allocate a local npm registry port"));
          } else {
            resolveAddress({ port: listeningAddress.port });
          }
        });
      },
    );
    registryUrl = `http://127.0.0.1:${address.port}`;

    await run("git", ["init", "--initial-branch=main"], hostDir);
    // Seed OpenCode's own cache from the packed artifact before startup. The
    // project config below remains the only plugin registration under test.
    await run(
      "git",
      [
        "remote",
        "add",
        "origin",
        "https://example.invalid/octocat/Hello-World.git",
      ],
      hostDir,
    );
    repo = {
      dir: hostDir,
      cleanup: () => {
        if (existsSync(hostDir))
          rmSync(hostDir, { recursive: true, force: true });
      },
    };
    writeFileSync(
      join(repo.dir, "package.json"),
      JSON.stringify(
        {
          name: "packed-plugin-e2e-host",
          private: true,
          dependencies: {
            "@opencode/plugin": "2.0.20",
            "@opencode/theme": "2.0.20",
            "@opentui/core": "0.6.6",
            "@opentui/solid": "0.6.6",
            "solid-js": "1.9.12",
          },
        },
        null,
        2,
      ),
    );
    const configPath = join(repo.dir, "opencode.json");
    const config = { plugins: ["opencode-github-pr"] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    expect(Object.keys(JSON.parse(await Bun.file(configPath).text()))).toEqual([
      "plugins",
    ]);
    expect(JSON.parse(await Bun.file(configPath).text()).plugins).toEqual([
      "opencode-github-pr",
    ]);

    // Install one host copy of each peer. The OpenCode cache is a sibling of
    // this project, so later we link its package imports to these exact copies.
    await run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
      repo.dir,
    );
    expect(
      existsSync(
        join(
          repo.dir,
          "node_modules",
          "opencode-github-pr",
          "demo",
          "fixtures.ts",
        ),
      ),
    ).toBe(true);
    for (const peer of [
      "solid-js",
      "@opencode/plugin",
      "@opencode/theme",
      "@opentui/core",
      "@opentui/solid",
    ])
      expect(existsSync(join(repo.dir, "node_modules", peer))).toBe(true);
    expect(
      existsSync(
        join(
          repo.dir,
          "node_modules",
          "@opentui",
          "solid",
          "node_modules",
          "solid-js",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(
          repo.dir,
          "node_modules",
          "@opencode",
          "plugin",
          "node_modules",
          "@opentui",
          "solid",
        ),
      ),
    ).toBe(false);

    await run(
      process.env.OPENCODE_BIN ?? "opencode",
      ["plugin", "add", "opencode-github-pr"],
      hostDir,
      {
        ...process.env,
        HOME: homeDir,
        XDG_CONFIG_HOME: xdgConfigHome,
        OPENCODE_DISABLE_UPDATE: "1",
        GITHUB_TOKEN: "",
        GH_TOKEN: "",
        GITHUB_PERSONAL_ACCESS_TOKEN: "",
        npm_config_registry: registryUrl,
        BUN_CONFIG_REGISTRY: registryUrl,
        NODE_PATH: join(hostDir, "node_modules"),
      },
    );
    const pluginCache = join(
      homeDir,
      ".cache",
      "opencode",
      "npm",
      "opencode-github-pr@latest",
    );
    const cacheGeneration = readdirSync(pluginCache, {
      withFileTypes: true,
    }).find((entry) => entry.isDirectory())?.name;
    expect(cacheGeneration).toBeDefined();
    const cachedPackage = join(
      pluginCache,
      cacheGeneration ?? "",
      "node_modules",
      "opencode-github-pr",
    );
    const cachedManifest = JSON.parse(
      readFileSync(join(cachedPackage, "package.json"), "utf8"),
    ) as { exports: Record<string, string> };
    expect(cachedManifest.exports["./tui"]).toBe("./dist/pr-dashboard.tui.js");
    expect(existsSync(join(cachedPackage, "demo", "fixtures.ts"))).toBe(true);
    const cachedTuiPath = join(cachedPackage, "dist", "pr-dashboard.tui.js");
    expect(existsSync(cachedTuiPath)).toBe(true);
    const cachedTui = readFileSync(cachedTuiPath, "utf8");
    expect(cachedTui).toContain('from "@opentui/solid/jsx-dev-runtime"');
    expect(cachedTui).not.toContain('from "@opentui/core"');
    expect(cachedTui).not.toContain('from "@opencode/theme/tui"');
    // OpenCode's npm cache is a sibling of the host project. Point the
    // package's peer imports at the host's single runtime copies instead of
    // loading a second Solid/OpenTUI runtime from the cache.
    const cachedPeerDir = join(cachedPackage, "node_modules");
    const hostPeerNames = [
      "solid-js",
      "@opencode/plugin",
      "@opencode/theme",
      "@opentui/core",
      "@opentui/solid",
    ];
    for (const peer of hostPeerNames) {
      const hostPeer = join(hostDir, "node_modules", peer);
      const cachedPeer = join(cachedPeerDir, peer);
      mkdirSync(dirname(cachedPeer), { recursive: true });
      if (!existsSync(cachedPeer)) symlinkSync(hostPeer, cachedPeer, "dir");
      expect(realpathSync(cachedPeer)).toBe(realpathSync(hostPeer));
    }
    rmSync(join(xdgConfigHome, "opencode", "opencode.json"), { force: true });
    expect(existsSync(join(xdgConfigHome, "opencode", "opencode.json"))).toBe(
      false,
    );

    const launched = await startOpenCodeE2ESession(
      repo,
      `e2e-packed-${Date.now()}`,
      {
        cwd: repo.dir,
        demo: true,
        homeDir,
        nodePath: join(repo.dir, "node_modules"),
        registryUrl,
      },
    );
    session = launched.session;
    stopSession = launched.cleanup;
  }, 180_000);

  afterAll(async () => {
    await stopSession?.();
    if (registry?.listening) {
      await new Promise<void>((resolveClose, reject) =>
        registry?.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
    repo?.cleanup();
    if (scratch && existsSync(scratch))
      rmSync(scratch, { recursive: true, force: true });
  });

  test("resolves the installed package and updates the sidebar on filter interaction", async () => {
    await session.waitForText("Add passkey sign-in", { timeoutMs: 30_000 });
    let screen = await session.capturePanePlain();
    expect(screen).toContain("Pull Requests");
    expect(screen).toContain("open");
    expect(screen).toContain("Add passkey sign-in");

    const filter = labelLocation(screen, "open");
    await session.click(filter.col, filter.row);
    await session.waitForText("Prepare the v2.4 release", {
      timeoutMs: 10_000,
    });
    screen = await session.capturePanePlain();
    expect(screen).toContain("closed");
    expect(screen).toContain("Prepare the v2.4 release");
    expect(metadataRequests).toBeGreaterThan(0);
    expect(tarballRequests).toBeGreaterThan(0);
  }, 60_000);
});
