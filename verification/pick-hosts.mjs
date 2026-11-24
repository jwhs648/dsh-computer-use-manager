// Pick the DSH host versions CI verifies: the newest release candidate (required) and the
// newest alpha (early warning, only when it is newer than that RC). Prints GitHub output lines.
// Usage: node verification/pick-hosts.mjs
import { execSync } from 'node:child_process';

// A fixed command string: npm is a .cmd shim on Windows and needs a shell; no user input is involved.
const raw = execSync('npm view @deepseek-ai/dsh-app-boot versions --json', { encoding: 'utf8' });
const versions = [].concat(JSON.parse(raw));

const parse = version => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) return null;
  return { version, core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] };
};
const comparePre = (a, b) => {
  if (!a.length || !b.length) return b.length - a.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    const [x, y] = [a[index], b[index]];
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    const order = numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
    if (order) return order;
  }
  return 0;
};
const compare = (a, b) => a.core[0] - b.core[0] || a.core[1] - b.core[1] || a.core[2] - b.core[2] || comparePre(a.pre, b.pre);
const newest = channel => versions.map(parse).filter(item => item?.pre[0] === channel).sort(compare).at(-1) ?? null;

const rc = newest('rc');
const alpha = newest('alpha');
if (!rc) throw new Error('No release candidate of @deepseek-ai/dsh-app-boot was found.');
console.log('rc=' + rc.version);
console.log('alpha=' + (alpha && compare(alpha, rc) > 0 ? alpha.version : ''));
