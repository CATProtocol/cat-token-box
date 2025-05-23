const glob = require('glob');
const fs = require('fs');
const { basename, dirname, join } = require('path');

const updateRequires = (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  //replace local imports eg. require("./ecpair.js") to require("ecpair.cjs")
  content = content.replace(/require\("\.\/([^"]*)\.js"\)/g, "require('./$1.cjs')");
  content = content.replace(/require\("\.\.\/([^"]*)\.js"\)/g, "require('../$1.cjs')");

  fs.writeFileSync(filePath, content, 'utf8');
};

async function main() {
  const files = await glob.glob('dist/cjs/**/*.js', { nodir: true });
  files.forEach((file) => {
    updateRequires(file);
    const fileName = basename(file);
    const dir = dirname(file);
    fs.renameSync(file, join(dir, fileName.replace('.js', '.cjs')));
  });
}

main();
