const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\d.nichyparuk\\.gemini\\antigravity-cli\\brain';
const myConvId = '6b4de43e-1e93-484b-965e-8443c6bb989f';
const reportPath = path.join(brainDir, myConvId, 'skill-optimization-report.md');

let report = `# Lift-SDLC Skill Optimization Report\n\nThis report consolidates findings from 14 background subagents. Each agent analyzed a single \`SKILL.md\` file to identify token optimization opportunities (redundancies, excessive detail, or logic that can be offloaded to JS/Bash scripts) without sacrificing quality or functionality.\n\n---\n\n`;

function getSubdirs(dir) {
    return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory());
}

const dirs = getSubdirs(brainDir);
for (const d of dirs) {
    if (d === myConvId) continue;
    const logPath = path.join(brainDir, d, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf8').split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const step = JSON.parse(line);
                if (step.type === 'PLANNER_RESPONSE' && step.content && step.content.includes('### ')) {
                    report += step.content + '\n\n---\n\n';
                }
            } catch (e) {}
        }
    }
}

fs.writeFileSync(reportPath, report, 'utf8');
console.log('Report built successfully.');
