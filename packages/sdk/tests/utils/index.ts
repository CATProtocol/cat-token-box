import { join } from 'path';
import { readFileSync } from 'fs';

export function readArtifact(artifactFileName: string) {
    const filePath = join(process.cwd(), artifactFileName);
    return JSON.parse(readFileSync(filePath, 'utf-8'));
}
