'use client';

import { useState, useRef, useEffect } from 'react';
import { DocumentProcessor, ProcessedDocument } from '@/lib/documentProcessor';

interface FileUploadProps {
  onFilesProcessed: (documents: ProcessedDocument[]) => void;
  isProcessing: boolean;
  shouldResetPreview?: boolean;
}

export default function FileUpload({ onFilesProcessed, isProcessing, shouldResetPreview }: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [previewData, setPreviewData] = useState<{
    totalFiles: number;
    totalTokens: number;
    estimatedCost: { embedding: number; query: number };
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset preview when documents are cleared
  useEffect(() => {
    if (shouldResetPreview) {
      setPreviewData(null);
    }
  }, [shouldResetPreview]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = async (files: FileList) => {
    try {
      // Clear preview immediately when new files are selected
      setPreviewData(null);

      // Filter for supported file types
      const supportedFiles = Array.from(files).filter(file => {
        const extension = file.name.toLowerCase().split('.').pop();
        return DocumentProcessor.getSupportedExtensions().includes(extension || '');
      });

      if (supportedFiles.length === 0) {
        alert('Please select supported file formats: PDF, DOCX, TXT, XLSX');
        return;
      }

      // Process files for preview
      const documents = await DocumentProcessor.processMultipleFiles(supportedFiles as unknown as FileList);
      const totalTokens = documents.reduce((sum, doc) => sum + doc.totalTokens, 0);
      const estimatedCost = DocumentProcessor.calculateCost(totalTokens);

      setPreviewData({
        totalFiles: documents.length,
        totalTokens,
        estimatedCost
      });

      // Pass to parent
      onFilesProcessed(documents);
    } catch (error) {
      console.error('Error processing files:', error);
      alert('Error processing files');
      setPreviewData(null); // Clear preview on error
    }
  };

  const onButtonClick = () => {
    // Reset the input value to allow selecting the same files again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${dragActive
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
          }
          ${isProcessing ? 'opacity-50 pointer-events-none' : ''}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.xlsx"
          onChange={handleChange}
          className="hidden"
        />

        <div className="space-y-4">
          <div className="mx-auto w-12 h-12 text-gray-400">
            <svg fill="none" stroke="currentColor" viewBox="0 0 48 48">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              />
            </svg>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Upload Files (PDF, DOCX, TXT, XLSX)
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Drag files here or click to select
            </p>
            <button
              type="button"
              onClick={onButtonClick}
              disabled={isProcessing}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isProcessing ? 'Processing...' : 'Select Files'}
            </button>
          </div>
        </div>
      </div>

      {previewData && (
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-medium text-gray-900 mb-3">Preview:</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Files:</span>
              <span className="ml-2 font-medium">{previewData.totalFiles}</span>
            </div>
            <div>
              <span className="text-gray-600">Tokens:</span>
              <span className="ml-2 font-medium">{previewData.totalTokens.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-600">Embedding cost:</span>
              <span className="ml-2 font-medium text-green-600">
                ${previewData.estimatedCost.embedding.toFixed(4)}
              </span>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            * Estimated query cost: $0.03 per 1K tokens
          </div>
        </div>
      )}
    </div>
  );
}