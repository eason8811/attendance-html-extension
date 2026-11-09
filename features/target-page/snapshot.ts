export interface AttendancePageSnapshot {
  html: string;
}

export function serializeAttendanceDocument(documentRef: Document): AttendancePageSnapshot {
  const doctype = documentRef.doctype;
  const serializedDoctype = doctype ? `${serializeDoctype(doctype)}\n` : "";
  return { html: `${serializedDoctype}${documentRef.documentElement.outerHTML}` };
}

function serializeDoctype(doctype: DocumentType): string {
  const name = doctype.name || "html";
  if (doctype.publicId) {
    const systemId = doctype.systemId ? ` "${doctype.systemId}"` : "";
    return `<!DOCTYPE ${name} PUBLIC "${doctype.publicId}"${systemId}>`;
  }
  if (doctype.systemId) {
    return `<!DOCTYPE ${name} SYSTEM "${doctype.systemId}">`;
  }
  return `<!DOCTYPE ${name}>`;
}
