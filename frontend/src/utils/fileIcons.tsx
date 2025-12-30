import type { JSX } from 'solid-js';
import {
  IconFile,
  IconFileCode,
  IconFileLines,
  IconFilePdf,
  IconFileZipper,
  IconFolder,
  IconImage,
  IconDatabase,
  IconApple,
  IconLua,
  IconFiletypeJs,
  IconFiletypeJsx,
  IconFiletypeTsx,
  IconFiletypeJson,
  IconFiletypeXml,
  IconFiletypeYml,
  IconAndroid,
  IconJava,
  IconTerminalDebian,
} from '../icons';

interface FileIconOptions {
  isDirectory?: boolean;
  size?: number;
}

/**
 * 根据文件扩展名返回统一的图标组件
 */
export function renderFileIcon(name: string, options: FileIconOptions = {}): JSX.Element {
  const size = options.size ?? 16;

  if (options.isDirectory) {
    return <IconFolder size={size} />;
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  switch (ext) {
    case 'js':
      return <IconFiletypeJs size={size} />;
    case 'jsx':
      return <IconFiletypeJsx size={size} />;
    case 'ts':
    case 'tsx':
      return <IconFiletypeTsx size={size} />;
    case 'lua':
      return <IconLua size={size} />;
    case 'json':
      return <IconFiletypeJson size={size} />;
    case 'xml':
      return <IconFiletypeXml size={size} />;
    case 'yml':
    case 'yaml':
      return <IconFiletypeYml size={size} />;
    case 'go':
    case 'py':
    case 'sh':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'java':
    case 'kt':
    case 'rs':
    case 'rb':
    case 'php':
    case 'swift':
      return <IconFileCode size={size} />;
    case 'md':
    case 'mdx':
    case 'txt':
    case 'log':
    case 'xui':
    case 'conf':
    case 'ini':
    case 'properties':
    case 'cfg':
    case 'toml':
    case 'htm':
    case 'html':
      return <IconFileLines size={size} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'svg':
      return <IconImage size={size} />;
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
    case 'bz2':
    case 'xz':
    case 'lzma':
    case 'zst':
      return <IconFileZipper size={size} />;
    case 'jar':
      return <IconJava size={size} />;
    case 'apk':
      return <IconAndroid size={size} />;
    case 'db':
    case 'sqlite':
    case 'sqlite3':
    case 'mdb':
    case 'accdb':
      return <IconDatabase size={size} />;
    case 'deb':
      return <IconTerminalDebian size={size} />;
    case 'ipa':
      return <IconApple size={size} />;
    case 'pdf':
      return <IconFilePdf size={size} />;
    default:
      return <IconFile size={size} />;
  }
}
