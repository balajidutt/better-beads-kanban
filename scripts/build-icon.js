#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const SIZE = 256;
const svgPath = path.join(__dirname, '../images/icon.svg');
const pngPath = path.join(__dirname, '../images/icon.png');

try {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render();
  fs.writeFileSync(pngPath, rendered.asPng());
  console.log(`Wrote ${pngPath} (${rendered.width}x${rendered.height})`);
} catch (error) {
  console.error(`Error building icon: ${error.message}`);
  process.exit(1);
}
