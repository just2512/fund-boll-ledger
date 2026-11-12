import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const javaRoot = path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java');

function findMainActivities(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findMainActivities(fullPath));
    else if (entry.isFile() && entry.name === 'MainActivity.kt') found.push(fullPath);
  }
  return found;
}

const candidates = findMainActivities(javaRoot);
if (candidates.length !== 1) {
  throw new Error('Expected exactly one generated MainActivity.kt under ' + javaRoot + '; found ' + candidates.length + '. Refusing to patch an unknown Android project layout.');
}

const activityPath = candidates[0];
let source = fs.readFileSync(activityPath, 'utf8');
const marker = 'FUND_BOLL_LEDGER_SYSTEM_BAR_INSETS';
if (source.includes(marker)) {
  console.log('Android system-bar inset handling already configured.');
  process.exit(0);
}

const packageMatch = source.match(/^package [^\r\n]+/m);
if (!packageMatch) throw new Error('Generated MainActivity.kt has no package declaration.');

const imports = [
  'import android.os.Bundle',
  'import androidx.core.view.ViewCompat',
  'import androidx.core.view.WindowCompat',
  'import androidx.core.view.WindowInsetsCompat',
].filter((item) => !source.includes(item));
if (imports.length) source = source.replace(packageMatch[0], packageMatch[0] + '\n' + imports.join('\n'));

const superCall = 'super.onCreate(savedInstanceState)';
const superCallCount = source.split(superCall).length - 1;
if (superCallCount !== 1) {
  throw new Error('Expected exactly one existing super.onCreate(savedInstanceState) in generated MainActivity.kt; found ' + superCallCount + '. Refusing to replace the Tauri activity implementation.');
}

const insetSetup = [
  superCall,
  '        // ' + marker + ': preserve Tauri enableEdgeToEdge and inset the WebView below system bars.',
  '        WindowCompat.setDecorFitsSystemWindows(window, false)',
  '        val content = findViewById<android.view.View>(android.R.id.content)',
  '        val initialLeft = content.paddingLeft',
  '        val initialTop = content.paddingTop',
  '        val initialRight = content.paddingRight',
  '        val initialBottom = content.paddingBottom',
  '        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->',
  '            val safe = insets.getInsets(',
  '                WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()',
  '            )',
  '            val navigation = insets.getInsets(WindowInsetsCompat.Type.navigationBars())',
  '            val bottomInset = maxOf(safe.bottom, navigation.bottom)',
  '            view.setPadding(',
  '                initialLeft + safe.left,',
  '                initialTop + safe.top,',
  '                initialRight + safe.right,',
  '                initialBottom + bottomInset',
  '            )',
  '            insets',
  '        }',
  '        ViewCompat.requestApplyInsets(content)',
].join('\n');

source = source.replace(superCall, insetSetup);
fs.writeFileSync(activityPath, source, 'utf8');
console.log('Configured Android status-bar and display-cutout insets while preserving the generated Tauri MainActivity.');
