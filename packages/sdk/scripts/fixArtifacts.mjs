import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { cwd } from "process";

const esmPath = join(cwd(), 'dist', 'esm', 'artifact.js');
const esmArtifacts = readFileSync(esmPath).toString();
writeFileSync(esmPath, esmArtifacts.split('\n').map(line => line.replace('../artifacts', '../../artifacts')).join('\n'))

const cjsPath = join(cwd(), 'dist', 'cjs', 'artifact.js');
const cjsArtifacts = readFileSync(cjsPath).toString();
writeFileSync(cjsPath, cjsArtifacts.split('\n').map(line => line.replace('../artifacts', '../../artifacts')).join('\n'))

console.log('fixArtifacts success.')
