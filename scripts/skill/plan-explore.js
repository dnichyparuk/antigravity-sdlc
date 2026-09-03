#!/usr/bin/env node
/**
 * plan-explore.js
 * Pre-compute raw discovery materials for plan-sdlc's dynamic-dimension orchestrator.
 * Gathers scope-hint files, computes webResearchSignal, samples skill registry and
 * recent plans, writes manifest to a per-invocation tempdir, and emits the manifest
 * path via writeOutput.
 *
 * Note: webResearchSignal and keywordFiles are best-effort hints derived from stdin
 * (user prompt). plan.js forwards an empty string when stdin is not piped (TTY), so
 * these values may be false/empty in that case. The authoritative signal flows through
 * USER_PROMPT passed directly to plan-explore-orchestrator, which re-derives web-research
 * dimensions independently from the manifest's webResearchSignal.
 *
 * Implements P8–P12 of the plan-sdlc spec (R24 contract).
 *
 * Usage:
 *   node plan-explore.js [--from-openspec <change-name>]
 *   User prompt is read from stdin (chosen over --user-prompt-file to avoid
 *   introducing a new CLI surface and to sidestep argv length limits).
 *
 * Output: JSON file path written to stdout via writeOutput.
 * Stdout: file path only (via writeOutput protocol).
 * Stderr: warnings / progress.
 * Exit codes: always 0 — failures surface as output.error (R28 fallback contract).
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, '..', 'lib');

const { resolveSdlcRoot }                       = require(path.join(LIB, 'config'));
const { writeOutput }                           = require(path.join(LIB, 'output'));
const { slugifyBranch }                         = require(path.join(LIB, 'state'));
const { exec, detectBaseBranch, getChangedFiles } = require(path.join(LIB, 'git'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Best-practice trigger phrases (case-insensitive regex)
const WEB_PHRASE_REGEX = /best practice|recommended|industry standard|state of the art|compare alternatives|alternatives to/i;

// External-tech vocabulary — additions require a code change + test
const EXTERNAL_TECH_VOCAB = new Set([
  'oauth', 'jwt', 'kafka', 'redis', 'kubernetes', 'terraform',
  'react', 'vue', 'angular', 'postgres', 'mongodb', 'graphql',
  'grpc', 'websocket', 'oauth2', 'openid', 'saml',
]);

// Common English stopwords for keyword extraction
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
  'those', 'it', 'its', 'i', 'we', 'you', 'he', 'she', 'they', 'me',
  'us', 'him', 'her', 'them', 'my', 'our', 'your', 'his', 'our', 'their',
  'what', 'which', 'who', 'when', 'where', 'how', 'why', 'not', 'no',
  'so', 'if', 'as', 'up', 'out', 'about', 'into', 'through', 'than',
  'then', 'new', 'add', 'use', 'get', 'set', 'run', 'make',
]);

const MAX_SCOPE_HINT_FILES = 30;
const MAX_KEYWORD_TOKENS   = 8;
const MAX_SKILL_SAMPLES    = 12;
const MAX_RECENT_PLANS     = 20;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  let fromOpenspec = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-openspec' && args[i + 1]) {
      fromOpenspec = args[++i];
    }
  }

  return { fromOpenspec };
}

// ---------------------------------------------------------------------------
// Scope-hint: git changed files
// ---------------------------------------------------------------------------

function getGitScopeFiles(projectRoot) {
  try {
    const base = detectBaseBranch(projectRoot);
    return getChangedFiles(base, projectRoot, 'all');
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scope-hint: OpenSpec backtick paths from proposal.md + delta specs
// ---------------------------------------------------------------------------

function getOpenSpecPaths(projectRoot, changeName) {
  const paths = new Set();
  const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);

  if (!fs.existsSync(changeDir)) return [];

  // Parse proposal.md and delta specs for backtick-quoted paths
  const filesToScan = [];
  const proposalPath = path.join(changeDir, 'proposal.md');
  if (fs.existsSync(proposalPath)) filesToScan.push(proposalPath);

  const specsDir = path.join(changeDir, 'specs');
  if (fs.existsSync(specsDir)) {
    try {
      for (const f of fs.readdirSync(specsDir)) {
        if (f.endsWith('.md')) filesToScan.push(path.join(specsDir, f));
      }
    } catch (_) { /* ignore */ }
  }

  const BACKTICK_PATH_RE = /`([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,10})`/g;
  for (const filePath of filesToScan) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      let m;
      while ((m = BACKTICK_PATH_RE.exec(content)) !== null) {
        const p = m[1];
        // Only include paths that look like relative file paths
        if (!p.startsWith('/') && p.includes('.')) {
          paths.add(p);
        }
      }
    } catch (_) { /* ignore */ }
  }

  return Array.from(paths);
}

// ---------------------------------------------------------------------------
// Scope-hint: keyword grep
// ---------------------------------------------------------------------------

function getKeywordScopeFiles(userPrompt, projectRoot) {
  if (!userPrompt) return [];

  // Tokenize: split on non-alphanumeric, lowercase, filter stopwords
  const tokens = userPrompt
    .toLowerCase()
    .split(/[^a-zA-Z0-9]+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));

  // Deduplicate and cap
  const unique = [...new Set(tokens)].slice(0, MAX_KEYWORD_TOKENS);

  const files = new Set();
  for (const token of unique) {
    try {
      // git grep -l -i returns filenames only; exits non-zero when nothing matches.
      // Use spawnSync with arg array (no shell) to avoid shell-injection / quoting fragility.
      const result = spawnSync('git', ['grep', '-l', '-i', token], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      if (result.status === 0 && result.stdout) {
        for (const f of result.stdout.split('\n').filter(Boolean)) {
          files.add(f);
        }
      }
    } catch (_) { /* no matches — skip */ }
  }

  return Array.from(files);
}

// ---------------------------------------------------------------------------
// webResearchSignal computation
// ---------------------------------------------------------------------------

function computeWebResearchSignal(userPrompt) {
  if (!userPrompt) return false;

  // Phrase match
  if (WEB_PHRASE_REGEX.test(userPrompt)) return true;

  // Token match against external-tech vocab
  const tokens = userPrompt.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  for (const t of tokens) {
    if (EXTERNAL_TECH_VOCAB.has(t)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Sibling-skill registry sample
// ---------------------------------------------------------------------------

function sampleSkillRegistry() {
  const skills = [];
  const pluginDirs = [
    path.join(os.homedir(), '.gemini', 'config', 'plugins'),
  ];

  for (const pluginDir of pluginDirs) {
    if (!fs.existsSync(pluginDir)) continue;
    try {
      for (const pluginEntry of fs.readdirSync(pluginDir)) {
        const skillsDir = path.join(pluginDir, pluginEntry, 'skills');
        if (!fs.existsSync(skillsDir)) continue;
        try {
          for (const skillEntry of fs.readdirSync(skillsDir)) {
            if (skills.length >= MAX_SKILL_SAMPLES) break;
            const skillMdPath = path.join(skillsDir, skillEntry, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;
            try {
              const content = fs.readFileSync(skillMdPath, 'utf8');
              // Extract frontmatter (lines between first --- and second ---)
              const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
              if (fmMatch) {
                skills.push({ skill: skillEntry, frontmatter: fmMatch[1].trim() });
              }
            } catch (_) { /* skip unreadable */ }
          }
        } catch (_) { /* skip unreadable */ }
        if (skills.length >= MAX_SKILL_SAMPLES) break;
      }
    } catch (_) { /* skip unreadable */ }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Recent plans sample
// ---------------------------------------------------------------------------

function sampleRecentPlans(projectRoot) {
  // Try to read plansDirectory from settings.json (same resolution as plan-sdlc SKILL.md)
  const candidateDirs = [];

  // Global settings
  const globalSettings = path.join(os.homedir(), '.gemini/antigravity-cli', 'settings.json');
  if (fs.existsSync(globalSettings)) {
    try {
      const s = JSON.parse(fs.readFileSync(globalSettings, 'utf8'));
      if (s.plansDirectory) candidateDirs.push(s.plansDirectory);
    } catch (_) { /* ignore */ }
  }

  // Project settings
  const projectSettings = path.join(projectRoot, '.gemini/antigravity-cli', 'settings.json');
  if (fs.existsSync(projectSettings)) {
    try {
      const s = JSON.parse(fs.readFileSync(projectSettings, 'utf8'));
      if (s.plansDirectory) candidateDirs.unshift(s.plansDirectory); // project takes precedence
    } catch (_) { /* ignore */ }
  }

  // Fallback
  candidateDirs.push(path.join(os.homedir(), '.gemini', 'plans'));

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          try {
            const stat = fs.statSync(path.join(dir, f));
            return { name: f, mtime: stat.mtimeMs };
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, MAX_RECENT_PLANS)
        .map(e => e.name);
      return entries;
    } catch (_) {
      continue;
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { fromOpenspec } = parseArgs(process.argv);

  // Read user prompt from stdin
  // (chosen over --user-prompt-file to avoid new CLI surface + argv length limits)
  let userPrompt = '';
  try {
    if (!process.stdin.isTTY) {
      userPrompt = fs.readFileSync('/dev/stdin', 'utf8').trim();
    }
  } catch (_) { /* no stdin — continue with empty prompt */ }

  let projectRoot;
  try {
    projectRoot = resolveSdlcRoot({ cwd: process.cwd() });
  } catch (err) {
    // workspace-mode-compatibility: resolveSdlcRoot walks back to main worktree
    const output = {
      manifestPath: null,
      outDir: null,
      scopeHintCount: 0,
      webResearchSignal: false,
      error: `resolveSdlcRoot failed: ${err.message}`,
    };
    writeOutput(output, 'plan-explore', 0);
    return;
  }

  try {
    // 1. Git scope files
    const gitFiles = getGitScopeFiles(projectRoot);

    // 2. OpenSpec backtick paths
    const openspecFiles = fromOpenspec ? getOpenSpecPaths(projectRoot, fromOpenspec) : [];

    // 3. Keyword grep files
    const keywordFiles = getKeywordScopeFiles(userPrompt, projectRoot);

    // Merge and cap scope-hint set
    const scopeHintSet = new Set([...gitFiles, ...openspecFiles, ...keywordFiles]);
    const scopeHintFiles = Array.from(scopeHintSet).slice(0, MAX_SCOPE_HINT_FILES);
    const scopeHintCount = scopeHintFiles.length;

    // 4. webResearchSignal
    const webResearchSignal = computeWebResearchSignal(userPrompt);

    // 5. Sibling-skill registry sample
    const skillRegistry = sampleSkillRegistry();

    // 6. Recent plans sample
    const recentPlans = sampleRecentPlans(projectRoot);

    // 7. Get current branch slug for tempdir naming
    let branchSlug = 'unknown';
    try {
      const branch = exec('git branch --show-current', { cwd: projectRoot });
      if (branch) branchSlug = slugifyBranch(branch);
    } catch (_) { /* use default */ }

    // 8. Create per-invocation tempdir
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `sdlc-explore-${branchSlug}-`));

    // 9. Write manifest.json
    const manifest = {
      version: 1,
      timestamp: new Date().toISOString(),
      projectRoot,
      fromOpenspec: fromOpenspec || null,
      userPromptLength: userPrompt.length,
      webResearchSignal,
      scopeHintCount,
      scopeHintFiles,
      skillRegistry,
      recentPlans,
      outDir,
    };
    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    // 10. Emit output
    const output = {
      manifestPath,
      outDir,
      scopeHintCount,
      webResearchSignal,
      error: null,
    };
    writeOutput(output, 'plan-explore', 0);

  } catch (err) {
    // R28: any unrecoverable error surfaces as output.error; exit 0 so plan.js can fall back
    const output = {
      manifestPath: null,
      outDir: null,
      scopeHintCount: 0,
      webResearchSignal: false,
      error: err.message || String(err),
    };
    writeOutput(output, 'plan-explore', 0);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    // Top-level catch: still emit valid JSON with error rather than crashing
    process.stderr.write(`plan-explore.js fatal: ${err.message}\n${err.stack}\n`);
    const { writeOutput: wo } = require(path.join(LIB, 'output'));
    wo({
      manifestPath: null,
      outDir: null,
      scopeHintCount: 0,
      webResearchSignal: false,
      error: err.message || String(err),
    }, 'plan-explore', 0);
  }
}
