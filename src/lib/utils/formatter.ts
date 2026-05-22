import * as prettier from 'prettier/standalone';
import parserBabel from 'prettier/plugins/babel';
import parserEstree from 'prettier/plugins/estree';
import parserHtml from 'prettier/plugins/html';
import parserPostcss from 'prettier/plugins/postcss';
import parserMarkdown from 'prettier/plugins/markdown';

export async function formatCode(content: string, filepath: string): Promise<string> {
  const ext = filepath.split('.').pop()?.toLowerCase();
  let parser = '';
  let plugins: any[] = [];

  switch (ext) {
    case 'js':
    case 'jsx':
      parser = 'babel';
      plugins = [parserBabel, parserEstree];
      break;
    case 'ts':
    case 'tsx':
      parser = 'babel-ts';
      plugins = [parserBabel, parserEstree];
      break;
    case 'json':
      parser = 'json';
      plugins = [parserBabel, parserEstree];
      break;
    case 'css':
      parser = 'css';
      plugins = [parserPostcss];
      break;
    case 'html':
      parser = 'html';
      plugins = [parserHtml, parserPostcss, parserBabel, parserEstree];
      break;
    case 'md':
    case 'markdown':
      parser = 'markdown';
      plugins = [parserMarkdown];
      break;
    default:
      // Unsupported extension, return original content as-is
      return content;
  }

  try {
    const formatted = await prettier.format(content, {
      parser,
      plugins,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'es5',
      printWidth: 80,
    });
    return formatted;
  } catch (err) {
    console.error('Formatter error:', err);
    throw err;
  }
}
