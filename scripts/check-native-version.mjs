import fs from 'node:fs';

const props = fs.readFileSync(new URL('../Directory.Build.props', import.meta.url), 'utf8');
const match = props.match(/<Version>(\d+\.\d+\.\d+)<\/Version>/);
if (!match) throw new Error('Directory.Build.props must contain a three-part native <Version>.');

const version = match[1];
if (process.argv.includes('--print')) {
  console.log(version);
  process.exit(0);
}
const tag = process.argv[2];
if (tag && tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match native version v${version}.`);
}
console.log(`Native version ${version}${tag ? ` matches ${tag}` : ''}.`);
