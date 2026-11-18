import { spawn, type Subprocess } from "bun";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const COLUMNS = 140;
const ROWS = 44;
const START_TIMEOUT_MS = 45_000;
const UI_TIMEOUT_MS = 12_000;
const GIF_EXIT_TRIM_SECONDS = 0.6;
const GIF_IDLE_LIMIT_SECONDS = 1;
const repoRoot = resolve(import.meta.dir, "..");

type CommandResult = { stdout: string; stderr: string };

function fail(message: string): never {
  throw new Error(message);
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CommandResult> {
  const proc = spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    fail(
      `${command} ${args.join(" ")} exited ${code}${stderr ? `:\n${stderr}` : ""}`,
    );
  }
  return { stdout, stderr };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function gifEndTimeBeforeTerminalExit(recordingPath: string): number {
  let elapsed = 0;
  let exitTime: number | null = null;
  let output = "";
  const events = readFileSync(recordingPath, "utf8")
    .trimEnd()
    .split("\n")
    .slice(1);

  for (const line of events) {
    const event = JSON.parse(line) as [number, string, string];
    elapsed += Math.min(event[0], GIF_IDLE_LIMIT_SECONDS);
    if (event[1] !== "o") continue;
    output += event[2];
    if (output.includes("\u001b[?1049l")) exitTime = elapsed;
  }

  return Math.max(0, (exitTime ?? elapsed) - GIF_EXIT_TRIM_SECONDS);
}

function parseArgs(args: string[]): {
  output: string;
  makeGif: boolean;
  overwrite: boolean;
} {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Capture and exercise the PR dashboard in a headless OpenCode TUI.

Usage: bun run demo/capture.ts [--output FILE] [--gif] [--overwrite]

Options:
  --output FILE  Recording destination (default: demo/demo.cast)
  --gif          Also render a GIF with agg
  --overwrite    Replace the requested output file if it already exists`);
    process.exit(0);
  }

  let output = "demo/demo.cast";
  const outputIndex = args.indexOf("--output");
  if (outputIndex !== -1) {
    output = args[outputIndex + 1] ?? fail("--output requires a file path");
  }
  return {
    output: resolve(output),
    makeGif: args.includes("--gif"),
    overwrite: args.includes("--overwrite"),
  };
}

function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      /\p{Mark}/u.test(character) ||
      codePoint === 0x200d ||
      codePoint === 0xfe0f
    )
      continue;
    const wide =
      codePoint >= 0x1100 &&
      (codePoint <= 0x115f ||
        codePoint === 0x2329 ||
        codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
        (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
        (codePoint >= 0x20000 && codePoint <= 0x3fffd));
    width += wide ? 2 : 1;
  }
  return width;
}

function findTextCell(
  screen: string,
  text: string,
): { col: number; row: number } | null {
  const lines = screen.split("\n");
  for (let row = 0; row < lines.length; row++) {
    const index = lines[row].indexOf(text);
    if (index === -1) continue;
    const prefix = displayWidth(lines[row].slice(0, index));
    const width = displayWidth(text);
    return { col: prefix + Math.floor(width / 2), row };
  }
  return null;
}

function getOptions(): {
  output: string;
  makeGif: boolean;
  overwrite: boolean;
} {
  return parseArgs(process.argv.slice(2));
}

async function tmux(socket: string, args: string[]): Promise<string> {
  return (await run("tmux", ["-L", socket, ...args])).stdout.trimEnd();
}

async function capturePane(socket: string, session: string): Promise<string> {
  return tmux(socket, ["capture-pane", "-t", session, "-p"]);
}

async function waitForText(
  socket: string,
  session: string,
  text: string,
  timeoutMs = UI_TIMEOUT_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await capturePane(socket, session);
    if (last.includes(text)) return last;
    await Bun.sleep(150);
  }
  fail(
    `Timed out waiting for ${JSON.stringify(text)}. Last TUI frame:\n${last}`,
  );
}

async function clickCell(
  socket: string,
  session: string,
  col: number,
  row: number,
): Promise<void> {
  const x = col + 1;
  const y = row + 1;
  await tmux(socket, ["send-keys", "-t", session, "-l", `\x1b[<0;${x};${y}M`]);
  await Bun.sleep(30);
  await tmux(socket, ["send-keys", "-t", session, "-l", `\x1b[<0;${x};${y}m`]);
  await Bun.sleep(400);
}

async function clickText(
  socket: string,
  session: string,
  text: string,
): Promise<void> {
  const screen = await capturePane(socket, session);
  const cell = findTextCell(screen, text);
  if (!cell)
    fail(
      `Couldn't locate ${JSON.stringify(text)} in the current TUI frame:\n${screen}`,
    );
  await clickCell(socket, session, cell.col, cell.row);
}

async function clickPageArrow(
  socket: string,
  session: string,
  currentPage: string,
  direction: "next" | "previous",
): Promise<void> {
  const screen = await capturePane(socket, session);
  const lines = screen.split("\n");
  const row = lines.findIndex((line) => line.includes(currentPage));
  if (row === -1)
    fail(
      `Couldn't locate pagination ${JSON.stringify(currentPage)}:\n${screen}`,
    );
  const line = lines[row];
  const start = line.indexOf(currentPage);
  const offset = displayWidth(line.slice(0, start));
  const col =
    direction === "next"
      ? offset + displayWidth(currentPage) + 1
      : Math.max(0, offset - 2);
  await clickCell(socket, session, col, row);
}

async function exerciseDashboard(
  socket: string,
  session: string,
): Promise<void> {
  await waitForText(socket, session, "Add passkey sign-in", START_TIMEOUT_MS);
  await waitForText(socket, session, "1 of 2");
  await Bun.sleep(700);

  await clickPageArrow(socket, session, "1 of 2", "next");
  await waitForText(socket, session, "2 of 2");
  await waitForText(socket, session, "Simplify session settings");
  await Bun.sleep(700);

  await clickPageArrow(socket, session, "2 of 2", "previous");
  await waitForText(socket, session, "1 of 2");
  await clickText(socket, session, "author");
  await waitForText(socket, session, "assignee");
  await clickText(socket, session, "assignee");
  await waitForText(socket, session, "all");
  await Bun.sleep(700);

  await clickText(socket, session, "open");
  await waitForText(socket, session, "closed");
  await waitForText(socket, session, "Prepare the v2.4 release");
  await Bun.sleep(1_000);

  await clickText(socket, session, "closed");
  await waitForText(socket, session, "all");
  await waitForText(socket, session, "1 of 3");
  await Bun.sleep(1_000);
}

async function createTempRepository(directory: string): Promise<void> {
  await run("git", ["init", "--initial-branch=main"], { cwd: directory });
  await run("git", ["config", "user.name", "Demo User"], { cwd: directory });
  await run("git", ["config", "user.email", "demo@example.invalid"], {
    cwd: directory,
  });
  writeFileSync(join(directory, "README.md"), "# Launchpad demo repository\n");
  await run("git", ["add", "README.md"], { cwd: directory });
  await run("git", ["commit", "-m", "Initial demo commit"], { cwd: directory });
  await run("git", ["checkout", "-b", "feature/passkeys"], { cwd: directory });
  await run(
    "git",
    ["remote", "add", "origin", "https://github.com/acme/launchpad.git"],
    { cwd: directory },
  );
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    fail("Could not allocate a local OpenCode server port.");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

async function createOpenCodeSession(
  serverUrl: string,
  password: string,
  directory: string,
): Promise<string> {
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString(
    "base64",
  )}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverUrl}/api/session`, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ location: { directory } }),
      });
      if (response.ok) {
        const body = (await response.json()) as { data?: { id?: string } };
        if (body.data?.id) return body.data.id;
        lastError = "OpenCode returned a session response without an id.";
      } else {
        lastError = `OpenCode server returned HTTP ${response.status}.`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(200);
  }
  fail(`Could not create the demo OpenCode session: ${lastError}`);
}

async function main(): Promise<void> {
  const options = getOptions();
  const asciinema = Bun.which("asciinema");
  const tmuxBin = Bun.which("tmux");
  const opencode = Bun.which(process.env.OPENCODE_BIN ?? "opencode");
  if (!asciinema)
    fail("asciinema is required. Install it from https://asciinema.org/");
  if (!tmuxBin) fail("tmux is required to drive the demo interactions.");
  if (!opencode)
    fail(`OpenCode CLI not found: ${process.env.OPENCODE_BIN ?? "opencode"}`);
  const agg = options.makeGif ? Bun.which("agg") : null;
  if (options.makeGif && !agg)
    fail("--gif requires agg (https://github.com/asciinema/agg).");
  if (!/\.cast$/i.test(options.output))
    fail("The recording output path must end in .cast.");
  const gifPath = options.output.replace(/\.cast$/i, ".gif");
  if (existsSync(options.output) && !options.overwrite) {
    fail(
      `Output already exists: ${options.output}\nUse --overwrite or choose another --output path.`,
    );
  }
  if (options.makeGif && existsSync(gifPath) && !options.overwrite) {
    fail(
      `GIF already exists: ${gifPath}\nUse --overwrite or choose another --output path.`,
    );
  }

  mkdirSync(dirname(options.output), { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), "opencode-pr-dashboard-demo-"));
  const repoDir = join(tempRoot, "repo");
  const homeDir = join(tempRoot, "home");
  const configPath = join(tempRoot, "opencode.json");
  const tmuxConfigPath = join(tempRoot, "tmux.conf");
  try {
    mkdirSync(repoDir);
    mkdirSync(homeDir);
    writeFileSync(configPath, JSON.stringify({ plugins: [repoRoot] }));
    writeFileSync(
      tmuxConfigPath,
      "set-option -g remain-on-exit on\nset-option -g status off\n",
    );
    await createTempRepository(repoDir);
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }

  const socket = `pr-demo-${process.pid}`;
  const session = `pr-dashboard-demo-${process.pid}`;
  const environment = {
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, ".config"),
    XDG_DATA_HOME: join(homeDir, ".local", "share"),
    OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_UPDATE: "1",
    OPENCODE_GITHUB_PR_DEMO: "1",
    GITHUB_TOKEN: "",
    GH_TOKEN: "",
    GITHUB_PERSONAL_ACCESS_TOKEN: "",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };

  let recorder: Subprocess | undefined;
  let server: Subprocess | undefined;
  let serverSession: string | undefined;
  let serverUrl: string | undefined;
  let serverPassword: string | undefined;
  let recorderResult: Promise<{ code: number; stderr: string }> | undefined;
  let recorderDone = false;
  try {
    const port = await findAvailablePort();
    serverUrl = `http://127.0.0.1:${port}`;
    serverPassword = `demo-${process.pid}`;
    const serverEnvironment = {
      ...environment,
      OPENCODE_PASSWORD: serverPassword,
      OPENCODE_SERVER_PASSWORD: serverPassword,
    };
    server = spawn(
      [opencode, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: repoRoot,
        env: { ...process.env, ...serverEnvironment },
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    serverSession = await createOpenCodeSession(
      serverUrl,
      serverPassword,
      repoDir,
    );

    const createArgs = [
      "-L",
      socket,
      "-f",
      tmuxConfigPath,
      "new-session",
      "-d",
      "-s",
      session,
      "-x",
      String(COLUMNS),
      "-y",
      String(ROWS),
      "-c",
      repoDir,
    ];
    for (const [key, value] of Object.entries(environment))
      createArgs.push("-e", `${key}=${value}`);
    createArgs.push(
      "-e",
      `OPENCODE_PASSWORD=${serverPassword}`,
      "-e",
      `OPENCODE_SERVER_PASSWORD=${serverPassword}`,
    );
    createArgs.push(
      "--",
      opencode,
      "--server",
      serverUrl,
      "--session",
      serverSession,
    );
    await run("tmux", createArgs);
    await tmux(socket, ["set-option", "-t", session, "mouse", "off"]);
    const initialScreen = await waitForText(
      socket,
      session,
      "Add passkey sign-in",
      START_TIMEOUT_MS,
    );
    if (initialScreen.includes("Getting started")) {
      await clickText(socket, session, "✕");
      await Bun.sleep(400);
    }

    const attachCommand = `${shellQuote(tmuxBin)} -L ${shellQuote(socket)} attach-session -t ${shellQuote(session)}`;
    recorder = spawn(
      [
        asciinema,
        "record",
        "--headless",
        "--quiet",
        "--window-size",
        `${COLUMNS}x${ROWS}`,
        "--idle-time-limit",
        "1",
        "--title",
        "OpenCode GitHub PR dashboard demo",
        "--command",
        attachCommand,
        ...(options.overwrite ? ["--overwrite"] : []),
        options.output,
      ],
      {
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stderr = new Response(
      recorder.stderr as ReadableStream<Uint8Array>,
    ).text();
    recorderResult = Promise.all([recorder.exited, stderr]).then(
      ([code, error]) => {
        recorderDone = true;
        return { code, stderr: error };
      },
    );

    await exerciseDashboard(socket, session);
    await tmux(socket, ["send-keys", "-t", session, "C-c"]);
    await Bun.sleep(300);
    await tmux(socket, ["kill-session", "-t", session]).catch(() => "");
    const result = await Promise.race([
      recorderResult,
      Bun.sleep(10_000).then(() => null),
    ]);
    if (!result)
      fail("The asciinema recording did not finalize after the TUI closed.");
    if (result.code !== 0)
      fail(
        `asciinema exited ${result.code}${result.stderr ? `:\n${result.stderr}` : ""}`,
      );
    if (!existsSync(options.output))
      fail(`asciinema did not create the recording: ${options.output}`);

    if (options.makeGif && agg) {
      const endTime = gifEndTimeBeforeTerminalExit(options.output);
      await run(agg, [
        options.output,
        gifPath,
        "--cols",
        String(COLUMNS),
        "--rows",
        String(ROWS),
        "--idle-time-limit",
        String(GIF_IDLE_LIMIT_SECONDS),
        "--select",
        `0..${endTime.toFixed(2)}s`,
      ]);
      console.log(`Trimmed GIF before terminal exit at ${endTime.toFixed(2)}s`);
      console.log(`GIF saved to ${gifPath}`);
    }
    console.log(`Recording saved to ${options.output}`);
  } finally {
    await tmux(socket, ["kill-server"]).catch(() => "");
    if (serverUrl && serverSession && serverPassword) {
      await fetch(`${serverUrl}/api/session/${serverSession}`, {
        method: "DELETE",
        headers: {
          authorization: `Basic ${Buffer.from(
            `opencode:${serverPassword}`,
          ).toString("base64")}`,
        },
      }).catch(() => {});
    }
    if (server) {
      server.kill();
      await server.exited.catch(() => {});
    }
    if (recorder && !recorderDone) {
      recorder.kill();
      await recorderResult?.catch(() => {});
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
