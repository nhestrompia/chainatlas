#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_CONFIG = {
  defaults: {
    textureSize: 1024,
    simplify: 0.5,
    targetFormat: 'webp',
    skip: false,
  },
  rules: [
    { match: 'plane', skip: true },
    { match: 'characters', textureSize: 1024, simplify: 0.6 },
    { match: 'building', textureSize: 512, simplify: 0.35 },
    { match: 'props', textureSize: 512, simplify: 0.4 },
    { match: 'hero', textureSize: 2048, simplify: 0.75 },
  ],
};

function parseArgs(argv) {
  const args = {
    input: './assets',
    output: './optimized',
    tmp: './.tmp/asset-optimize',
    config: '',
    dryRun: false,
    keepTmp: false,
    recursive: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];

    if (a === '--input' || a === '-i') args.input = argv[++i];
    else if (a === '--output' || a === '-o') args.output = argv[++i];
    else if (a === '--tmp') args.tmp = argv[++i];
    else if (a === '--config' || a === '-c') args.config = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep-tmp') args.keepTmp = true;
    else if (a === '--no-recursive') args.recursive = false;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }

  return args;
}

function printHelp() {
  console.log(`Optimize GLB/GLTF assets with glTF Transform + gltfpack.\n\nUsage:\n  node scripts/optimize-3d-assets.mjs [options]\n\nOptions:\n  -i, --input <dir>      Input folder (default: ./assets)\n  -o, --output <dir>     Output folder (default: ./optimized)\n      --tmp <dir>        Temp folder (default: ./.tmp/asset-optimize)\n  -c, --config <file>    JSON config path\n      --dry-run          Print actions without running tools\n      --keep-tmp         Keep temporary files\n      --no-recursive     Only scan top-level input folder\n  -h, --help             Show this help\n\nConfig format:\n{\n  "defaults": { "textureSize": 1024, "simplify": 0.5, "targetFormat": "webp", "skip": false },\n  "rules": [\n    { "match": "plane", "skip": true },\n    { "match": "characters", "textureSize": 1024, "simplify": 0.6 },\n    { "match": "building", "textureSize": 512, "simplify": 0.35 }\n  ]\n}\n`);
}

function run(cmd, cmdArgs, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${cmd} ${cmdArgs.join(' ')}`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig(configPath) {
  if (!configPath) return DEFAULT_CONFIG;

  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);

  return {
    defaults: {
      ...DEFAULT_CONFIG.defaults,
      ...(parsed.defaults || {}),
    },
    rules: Array.isArray(parsed.rules) ? parsed.rules : DEFAULT_CONFIG.rules,
  };
}

function normalizePath(p) {
  return p.split(path.sep).join('/').toLowerCase();
}

function pickRule(relativePath, config) {
  const normalized = normalizePath(relativePath);

  for (const rule of config.rules) {
    if (!rule || !rule.match) continue;
    if (normalized.includes(String(rule.match).toLowerCase())) {
      return {
        textureSize: Number(rule.textureSize ?? config.defaults.textureSize),
        simplify: Number(rule.simplify ?? config.defaults.simplify),
        targetFormat: String(rule.targetFormat ?? config.defaults.targetFormat),
        skip: Boolean(rule.skip ?? config.defaults.skip),
      };
    }
  }

  return {
    textureSize: Number(config.defaults.textureSize),
    simplify: Number(config.defaults.simplify),
    targetFormat: String(config.defaults.targetFormat),
    skip: Boolean(config.defaults.skip),
  };
}

async function walk(dir, recursive) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!recursive) continue;
      out.push(...(await walk(full, recursive)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!/\.(glb|gltf)$/i.test(entry.name)) continue;

    out.push(full);
  }

  return out;
}

async function assertTool(tool, label, dryRun) {
  if (dryRun) return;

  const checker = process.platform === 'win32' ? 'where' : 'which';

  try {
    await run(checker, [tool], { dryRun: false });
  } catch (err) {
    throw new Error(
      `${label} not found in PATH. Install it and retry.\n` +
        `- glTF Transform CLI: https://gltf-transform.dev/cli\n` +
        `- gltfpack: https://github.com/zeux/meshoptimizer/tree/master/gltf\n` +
        `Original error: ${err.message}`,
    );
  }
}

async function getSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

function toMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function getTextureCommand(targetFormat) {
  const normalized = String(targetFormat || '').toLowerCase();
  if (normalized === 'avif') return 'avif';
  if (normalized === 'jpeg' || normalized === 'jpg') return 'jpeg';
  if (normalized === 'png') return 'png';
  return 'webp';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const inputDir = path.resolve(args.input);
  const outputDir = path.resolve(args.output);
  const tmpDir = path.resolve(args.tmp);
  const configPath = args.config ? path.resolve(args.config) : '';

  if (!(await exists(inputDir))) {
    throw new Error(`Input folder does not exist: ${inputDir}`);
  }

  const config = await loadConfig(configPath);

  await assertTool('gltf-transform', 'gltf-transform', args.dryRun);
  await assertTool('gltfpack', 'gltfpack', args.dryRun);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });

  const files = await walk(inputDir, args.recursive);

  if (!files.length) {
    console.log(`No .glb/.gltf files found in ${inputDir}`);
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;

  for (const inputFile of files) {
    const relative = path.relative(inputDir, inputFile);
    const rule = pickRule(relative, config);

    const outputFile = path
      .join(outputDir, relative)
      .replace(/\.(gltf|glb)$/i, '.glb');

    const tmpFile = path
      .join(tmpDir, relative)
      .replace(/\.(gltf|glb)$/i, '.glb');

    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });

    const before = args.dryRun ? 0 : await getSize(inputFile);
    totalBefore += before;

    console.log(`\nOptimizing: ${relative}`);
    if (rule.skip) {
      console.log('  preset: skip=true (copied unchanged)');
      if (!args.dryRun) {
        await fs.copyFile(inputFile, outputFile);
        const after = await getSize(outputFile);
        totalAfter += after;
        console.log(`  size: ${toMiB(before)} -> ${toMiB(after)} (saved 0.0%)`);
      } else {
        console.log(`[dry-run] copy ${inputFile} ${outputFile}`);
      }
      continue;
    }

    console.log(
      `  preset: texture=${rule.textureSize}px simplify=${rule.simplify} format=${rule.targetFormat}`,
    );

    await run('gltf-transform', ['copy', inputFile, tmpFile], {
      dryRun: args.dryRun,
    });

    await run(
      'gltf-transform',
      [
        'resize',
        tmpFile,
        tmpFile,
        '--width',
        String(rule.textureSize),
        '--height',
        String(rule.textureSize),
      ],
      { dryRun: args.dryRun },
    );

    const textureCommand = getTextureCommand(rule.targetFormat);

    await run(
      'gltf-transform',
      [
        textureCommand,
        tmpFile,
        tmpFile,
      ],
      { dryRun: args.dryRun },
    );

    await run(
      'gltfpack',
      [
        '-i',
        tmpFile,
        '-o',
        outputFile,
        '-cc',
        '-si',
        String(rule.simplify),
        '-kn',
        '-km',
      ],
      { dryRun: args.dryRun },
    );

    if (!args.dryRun) {
      const after = await getSize(outputFile);
      totalAfter += after;
      const saved = before - after;
      const pct = before > 0 ? ((saved / before) * 100).toFixed(1) : '0.0';

      console.log(`  size: ${toMiB(before)} -> ${toMiB(after)} (saved ${pct}%)`);
    }
  }

  if (!args.keepTmp && !args.dryRun) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  if (!args.dryRun) {
    const saved = totalBefore - totalAfter;
    const pct = totalBefore > 0 ? ((saved / totalBefore) * 100).toFixed(1) : '0.0';

    console.log('\nDone.');
    console.log(`Total: ${toMiB(totalBefore)} -> ${toMiB(totalAfter)} (saved ${pct}%)`);
    console.log(`Output: ${outputDir}`);
  } else {
    console.log('\nDry run complete.');
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
