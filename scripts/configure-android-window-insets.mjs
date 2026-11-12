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

const classPattern = /class MainActivity\s*:\s*TauriActivity\s*\(\s*\)\s*(?:\{\s*\})?/;
const classMatch = source.match(classPattern);
if (!classMatch || classMatch.index === undefined) {
  throw new Error('Generated MainActivity.kt does not match the expected TauriActivity class shape; refusing to rewrite it.');
}
if (source.slice(classMatch.index + classMatch[0].length).trimStart().startsWith('{')) {
  throw new Error('Generated MainActivity.kt has a non-empty class body; refusing to discard existing native code.');
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

const activity = [
  'class MainActivity : TauriActivity() {',
  '    // ' + marker + ': Android edge-to-edge must not cover the WebView header/actions.',
  '    override fun onCreate(savedInstanceState: Bundle?) {',
  '        super.onCreate(savedInstanceState)',
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
  '            view.setPadding(',
  '                initialLeft + safe.left,',
  '                initialTop + safe.top,',
  '                initialRight + safe.right,',
  '                initialBottom',
  '            )',
  '            insets',
  '        }',
  '        ViewCompat.requestApplyInsets(content)',
  '    }',
  '}',
].join('\n');

source = source.replace(classPattern, activity);
fs.writeFileSync(activityPath, source, 'utf8');
console.log('Configured Android status-bar and display-cutout insets for the Tauri WebView.');
