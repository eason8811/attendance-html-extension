const DATABASE_NAME = "attendance-html-collector";
const DATABASE_VERSION = 1;
const STORE_NAME = "directory-handles";
const SELECTED_DIRECTORY_KEY = "selected-root";

interface DirectoryRecord {
  id: typeof SELECTED_DIRECTORY_KEY;
  handle: FileSystemDirectoryHandle;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地目录存储。"));
    request.onblocked = () => reject(new Error("目录存储正在升级，请关闭其他扩展侧边栏后重试。"));
  });
}

export async function loadSelectedDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const database = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction
        .objectStore(STORE_NAME)
        .get(SELECTED_DIRECTORY_KEY) as IDBRequest<DirectoryRecord | undefined>;

      request.onsuccess = () => resolve(request.result?.handle ?? null);
      request.onerror = () => reject(request.error ?? new Error("无法读取已选目录。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("读取已选目录失败。"));
    });
  } finally {
    database.close();
  }
}

export async function saveSelectedDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  const database = await openDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        id: SELECTED_DIRECTORY_KEY,
        handle,
      } satisfies DirectoryRecord);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("无法保存目录授权信息。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("保存目录授权信息失败。"));
    });
  } finally {
    database.close();
  }
}
