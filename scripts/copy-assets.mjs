// Icons are not TypeScript, so tsc does not carry them into dist. n8n loads the
// icon from the path in the compiled node, so it has to sit next to the .js file.
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist/nodes/AwsBedrock', { recursive: true })
cpSync('nodes/AwsBedrock/awsBedrock.svg', 'dist/nodes/AwsBedrock/awsBedrock.svg')
console.log('copied node icon into dist')
