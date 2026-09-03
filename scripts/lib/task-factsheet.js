'use strict';

/**
 * task-factsheet.js
 * Writes per-task fact sheets used by wave-runner per-task Agent dispatches.
 *
 * Each task gets a compact markdown file at:
 *   <stateDir>/execution/<runId>/task-<id>.md
 *
 * Per-task agents reference {FACT_SHEET_PATH} instead of inlining the full
 * task body — reduces per-agent context footprint (R-FACT-SHEET-DISPATCH, #432).
 *
 * Zero npm dependencies.
 */

const fs   = require('node:fs');
const path = require('node:path');

/**
 * Render a task as compact markdown.
 * @param {{ id: string, name: string, description: string, acceptanceCriteria: string[], files: string[] }} task
 * @returns {string}
 */
function renderFactSheet(task) {
  const lines = [];

  lines.push(`# Task ${task.id}: ${task.name}`);
  lines.push('');

  if (task.description && task.description.trim()) {
    lines.push('## Description');
    lines.push('');
    lines.push(task.description.trim());
    lines.push('');
  }

  if (Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0) {
    lines.push('## Acceptance Criteria');
    lines.push('');
    for (const criterion of task.acceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
    lines.push('');
  }

  if (Array.isArray(task.files) && task.files.length > 0) {
    lines.push('## Files');
    lines.push('');
    for (const f of task.files) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Normalize a task ID to its canonical numeric form (R-IDNORM).
 * Strips a single leading 'T' or 't' so "T1" and "1" map to the same file.
 * Comparison-only: the caller's raw ID is unchanged.
 *
 * @param {string} taskId
 * @returns {string}
 */
function normalizeTaskId(taskId) {
  if (typeof taskId !== 'string') return taskId;
  return taskId.trim().replace(/^[Tt](?=\d)/, '');
}

/**
 * Return the absolute path for a task's fact sheet.
 * @param {{ runId: string, taskId: string, stateDir: string }} opts
 * @returns {string}
 */
function taskFactSheetPath({ runId, taskId, stateDir }) {
  if (!runId) throw new Error('taskFactSheetPath: runId is required');
  if (!taskId) throw new Error('taskFactSheetPath: taskId is required');
  if (!stateDir) throw new Error('taskFactSheetPath: stateDir is required');
  return path.join(stateDir, runId, `task-${normalizeTaskId(taskId)}.md`);
}

/**
 * Write a fact sheet for a single task. Idempotent: if the file already
 * exists with identical content, the mtime is unchanged (no write performed).
 * If content differs, the file is atomically rewritten.
 *
 * @param {{ id: string, name: string, description: string, acceptanceCriteria: string[], files: string[] }} task
 * @param {{ runId: string, stateDir: string }} opts
 * @returns {string} Absolute path of the written fact sheet
 */
function writeTaskFactSheet(task, { runId, stateDir }) {
  if (!task || !task.id) throw new Error('writeTaskFactSheet: task.id is required');
  if (!runId) throw new Error('writeTaskFactSheet: runId is required');
  if (!stateDir) throw new Error('writeTaskFactSheet: stateDir is required');

  const filePath = taskFactSheetPath({ runId, taskId: task.id, stateDir });
  const dir = path.dirname(filePath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = renderFactSheet(task);

  // Idempotency: skip write if content matches
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) {
      return filePath; // no-op
    }
  }

  // Atomic write via tmp→rename
  const crypto = require('node:crypto');
  const suffix = crypto.randomBytes(4).toString('hex');
  const tmp = path.join(dir, `task-${normalizeTaskId(task.id)}.${suffix}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);

  return filePath;
}

module.exports = { writeTaskFactSheet, taskFactSheetPath, renderFactSheet, normalizeTaskId };
