const { pngToIco } = require('png-to-ico');
const path = require('path');
const fs = require('fs');

const inputFile = path.join(__dirname, '..', 'wc3lan.png');
const outputDir = path.join(__dirname, 'build');
const outputFile = path.join(outputDir, 'icon.ico');

// Create build directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`Converting ${inputFile} to ${outputFile}...`);

pngToIco(inputFile)
  .then(buf => {
    fs.writeFileSync(outputFile, buf);
    console.log('✓ Icon converted successfully to', outputFile);
  })
  .catch(err => {
    console.error('✗ Error converting icon:', err.message);
    process.exit(1);
  });
