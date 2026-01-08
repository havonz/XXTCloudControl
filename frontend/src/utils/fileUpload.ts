export interface ScannedFile {
  file: File;
  relativePath: string;
}

export async function scanEntries(items: DataTransferItemList): Promise<ScannedFile[]> {
  const scannedFiles: ScannedFile[] = [];

  const readAllEntries = async (dirReader: any): Promise<any[]> => {
    const entries: any[] = [];
    while (true) {
      const batch = await new Promise<any[]>((resolve, reject) => {
        dirReader.readEntries(resolve, reject);
      });
      if (!batch.length) break;
      entries.push(...batch);
    }
    return entries;
  };

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
      const entries = await readAllEntries(dirReader);
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
