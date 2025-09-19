'use client';

import { useState } from 'react';

export default function TokenConverter() {
  const [wordsToConvert, setWordsToConvert] = useState('');
  const [tokensToConvert, setTokensToConvert] = useState('');

  // Conversion ratios
  const WORDS_TO_TOKENS = 1.8; // 1 word ≈ 1.8 tokens
  const TOKENS_TO_WORDS = 0.55; // 1 token ≈ 0.55 words

  const convertTokensToWords = (tokens: number): number => {
    return Math.round(tokens * TOKENS_TO_WORDS);
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <h4 className="font-medium text-blue-900 mb-3">Words ↔ Tokens Converter</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Words to Tokens */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Words → Tokens (×1.8)
          </label>
          <div className="space-y-2">
            <textarea
              value={wordsToConvert}
              onChange={(e) => setWordsToConvert(e.target.value)}
              placeholder="Enter words or paste text here..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-20 text-sm resize-none"
            />
            <input
              type="text"
              value={wordsToConvert.trim() ?
                (isNaN(Number(wordsToConvert)) ?
                  Math.round(wordsToConvert.trim().split(/\s+/).filter(w => w.length > 0).length * WORDS_TO_TOKENS)
                  : Math.round(Number(wordsToConvert) * WORDS_TO_TOKENS)
                ) : ''
              }
              readOnly
              placeholder="Tokens will appear here..."
              className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-blue-600 font-semibold h-20 text-center text-lg"
            />
          </div>
        </div>

        {/* Tokens to Words */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tokens → Words (×0.55)
          </label>
          <div className="space-y-2">
            <textarea
              value={tokensToConvert}
              onChange={(e) => setTokensToConvert(e.target.value)}
              placeholder="Enter token count here..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-20 text-sm resize-none"
            />
            <input
              type="text"
              value={tokensToConvert ? convertTokensToWords(Number(tokensToConvert)) : ''}
              readOnly
              placeholder="Words will appear here..."
              className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-green-600 font-semibold h-20 text-center text-lg"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500 text-center">
        Conversion ratios: 1 word ≈ 1.8 tokens, 1 token ≈ 0.55 words
      </div>
    </div>
  );
}