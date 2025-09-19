'use client';

import { useState } from 'react';
import { RAGResponse } from '@/lib/ragQuery';

interface QueryInterfaceProps {
  onQuery: (question: string) => Promise<RAGResponse>;
  hasDocuments: boolean;
}

interface ChatMessage {
  id: string;
  type: 'question' | 'answer';
  content: string;
  response?: RAGResponse;
  timestamp: Date;
}

export default function QueryInterface({ onQuery, hasDocuments }: QueryInterfaceProps) {
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Query interface ready

  const getSectionLabel = (sectionType: string, sectionNumber: number): string => {
    switch (sectionType) {
      case 'page':
        return `стр. ${sectionNumber}`;
      case 'paragraph':
        return `параграф ${sectionNumber}`;
      case 'sheet':
        return `лист ${sectionNumber}`;
      case 'line':
        return `строка ${sectionNumber}`;
      default:
        return `раздел ${sectionNumber}`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !hasDocuments) return;

    const currentQuestion = question;
    const questionId = Date.now().toString();

    // Добавляем вопрос в историю
    const questionMessage: ChatMessage = {
      id: questionId,
      type: 'question',
      content: currentQuestion,
      timestamp: new Date()
    };

    setChatHistory(prev => [...prev, questionMessage]);
    setQuestion(''); // Очищаем поле
    setIsLoading(true);

    try {
      const result = await onQuery(currentQuestion);

      // Добавляем ответ в историю
      const answerMessage: ChatMessage = {
        id: questionId + '-answer',
        type: 'answer',
        content: result.answer,
        response: result,
        timestamp: new Date()
      };

      setChatHistory(prev => [...prev, answerMessage]);
    } catch (error) {
      console.error('Query error:', error);
      const errorMessage: ChatMessage = {
        id: questionId + '-error',
        type: 'answer',
        content: 'Произошла ошибка при обработке запроса.',
        response: {
          answer: 'Произошла ошибка при обработке запроса.',
          sources: [],
          tokensUsed: 0,
          cost: 0
        },
        timestamp: new Date()
      };
      setChatHistory(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className="w-full mx-auto">
      {/* История чата */}
      {chatHistory.length > 0 && (
        <div className="mb-8 space-y-4 max-h-[600px] overflow-y-auto border border-gray-200 rounded-lg p-4">
          {chatHistory.map((message) => (
            <div key={message.id} className={`flex ${message.type === 'question' ? 'justify-end' : 'justify-start'}`}>
              {message.type === 'question' ? (
                <div className="bg-blue-500 text-white rounded-lg px-4 py-2 max-w-[70%]">
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  <p className="text-xs text-blue-100 mt-1">
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              ) : (
                <div className="max-w-[85%]">
                  <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                    <div className="prose prose-sm max-w-none">
                      <p className="text-gray-800 whitespace-pre-wrap">{message.content}</p>
                    </div>
                    {message.response && (
                      <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center text-xs text-gray-500">
                        <span>Токенов: {message.response.tokensUsed}</span>
                        <span>Стоимость: ${message.response.cost.toFixed(4)}</span>
                        <span>{message.timestamp.toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                  {message.response && message.response.sources.length > 0 && (
                    <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <h5 className="text-xs font-medium text-gray-700 mb-2">
                        Источники ({message.response.sources.length})
                      </h5>
                      <div className="space-y-2">
                        {message.response.sources.slice(0, 3).map((source, index) => (
                          <div key={index} className="text-xs text-gray-600">
                            <span className="font-medium text-blue-600">
                              {source.filename}, {getSectionLabel(source.sectionType, source.sectionNumber)}
                            </span>
                            <p className="mt-1 truncate">{source.content}</p>
                          </div>
                        ))}
                        {message.response.sources.length > 3 && (
                          <p className="text-xs text-gray-500">
                            +{message.response.sources.length - 3} еще...
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-lg px-4 py-2">
                <div className="flex items-center space-x-2">
                  <div className="animate-spin w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full"></div>
                  <span className="text-gray-600">Обрабатываю...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Поле ввода */}
      <form onSubmit={handleSubmit} className="sticky bottom-0 bg-white border border-gray-300 rounded-lg p-4 shadow-lg">
        <div className="flex gap-4">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={hasDocuments ? "Задайте вопрос о документах... (Ctrl+Enter для отправки)" : "Сначала загрузите документы"}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none min-h-[80px]"
            disabled={!hasDocuments || isLoading}
            rows={3}
          />
          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={!question.trim() || !hasDocuments || isLoading}
              className={`px-6 py-3 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 min-w-[100px] transition-all duration-200 ${
                !hasDocuments || !question.trim()
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg cursor-pointer'
              }`}
            >
              {isLoading ? '...' : 'Отправить'}
            </button>
            {chatHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setChatHistory([])}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
              >
                Очистить
              </button>
            )}
          </div>
        </div>
      </form>

      {!hasDocuments && chatHistory.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-500 mb-4">
            <svg className="mx-auto w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Чат с документами
          </h3>
          <p className="text-gray-600">
            Загрузите документы и начните задавать вопросы. Система отвечает только на основе содержимого документов.
          </p>
        </div>
      )}
    </div>
  );
}