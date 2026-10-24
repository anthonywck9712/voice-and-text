import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const modules = new Map();
async function moduleUrl(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const { outputText } = ts.transpileModule(await readFile(url, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  let source = outputText.replaceAll(
    'import.meta.url',
    JSON.stringify(url.href),
  );
  const imports = [...source.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)];
  for (const match of imports) {
    const dependency = new URL(
      match[2] + (match[2].endsWith('.ts') ? '' : '.ts'),
      url,
    );
    source = source.replace(match[0], `from '${await moduleUrl(dependency)}'`);
  }
  const result =
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  modules.set(url.href, result);
  return result;
}
export async function loadBrowserModule(path) {
  return import(await moduleUrl(new URL(path, import.meta.url)));
}
