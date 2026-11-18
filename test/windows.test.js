// Windows and PowerShell parts. Pure functions, so they run on any platform;
// the PowerShell syntax checks run only where powershell.exe is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentKey, hookOwner, hookPayload, psQuote, psResumeLine, psResumeScript } from "../mods/revive/lib/core.js";
import { splitWinArgs, parseWinProcesses, psShellBlock, editRc, blocksProfile } from "../mods/revive/revive.mjs";

const rec = (extra = {}) => ({
  agent: "claude", session: "4f1c2a9e-7b3d-4e8a-9c21-5d6e7f8a9b0c", cwd: "C:\\work\\proj",
  flags: ["--dangerously-skip-permissions"], env: {}, ...extra,
});

test("Windows command lines split the way CommandLineToArgvW does", () => {
  assert.deepEqual(splitWinArgs('"C:\\Users\\me\\.local\\bin\\claude.exe" --dangerously-skip-permissions'),
    ["C:\\Users\\me\\.local\\bin\\claude.exe", "--dangerously-skip-permissions"]);
  assert.deepEqual(splitWinArgs('node "C:\\a b\\cli.js"  --model  opus'), ["node", "C:\\a b\\cli.js", "--model", "opus"]);
  assert.deepEqual(splitWinArgs('a "b\\"c" "d\\\\" e'), ["a", 'b"c', "d\\", "e"]);
  assert.deepEqual(splitWinArgs('x ""'), ["x", ""]);
  assert.deepEqual(splitWinArgs(""), []);
});

test("Windows paths and .exe names are recognized as agents", () => {
  assert.equal(agentKey(null, ["C:\\Users\\me\\.local\\bin\\claude.exe", "--resume", "x"]), "claude");
  assert.equal(agentKey(null, ["node", "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd"]), "codex");
  assert.equal(agentKey(null, ["C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoExit"]), null);
  assert.equal(agentKey(null, ["C:\\Users\\me\\.local\\share\\cursor-agent\\versions\\1\\agent.exe"]), "cursor");
});

test("a Windows transcript path names its agent", () => {
  assert.equal(hookPayload({ transcript_path: "C:\\Users\\me\\.claude\\projects\\D--x\\a.jsonl" }).agent, "claude");
  assert.equal(hookPayload({ transcript_path: "C:\\Users\\me\\.codex\\sessions\\a.jsonl" }).agent, "codex");
});

test("the process table parses, and a hook walks up through cmd and PowerShell to the agent", () => {
  const table = parseWinProcesses([
    "36708\t30652\t2026-11-05T00:25:08.847Z\tnode C:/x/revive.mjs hook",
    "30652\t20088\t2026-11-05T00:25:08.781Z\tC:\\WINDOWS\\System32\\cmd.exe /d /s /c \"node C:/x/revive.mjs hook\"",
    "20088\t22012\t2026-11-05T00:19:13.448Z\t\"C:\\Users\\me\\.local\\bin\\claude.exe\" --dangerously-skip-permissions",
    "22012\t3068\t2026-11-04T05:07:10.245Z\tC:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoExit -Command \"x\"",
    "",
    "garbage",
  ].join("\r\n"));
  assert.equal(table.size, 4);
  assert.deepEqual(table.get(20088), { ppid: 22012, since: "2026-11-05T00:19:13.448Z", argv: ["C:\\Users\\me\\.local\\bin\\claude.exe", "--dangerously-skip-permissions"] });
  assert.deepEqual(hookOwner(table, 30652, 22012), { owned: true, agent: 20088 });
});

test("PowerShell quoting leaves plain words bare and doubles single quotes", () => {
  assert.equal(psQuote("--model"), "--model");
  assert.equal(psQuote("C:\\work\\proj"), "C:\\work\\proj");
  assert.equal(psQuote("C:\\My Projects\\x"), "'C:\\My Projects\\x'");
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(psQuote("$env:X"), "'$env:X'");
  assert.equal(psQuote("@a"), "'@a'");
  assert.equal(psQuote("a,b"), "'a,b'");
});

test("the typed resume line goes to the folder, then runs the agent", () => {
  assert.equal(psResumeLine(rec()),
    "Set-Location -LiteralPath C:\\work\\proj -ErrorAction Stop; & claude --dangerously-skip-permissions --resume 4f1c2a9e-7b3d-4e8a-9c21-5d6e7f8a9b0c");
  // Variables are not carried (upstream 0.5+: a record names them as `needs`).
  assert.equal(psResumeLine(rec({ env: { CLAUDE_CONFIG_DIR: "C:\\Users\\me\\.claude-work" }, cwd: null })),
    "& claude --dangerously-skip-permissions --resume 4f1c2a9e-7b3d-4e8a-9c21-5d6e7f8a9b0c");
  assert.equal(psResumeLine(rec({ session: "bad id; rm -r" })), "");
});

test("the automatic resume leaves out what lifts approvals, and hands the agent its flags", () => {
  const script = psResumeScript(rec(), "C:\\x\\revive.mjs");
  assert.match(script, /^  & claude --resume 4f1c2a9e-7b3d-4e8a-9c21-5d6e7f8a9b0c$/m);
  assert.match(script, /without --dangerously-skip-permissions/);
  assert.match(script, /^  \$env:REVIVE_RESUME = '\{"agent":"claude","session":"4f1c2a9e-7b3d-4e8a-9c21-5d6e7f8a9b0c","flags":\["--dangerously-skip-permissions"\]\}'$/m);
  assert.match(script, /^  Remove-Item Env:REVIVE_RESUME -ErrorAction SilentlyContinue$/m);
});

test("the resume script and the profile block are ASCII", () => {
  const ascii = (s) => /^[\x00-\x7f]*$/.test(s);
  assert.ok(ascii(psResumeScript(rec(), "C:\\x\\revive.mjs")));
  assert.ok(ascii(psShellBlock("C:\\x\\revive.mjs")));
});

/** PowerShell's own parser: errors in the text, without running it. */
function psParseErrors(text) {
  const script = "$e = $null; [void][Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$null, [ref]$e); $e.Count";
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { input: text, encoding: "utf8" }).trim());
}

test("the resume script, the typed line and the profile block parse as PowerShell", { skip: process.platform !== "win32" }, () => {
  const env = rec({ env: { CLAUDE_CONFIG_DIR: "C:\\a b\\.claude" }, flags: ["--add-dir", "C:\\it's here", "--model", "opus"] });
  assert.equal(psParseErrors(psResumeScript(env, "C:\\x y\\revive.mjs")), 0);
  assert.equal(psParseErrors(psResumeLine(env)), 0);
  assert.equal(psParseErrors(psShellBlock("C:\\x y\\revive.mjs")), 0);
});

test("the profile keeps its own encoding and bytes when the block goes in and out", { skip: process.platform !== "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "revive-rc-"));
  try {
    const korean = "# 한글 주석\r\nSet-Alias ll Get-ChildItem\r\n";
    const cases = {
      "utf8-bom.ps1": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(korean, "utf8")]),
      "utf8.ps1": Buffer.from(korean, "utf8"),
      "utf16.ps1": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(korean, "utf16le")]),
      "cp949.ps1": Buffer.from([0x23, 0x20, 0xc7, 0xd1, 0xb1, 0xdb, 0x0d, 0x0a]), // "# 한글" in CP949
    };
    for (const [name, bytes] of Object.entries(cases)) {
      const file = join(dir, name);
      writeFileSync(file, bytes);
      assert.equal(editRc(file), true, name);
      const after = readFileSync(file);
      assert.deepEqual(after.subarray(0, bytes.length), bytes, `${name}: the original bytes stay`);
      const text = name === "utf16.ps1" ? after.toString("utf16le") : after.toString("latin1");
      assert.ok(text.includes("# >>> herdr-revive >>>"), `${name}: block in`);
      assert.equal(editRc(file), false, `${name}: a second install changes nothing`);
      assert.deepEqual(readFileSync(`${file}.revive-backup`), bytes, `${name}: backup is the original`);
      editRc(file, true);
      const back = readFileSync(file);
      const backText = name === "utf16.ps1" ? back.toString("utf16le") : back.toString("latin1");
      assert.ok(!backText.includes("herdr-revive"), `${name}: block out`);
      assert.deepEqual(back.subarray(0, bytes.length), bytes, `${name}: still the original bytes`);
    }
    const fresh = join(dir, "sub", "new.ps1");
    editRc(fresh);
    assert.ok(existsSync(fresh) && !existsSync(`${fresh}.revive-backup`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a switch a wrapper adds again is carried once", async () => {
  const { carriedFlags } = await import("../mods/revive/lib/core.js");
  assert.deepEqual(carriedFlags("claude", ["claude.exe", "--dangerously-skip-permissions", "--dangerously-skip-permissions", "--model", "opus", "--resume", "x"]),
    ["--dangerously-skip-permissions", "--model", "opus"]);
});

test("a folder of one's own passes the folder check, though Node reports it as 0666", { skip: process.platform !== "win32" }, async () => {
  const { vetRecord } = await import("../mods/revive/revive.mjs");
  const dir = mkdtempSync(join(tmpdir(), "revive-vet-"));
  try {
    const out = vetRecord({ cwd: dir });
    assert.equal(out.cwdRefused, undefined);
    assert.ok(out.cwd);
    assert.equal(vetRecord({ cwd: join(dir, "gone") }).cwdRefused, join(dir, "gone"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Claude Code's start folder is read from a transcript with a Windows path", async () => {
  const { claudeStartFolder } = await import("../mods/revive/lib/sessions.js");
  const claude = mkdtempSync(join(tmpdir(), "revive-claude-"));
  const id = "4f1c2a9e-7b3d-4e8a-9c21-5d6e7f8a9b0c";
  const cwd = "C:\\work\\proj";
  try {
    const projects = join(claude, "projects", "C--work-proj");
    mkdirSync(projects, { recursive: true });
    writeFileSync(join(projects, `${id}.jsonl`), `${JSON.stringify({ type: "user", cwd })}\n`);
    assert.deepEqual(claudeStartFolder({ dirs: { claude }, session: id, cwd }), { cwd });
  } finally { rmSync(claude, { recursive: true, force: true }); }
});

test("Restricted and AllSigned keep PowerShell from loading the profile", () => {
  assert.equal(blocksProfile("Restricted"), true);
  assert.equal(blocksProfile("AllSigned"), true);
  for (const p of ["RemoteSigned", "Unrestricted", "Bypass", null]) assert.equal(blocksProfile(p), false, String(p));
});

test("doctor reports each PowerShell's execution policy", { skip: process.platform !== "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "revive-doctor-"));
  try {
    const env = {
      ...process.env, USERPROFILE: home, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), CODEX_HOME: join(home, ".codex"),
      PI_CODING_AGENT_DIR: join(home, ".pi"), REVIVE_HC: join(home, "no-such-hc"),
      // The process scope, which PowerShell reads from this variable, wins over the user's own setting.
      PSExecutionPolicyPreference: "Restricted",
    };
    const out = JSON.parse(execFileSync("node", [join(import.meta.dirname, "..", "mods", "revive", "revive.mjs"), "doctor"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    assert.equal(out.executionPolicy.powershell, "Restricted");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
