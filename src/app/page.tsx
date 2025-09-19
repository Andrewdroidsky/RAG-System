'use client';

import { useState, useEffect } from 'react';
import FileUpload from '@/components/FileUpload';
import QueryInterface from '@/components/QueryInterface';
import DocumentManager from '@/components/DocumentManager';
import ProgressIndicator from '@/components/ProgressIndicator';
import UniversalCostCalculator from '@/components/UniversalCostCalculator';
import TokenConverter from '@/components/TokenConverter';
import LanguageToggle from '@/components/LanguageToggle';
import { ProcessedDocument } from '@/lib/documentProcessor';
import { EmbeddingsManager, StoredDocument } from '@/lib/embeddings';
import { RAGQueryEngine } from '@/lib/ragQuery';

export default function Home() {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [ragEngine, setRagEngine] = useState<RAGQueryEngine | null>(null);
  const [embeddings, setEmbeddings] = useState<EmbeddingsManager | null>(null);
  const [shouldResetPreview, setShouldResetPreview] = useState(false);
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  const [progressSteps, setProgressSteps] = useState<Array<{
    id: string;
    label: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    progress?: number;
    details?: string;
  }>>([]);
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    // Use embedded API key from environment or fallback to manual input
    const embeddedApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    const savedApiKey = localStorage.getItem('openai-api-key');

    const keyToUse = (embeddedApiKey && embeddedApiKey !== 'your_openai_api_key_here')
      ? embeddedApiKey
      : savedApiKey;

    if (keyToUse) {
      setApiKey(keyToUse);
      initializeRAG(keyToUse);

      // Load existing documents
      const embeddingsManager = new EmbeddingsManager(keyToUse);
      embeddingsManager.getStoredDocuments().then(docs => {
        console.log('Loaded documents from storage:', docs.length);
        setDocuments(docs);
      });
    }
  }, []);

  const initializeRAG = (key: string) => {
    const engine = new RAGQueryEngine(key);
    const embeddingsManager = engine.getEmbeddingsManager();

    // Set up progress callback
    embeddingsManager.onProgress = (progress) => {
      setProgressSteps(() => [
        {
          id: 'embeddings',
          label: 'Creating Embeddings',
          status: progress.current === progress.total ? 'completed' : 'in_progress',
          progress: Math.round((progress.current / progress.total) * 100),
          details: progress.stage
        }
      ]);
    };

    setRagEngine(engine);
    setEmbeddings(embeddingsManager);
  };

  const handleApiKeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    localStorage.setItem('openai-api-key', apiKey);
    initializeRAG(apiKey);
  };

  const handleFilesProcessed = async (processedDocs: ProcessedDocument[]) => {
    if (!embeddings) return;

    setIsProcessing(true);
    setShowProgress(true);

    // Initialize progress steps
    setProgressSteps([
      {
        id: 'processing',
        label: `Processing ${processedDocs.length} files`,
        status: 'in_progress',
        progress: 0,
        details: processedDocs.map(doc => doc.filename).join(', ')
      },
      {
        id: 'embeddings',
        label: 'Creating Embeddings',
        status: 'pending',
        progress: 0
      }
    ]);

    // Clear preview to force fresh display
    setShouldResetPreview(true);
    setTimeout(() => setShouldResetPreview(false), 100);

    try {
      // Mark processing as completed
      setProgressSteps(prev => prev.map(step =>
        step.id === 'processing'
          ? { ...step, status: 'completed', progress: 100 }
          : step
      ));

      const storedDocs = await embeddings.createEmbeddings(processedDocs);
      setDocuments(prev => {
        const updated = [...prev, ...storedDocs];
        console.log('Documents updated:', updated.length); // Debug log
        return updated;
      });

      // Mark embeddings as completed
      setProgressSteps(prev => prev.map(step =>
        step.id === 'embeddings'
          ? { ...step, status: 'completed', progress: 100, details: 'Completed' }
          : step
      ));

      // Force refresh documents from storage to ensure UI update
      setTimeout(async () => {
        if (embeddings) {
          const refreshedDocs = await embeddings.getStoredDocuments();
          console.log('Refreshed documents:', refreshedDocs.length);
          setDocuments(refreshedDocs);
        }
        setShowProgress(false);
      }, 2000);

    } catch (error) {
      console.error('Error creating embeddings:', error);
      alert('Error creating embeddings. Please check your API key.');

      setProgressSteps(prev => prev.map(step =>
        step.status === 'in_progress'
          ? { ...step, status: 'error', details: 'Processing error' }
          : step
      ));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuery = async (question: string) => {
    if (!ragEngine) throw new Error('RAG engine not initialized');
    return await ragEngine.query(question, undefined, language);
  };

  const handleRemoveDocument = async (filename: string) => {
    if (embeddings) {
      await embeddings.removeDocument(filename);
      const updatedDocs = await embeddings.getStoredDocuments();
      setDocuments(updatedDocs);
    }
  };

  const handleClearAll = async () => {
    if (embeddings && confirm('Delete all documents?')) {
      await embeddings.clearStorage();
      setDocuments([]);
      setShouldResetPreview(true);
      setTimeout(() => setShouldResetPreview(false), 100);
    }
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('openai-api-key');
    setApiKey('');
    setRagEngine(null);
    setEmbeddings(null);
    setDocuments([]);
  };

  if (!ragEngine) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            RAG System
          </h1>
          <form onSubmit={handleApiKeySubmit} className="space-y-4">
            <div>
              <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-2">
                OpenAI API Key
              </label>
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Connect
            </button>
          </form>
          <p className="text-xs text-gray-500 mt-4 text-center">
            Key is stored locally and used only for API requests
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">RAG System</h1>
            <div className="flex items-center space-x-6">
              <LanguageToggle
                language={language}
                onLanguageChange={setLanguage}
              />
              <span className="text-sm text-gray-600">
                System Ready
              </span>
              <button
                onClick={handleClearApiKey}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          <div className="text-center">
            <p className="text-gray-600 mb-8">
              Upload documents and ask questions — answers are generated based on their content only.
            </p>
          </div>

          <FileUpload
            onFilesProcessed={handleFilesProcessed}
            isProcessing={isProcessing}
            shouldResetPreview={shouldResetPreview}
          />

          <DocumentManager
            documents={documents}
            onRemoveDocument={handleRemoveDocument}
            onClearAll={handleClearAll}
          />

          <TokenConverter />

          <UniversalCostCalculator />

          <QueryInterface
            onQuery={handleQuery}
            hasDocuments={documents.length > 0}
          />

        </div>

        <ProgressIndicator
          steps={progressSteps}
          isVisible={showProgress}
          onCancel={() => setShowProgress(false)}
        />
      </main>
    </div>
  );
}