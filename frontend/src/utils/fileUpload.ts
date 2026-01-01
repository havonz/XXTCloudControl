export interface ScannedFile {
  file: File;
  relativePath: string;
}

export async function scanEntries(items: DataTransferItemList): Promise<ScannedFile[]> {
  const scannedFiles: ScannedFile[] = [];

  const readEntry = async (entry: any, path: string = "") => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
      });
      scannedFiles.push({
        file,
        relativePath: path ? `${path}/${file.name}` : file.name,
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const entries = await new Promise<any[]>((resolve, reject) => {
        dirReader.readEntries(resolve, reject);
      });
      for (const childEntry of entries) {
        await readEntry(childEntry, path ? `${path}/${entry.name}` : entry.name);
      }
    }
  };

  const tasks: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file") {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        tasks.push(readEntry(entry));
      }
    }
  }

  await Promise.all(tasks);
  return scannedFiles;
}
