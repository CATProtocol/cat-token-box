import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { cwd } from "process";

const esmPath = join(cwd(), "dist", "esm", "artifact.js");

const esmArifact = readFileSync(esmPath).toString();

writeFileSync(
  esmPath,
  esmArifact
    .split("\n")
    .map((line) => line.replace("../artifacts", "../../artifacts"))
    .join("\n")
);

const cjsPath = join(cwd(), "dist", "cjs", "artifact.cjs");

const cjsArifact = readFileSync(cjsPath).toString();

writeFileSync(
  cjsPath,
  cjsArifact
    .split("\n")
    .map((line) => line.replace("../artifacts", "../../artifacts"))
    .join("\n")
);

console.log("fixArifacts success.");
