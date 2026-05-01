import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const REPOS = [
  'git@github.com:ForesightFlow/coordination-experiment.git',
  'git@github.com:ForesightFlow/foreflow-agents.git',
  'git@github.com:ForesightFlow/foreflow-agents-engine.git',
];
const INSTALL_ROOT = '/opt/foreflow';
const CRONTAB_EXAMPLE = join(
  new URL(import.meta.url).pathname,
  '..',
  '..',
  '..',
  'ops',
  'crontab.example',
);

function run(cmd: string): void {
  execSync(cmd, { stdio: 'inherit' });
}

function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function confirm(rl: readline.Interface, message: string): Promise<boolean> {
  const answer = await prompt(rl, `${message} [y/N] `);
  return answer.trim().toLowerCase() === 'y';
}

export async function bootstrapVps(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await doBootstrap(rl);
  } finally {
    rl.close();
  }
}

async function doBootstrap(rl: readline.Interface): Promise<void> {
  console.log('ForeFlow VPS bootstrap');
  console.log('This will clone three repos, install dependencies, copy .env.example,');
  console.log(`and install the crontab. Install root: ${INSTALL_ROOT}\n`);

  // Check git
  try {
    execSync('git --version', { stdio: 'pipe' });
  } catch {
    console.error('git is not installed. Install git and re-run.');
    process.exit(1);
  }

  // Check node
  try {
    const nodeVer = execSync('node --version', { stdio: 'pipe' }).toString().trim();
    console.log(`node: ${nodeVer}`);
  } catch {
    console.error('node is not installed. Install Node.js >=18 and re-run.');
    process.exit(1);
  }

  if (!(await confirm(rl, `Clone repos into ${INSTALL_ROOT}?`))) {
    console.log('Aborted.');
    return;
  }

  run(`mkdir -p ${INSTALL_ROOT}`);

  for (const repo of REPOS) {
    const repoName = repo.split('/').pop()!.replace('.git', '');
    const dest = join(INSTALL_ROOT, repoName);
    if (existsSync(dest)) {
      console.log(`${dest} already exists — skipping clone, pulling instead`);
      run(`git -C ${dest} pull`);
    } else {
      console.log(`Cloning ${repo}...`);
      run(`git clone ${repo} ${dest}`);
    }

    if (!(await confirm(rl, `Run npm install in ${dest}?`))) continue;
    run(`npm install --prefix ${dest}`);

    if (repoName !== 'coordination-experiment') {
      if (await confirm(rl, `Run npm run build in ${dest}?`)) {
        run(`npm run build --prefix ${dest}`);
      }
    }
  }

  const engineDir = join(INSTALL_ROOT, 'foreflow-agents-engine');
  const envTarget = join(INSTALL_ROOT, '.env');
  if (!existsSync(envTarget)) {
    const envExample = join(engineDir, '.env.example');
    if (existsSync(envExample)) {
      if (await confirm(rl, `Copy .env.example to ${envTarget}?`)) {
        copyFileSync(envExample, envTarget);
        run(`chmod 600 ${envTarget}`);
        console.log(`Copied. Edit ${envTarget} and fill in keys.`);
      }
    }
  } else {
    console.log(`${envTarget} already exists — skipping copy.`);
  }

  if (await confirm(rl, 'Install the example crontab (appends to current crontab)?')) {
    run(`mkdir -p /var/log/foreflow`);
    const tmp = '/tmp/foreflow-crontab.txt';
    run(`crontab -l 2>/dev/null > ${tmp} || true`);
    run(`cat ${CRONTAB_EXAMPLE} >> ${tmp}`);
    run(`crontab ${tmp}`);
    console.log('Crontab installed. Review with: crontab -l');
  }

  console.log('\n✓ Bootstrap complete.');
  console.log(`Next steps:`);
  console.log(`  1. Edit ${envTarget}`);
  console.log(`  2. Run: foreflow-engine register-all`);
  console.log(`  3. Run: foreflow-engine healthcheck`);
  console.log(`  4. See docs/DEPLOYMENT.md for full guide.`);
}
