export interface ServerLibraryBook {
  name: string;
  path: string;
  size: number;
  modified: string;
  md5?: string;
}

const handleJsonResponse = async (response: Response) => {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok || (payload && payload.success === false)) {
    const message =
      (payload && payload.message) ||
      `Server responded with ${response.status}`;
    throw new Error(message);
  }
  return payload;
};

export const fetchServerLibraryBooks = async (): Promise<
  ServerLibraryBook[]
> => {
  const response = await fetch("/api/koodo/library/books", {
    credentials: "same-origin",
  });
  const payload = await handleJsonResponse(response);
  return payload?.books || [];
};

export const downloadServerLibraryBook = async (
  bookPath: string
): Promise<File> => {
  const response = await fetch(
    `/api/koodo/library/download?path=${encodeURIComponent(bookPath)}`,
    {
      credentials: "same-origin",
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to download ${bookPath}`);
  }

  const blob = await response.blob();
  const filename = bookPath.split("/").pop() || "book";

  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });

  try {
    Object.defineProperty(file, "path", {
      value: `/BookReader/Library/${bookPath}`,
      configurable: true,
    });
  } catch (error) {
    // Ignore if the environment doesn't allow extending File objects
  }

  return file;
};
