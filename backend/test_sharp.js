try {
  const sharp = require('sharp');
  console.log('SHARP IMPORT SUCCESSFUL! Version:', sharp.versions);
  process.exit(0);
} catch (error) {
  console.error('SHARP IMPORT FAILED:', error.message);
  process.exit(1);
}
