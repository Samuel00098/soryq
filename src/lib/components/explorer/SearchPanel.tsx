import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { get, type Writable } from '$lib/stores/storeCompat';
import { jumpToLine, openFile } from '$lib/stores/editor';
import {
  searchCaseSensitive,
  searchError,
  searchInclude,
  searchLoading,
  searchQuery,
  searchResults,
  searchUseRegex,
  searchWholeWord,
} from '$lib/stores/projectsearch';
import type { SearchFileResult, SearchMatch, SearchResponse } from '$lib/stores/zustand/projectsearch';
import { useStore } from '$lib/react/useStore';
import './SearchPanel.css';

function splitMatch(text: string, column: number, length: number) {
  const chars = Array.from(text);
  const start = Math.max(0, column - 1);
  return {
    before: chars.slice(0, start).join(''),
    hit: chars.slice(start, start + length).join(''),
    after: chars.slice(start + length).join(''),
  };
}

function SearchIcon() {
  return (
    <svg className="search-glass" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className={`chevron${collapsed ? ' collapsed' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function SearchPanel() {
  const query = useStore(searchQuery);
  const caseSensitive = useStore(searchCaseSensitive);
  const wholeWord = useStore(searchWholeWord);
  const useRegex = useStore(searchUseRegex);
  const include = useStore(searchInclude);
  const results = useStore(searchResults);
  const loading = useStore(searchLoading);
  const error = useStore(searchError);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function runSearch() {
    const currentQuery = get(searchQuery);
    if (!currentQuery) {
      searchResults.set(null);
      searchError.set(null);
      searchLoading.set(false);
      return;
    }

    searchLoading.set(true);
    searchError.set(null);
    try {
      const response = await invoke<SearchResponse>('search_in_project', {
        query: currentQuery,
        caseSensitive: get(searchCaseSensitive),
        wholeWord: get(searchWholeWord),
        useRegex: get(searchUseRegex),
        includeGlob: get(searchInclude).trim() || null,
      });
      searchResults.set(response);
    } catch (err) {
      searchError.set(String(err));
      searchResults.set(null);
    } finally {
      searchLoading.set(false);
    }
  }

  function scheduleSearch() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch();
    }, 250);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void runSearch();
    }
  }

  function toggleOption(store: Writable<boolean>) {
    store.update((value) => !value);
    scheduleSearch();
  }

  function toggleCollapse(path: string) {
    setCollapsed((current) => ({ ...current, [path]: !current[path] }));
  }

  async function openMatch(file: SearchFileResult, match: SearchMatch) {
    await openFile(file.path);
    jumpToLine.set({ path: file.path, line: match.line });
  }

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const totalMatches = results?.total_matches ?? 0;
  const fileCount = results?.files.length ?? 0;

  return (
    <div className="search-panel">
      <div className="search-header">
        <div className="search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="Search"
            value={query}
            onChange={(event) => {
              searchQuery.set(event.target.value);
              scheduleSearch();
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="search-toggles">
            <button className={`toggle-btn${caseSensitive ? ' active' : ''}`} onClick={() => toggleOption(searchCaseSensitive)} title="Match case" aria-label="Match case" aria-pressed={caseSensitive}>
              Aa
            </button>
            <button className={`toggle-btn${wholeWord ? ' active' : ''}`} onClick={() => toggleOption(searchWholeWord)} title="Match whole word" aria-label="Match whole word" aria-pressed={wholeWord}>
              <span className="ab-underline">ab</span>
            </button>
            <button className={`toggle-btn${useRegex ? ' active' : ''}`} onClick={() => toggleOption(searchUseRegex)} title="Use regular expression" aria-label="Use regular expression" aria-pressed={useRegex}>
              .*
            </button>
          </div>
        </div>
        <input
          className="search-include"
          type="text"
          placeholder="files to include, e.g. *.ts, src/**"
          value={include}
          onChange={(event) => {
            searchInclude.set(event.target.value);
            scheduleSearch();
          }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="search-status">
        {loading ? (
          <span className="status-text">Searching...</span>
        ) : error ? (
          <span className="status-text error">{error}</span>
        ) : results ? (
          totalMatches === 0 ? (
            <span className="status-text">No results found</span>
          ) : (
            <span className="status-text">
              {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {fileCount} {fileCount === 1 ? 'file' : 'files'}
              {results.truncated && <span className="truncated"> (truncated)</span>}
            </span>
          )
        ) : null}
      </div>

      <div className="search-results scrollable">
        {results?.files.map((file) => (
          <div className="file-group" key={file.path}>
            <button type="button" className="file-row" onClick={() => toggleCollapse(file.path)}>
              <ChevronIcon collapsed={Boolean(collapsed[file.path])} />
              <span className="file-name" title={file.rel_path}>{file.rel_path}</span>
              <span className="file-count">{file.matches.length}</span>
            </button>
            {!collapsed[file.path] &&
              file.matches.map((match) => {
                const parts = splitMatch(match.text, match.column, match.length);
                return (
                  <button
                    type="button"
                    className="match-row"
                    key={`${file.path}:${match.line}:${match.column}:${match.length}`}
                    onClick={() => void openMatch(file, match)}
                    title={`Line ${match.line}`}
                  >
                    <span className="match-line-no">{match.line}</span>
                    <span className="match-text">
                      <span className="match-before">{parts.before}</span>
                      <span className="match-hit">{parts.hit}</span>
                      <span className="match-after">{parts.after}</span>
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
