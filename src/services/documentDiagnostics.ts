import { EmbeddingsManager, StoredDocument } from '@/lib/embeddings';

export interface DocumentSummary {
  filename: string;
  totalChunks: number;
  fullPages: number;
  createdAt: string;
}

export async function getDocumentSummaries(embeddings: EmbeddingsManager): Promise<DocumentSummary[]> {
  const documents = await embeddings.getStoredDocuments();

  return documents.map((doc: StoredDocument) => ({
    filename: doc.filename,
    totalChunks: doc.chunks.length,
    fullPages: doc.fullPages.length,
    createdAt: doc.createdAt
  }));
}

export async function describeDocumentCoverage(embeddings: EmbeddingsManager): Promise<string> {
  const summaries = await getDocumentSummaries(embeddings);

  if (summaries.length === 0) {
    return 'No documents have been indexed yet. Upload your files to proceed.';
  }

  const totalChunks = summaries.reduce((sum, doc) => sum + doc.totalChunks, 0);
  const totalPages = summaries.reduce((sum, doc) => sum + doc.fullPages, 0);

  const header = `Document Status Report:
• Total files processed: ${summaries.length}
• Total text chunks: ${totalChunks}
• Total full pages: ${totalPages}

Files processed:`;

  const details = summaries
    .map((summary, index) =>
      `${index + 1}. ${summary.filename}
   - Chunks: ${summary.totalChunks}
   - Pages: ${summary.fullPages}
   - Uploaded: ${new Date(summary.createdAt).toLocaleString()}`
    )
    .join('\n');

  return `${header}\n${details}`;
}