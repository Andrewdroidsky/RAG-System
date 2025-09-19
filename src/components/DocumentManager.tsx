'use client';

import { useState } from 'react';
import { StoredDocument } from '@/lib/embeddings';

interface DocumentManagerProps {
  documents: StoredDocument[];
  onRemoveDocument: (filename: string) => void;
  onClearAll: () => void;
}

export default function DocumentManager({ documents, onRemoveDocument, onClearAll }: DocumentManagerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const totalChunks = documents.reduce((sum, doc) => sum + doc.chunks.length, 0);
  const totalTokens = documents.reduce((sum, doc) =>
    sum + doc.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.metadata.tokens, 0), 0
  );

  if (documents.length === 0) return null;

  return (
    <div className="w-full max-w-4xl mx-auto mb-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div
          className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center space-x-4">
            <h3 className="text-lg font-medium text-gray-900">
              Загруженные документы ({documents.length})
            </h3>
            <div className="text-sm text-gray-500">
              {totalChunks} фрагментов • {totalTokens.toLocaleString()} токенов
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearAll();
              }}
              className="text-sm text-red-600 hover:text-red-800 px-3 py-1 rounded border border-red-200 hover:border-red-300"
            >
              Очистить все
            </button>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-gray-200 p-4">
            <div className="space-y-3">
              {documents.map((doc) => {
                const docTokens = doc.chunks.reduce((sum, chunk) => sum + chunk.metadata.tokens, 0);
                const maxSection = Math.max(...doc.chunks.map(chunk => chunk.metadata.sectionNumber));

                return (
                  <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900 text-sm">
                        {doc.filename}
                      </h4>
                      <div className="text-xs text-gray-500 mt-1">
                        {doc.chunks.length} фрагментов • {maxSection} разделов • {docTokens.toLocaleString()} токенов
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Загружен: {new Date(doc.createdAt).toLocaleString('ru-RU')}
                      </div>
                    </div>
                    <button
                      onClick={() => onRemoveDocument(doc.filename)}
                      className="ml-4 text-red-600 hover:text-red-800 p-1"
                      title="Удалить документ"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}