import { useEffect, useMemo, useState } from 'react';
import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.tsx';
import EmbeddedPanel from './EmbeddedPanel.tsx';
import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';
import { useAction } from '$lib/react/useAction';
import './ToolboxPanel.css';

type UtilityTab = 'jwt' | 'json' | 'regex' | 'epoch' | 'coder' | 'embedded';

function getRelativeTimeString(time: number): string {
  const elapsed = time - Date.now();
  const isPast = elapsed < 0;
  const absElapsed = Math.abs(elapsed);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
    { unit: 'year', ms: 31536000000 },
    { unit: 'month', ms: 2629800000 },
    { unit: 'day', ms: 86400000 },
    { unit: 'hour', ms: 3600000 },
    { unit: 'minute', ms: 60000 },
    { unit: 'second', ms: 1000 },
  ];
  for (const { unit, ms } of units) {
    if (absElapsed >= ms || unit === 'second') {
      const count = Math.round(absElapsed / ms);
      return rtf.format(isPast ? -count : count, unit);
    }
  }
  return '';
}

function copyToClipboard(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => alert('Copied to clipboard!'))
    .catch((err) => alert(`Failed to copy: ${err}`));
}

const indentOptions: DropdownOption[] = [
  { value: '2', label: '2 Spaces' },
  { value: '4', label: '4 Spaces' },
  { value: 'tab', label: 'Tab Indent' },
];

export default function ToolboxPanel() {
  const tabsRef = useAction<HTMLDivElement>(clampHorizontalScroll);

  const [activeTab, setActiveTab] = useState<UtilityTab>('jwt');

  // JWT state
  const [jwtInput, setJwtInput] = useState('');
  const jwtHeader = useMemo(() => {
    try {
      if (!jwtInput.trim()) return '';
      const parts = jwtInput.split('.');
      if (parts.length < 2) return 'Invalid JWT structure';
      return JSON.stringify(JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))), null, 2);
    } catch (err: any) {
      return `Failed to decode header: ${err.message}`;
    }
  }, [jwtInput]);
  const jwtPayload = useMemo(() => {
    try {
      if (!jwtInput.trim()) return '';
      const parts = jwtInput.split('.');
      if (parts.length < 2) return 'Invalid JWT structure';
      return JSON.stringify(JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))), null, 2);
    } catch (err: any) {
      return `Failed to decode payload: ${err.message}`;
    }
  }, [jwtInput]);

  // JSON state
  const [jsonInput, setJsonInput] = useState('');
  const [jsonIndent, setJsonIndent] = useState('2');
  const [jsonOutput, setJsonOutput] = useState('');
  const [jsonError, setJsonError] = useState('');

  function formatJsonWith(input: string, indent: string) {
    try {
      if (!input.trim()) {
        setJsonOutput('');
        setJsonError('');
        return;
      }
      const parsed = JSON.parse(input);
      const space = indent === 'tab' ? '\t' : parseInt(indent, 10);
      setJsonOutput(JSON.stringify(parsed, null, space));
      setJsonError('');
    } catch (err: any) {
      setJsonError(err.message);
      setJsonOutput('');
    }
  }

  function formatJson() {
    formatJsonWith(jsonInput, jsonIndent);
  }

  function minifyJson() {
    try {
      if (!jsonInput.trim()) {
        setJsonOutput('');
        setJsonError('');
        return;
      }
      const parsed = JSON.parse(jsonInput);
      setJsonOutput(JSON.stringify(parsed));
      setJsonError('');
    } catch (err: any) {
      setJsonError(err.message);
      setJsonOutput('');
    }
  }

  function onJsonIndentChange(value: string) {
    setJsonIndent(value);
    formatJsonWith(jsonInput, value);
  }

  function onJsonInputChange(value: string) {
    setJsonInput(value);
    formatJsonWith(value, jsonIndent);
  }

  // Regex state
  const [regexPattern, setRegexPattern] = useState('([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,6})');
  const [regexFlags, setRegexFlags] = useState('g');
  const [regexText, setRegexText] = useState('Contact us at support@soryq.dev or admin@soryq.dev.');
  const [regexReplace, setRegexReplace] = useState('[email]');

  const regexMatches = useMemo(() => {
    try {
      if (!regexPattern) return [];
      const re = new RegExp(regexPattern, regexFlags);
      const matches: string[] = [];
      let match;
      if (regexFlags.includes('g')) {
        while ((match = re.exec(regexText)) !== null) {
          matches.push(match[0]);
          if (re.lastIndex === match.index) {
            re.lastIndex++; // Prevent infinite loops for zero-width matches
          }
        }
      } else {
        match = re.exec(regexText);
        if (match) matches.push(match[0]);
      }
      return matches;
    } catch (err) {
      return ['Invalid Regular Expression'];
    }
  }, [regexPattern, regexFlags, regexText]);

  const regexReplacedText = useMemo(() => {
    try {
      if (!regexPattern) return regexText;
      const re = new RegExp(regexPattern, regexFlags);
      return regexText.replace(re, regexReplace);
    } catch (err) {
      return 'Replacement error';
    }
  }, [regexPattern, regexFlags, regexText, regexReplace]);

  // Epoch state
  const [epochInput, setEpochInput] = useState(Math.floor(Date.now() / 1000).toString());
  const [dateInput, setDateInput] = useState(new Date().toISOString());
  const [currentEpoch, setCurrentEpoch] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timerId = setInterval(() => {
      setCurrentEpoch(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timerId);
  }, []);

  const epochDetails = useMemo(() => {
    try {
      let num = parseFloat(epochInput);
      if (isNaN(num)) return null;
      // Handle milliseconds
      if (epochInput.length >= 13) num = num / 1000;
      const d = new Date(num * 1000);
      return {
        local: d.toString(),
        utc: d.toUTCString(),
        iso: d.toISOString(),
        relative: getRelativeTimeString(d.getTime()),
      };
    } catch {
      return null;
    }
  }, [epochInput]);

  const dateToEpochResult = useMemo(() => {
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return 'Invalid Date';
      const sec = Math.floor(d.getTime() / 1000);
      const ms = d.getTime();
      return `Seconds: ${sec}\nMilliseconds: ${ms}`;
    } catch {
      return 'Invalid Date';
    }
  }, [dateInput]);

  function useCurrentEpoch() {
    setEpochInput(currentEpoch.toString());
  }

  // Base64 & URL state
  const [coderInput, setCoderInput] = useState('');
  const [coderOutput, setCoderOutput] = useState('');

  function coderAction(action: 'b64e' | 'b64d' | 'urle' | 'urld') {
    try {
      if (action === 'b64e') {
        // Handle unicode base64 safely
        setCoderOutput(
          btoa(
            encodeURIComponent(coderInput).replace(/%([0-9A-F]{2})/g, (_, p1) => {
              return String.fromCharCode(parseInt(p1, 16));
            }),
          ),
        );
      } else if (action === 'b64d') {
        setCoderOutput(
          decodeURIComponent(
            atob(coderInput)
              .split('')
              .map((c) => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
              })
              .join(''),
          ),
        );
      } else if (action === 'urle') {
        setCoderOutput(encodeURIComponent(coderInput));
      } else if (action === 'urld') {
        setCoderOutput(decodeURIComponent(coderInput));
      }
    } catch (err: any) {
      setCoderOutput(`Error: ${err.message}`);
    }
  }

  return (
    <div className="toolbox">
      {/* Tabs Header */}
      <div className="toolbox-tabs scrollable" ref={tabsRef}>
        <button
          className={`tab-btn${activeTab === 'jwt' ? ' active' : ''}`}
          onClick={() => setActiveTab('jwt')}
        >
          JWT Decoder
        </button>
        <button
          className={`tab-btn${activeTab === 'json' ? ' active' : ''}`}
          onClick={() => setActiveTab('json')}
        >
          JSON Format
        </button>
        <button
          className={`tab-btn${activeTab === 'regex' ? ' active' : ''}`}
          onClick={() => setActiveTab('regex')}
        >
          Regex Test
        </button>
        <button
          className={`tab-btn${activeTab === 'epoch' ? ' active' : ''}`}
          onClick={() => setActiveTab('epoch')}
        >
          Epoch
        </button>
        <button
          className={`tab-btn${activeTab === 'coder' ? ' active' : ''}`}
          onClick={() => setActiveTab('coder')}
        >
          Base64/URL
        </button>
        <button
          className={`tab-btn${activeTab === 'embedded' ? ' active' : ''}`}
          onClick={() => setActiveTab('embedded')}
        >
          Embedded
        </button>
      </div>

      {/* Content Panels */}
      <div className="toolbox-content">
        {/* JWT Decoder */}
        {activeTab === 'jwt' && (
          <div className="scrollable-tab-content scrollable">
            <div className="panel-section">
              <label className="section-label">JWT Token</label>
              <textarea
                className="textbox token-input"
                value={jwtInput}
                onChange={(e) => setJwtInput(e.target.value)}
                placeholder="Paste encoded JWT token here..."
              ></textarea>

              {jwtInput && (
                <div className="jwt-results">
                  <div className="result-block header-block">
                    <div className="block-title">
                      <span>HEADER</span>
                      <button className="copy-btn" onClick={() => copyToClipboard(jwtHeader)}>
                        Copy
                      </button>
                    </div>
                    <pre className="json-code">{jwtHeader}</pre>
                  </div>

                  <div className="result-block payload-block">
                    <div className="block-title">
                      <span>PAYLOAD (CLAIMS)</span>
                      <button className="copy-btn" onClick={() => copyToClipboard(jwtPayload)}>
                        Copy
                      </button>
                    </div>
                    <pre className="json-code">{jwtPayload}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* JSON Formatter */}
        {activeTab === 'json' && (
          <div className="scrollable-tab-content scrollable">
            <div className="panel-section">
              <div className="json-controls">
                <div className="control-group">
                  <label className="section-label">Spacing</label>
                  <div style={{ width: '120px' }}>
                    <Dropdown
                      options={indentOptions}
                      value={jsonIndent}
                      onChange={onJsonIndentChange}
                      ariaLabel="JSON Spacing"
                    />
                  </div>
                </div>
                <div className="json-actions">
                  <button className="action-btn" onClick={formatJson}>
                    Format
                  </button>
                  <button className="action-btn" onClick={minifyJson}>
                    Minify
                  </button>
                </div>
              </div>

              <div className="json-editors">
                <div className="editor-col">
                  <label className="section-label">Input JSON</label>
                  <textarea
                    className="textbox editor-box"
                    value={jsonInput}
                    onChange={(e) => onJsonInputChange(e.target.value)}
                    placeholder="Paste raw or unformatted JSON here..."
                  ></textarea>
                </div>
                <div className="editor-col">
                  <div className="block-title">
                    <label className="section-label">Formatted JSON</label>
                    {jsonOutput && (
                      <button className="copy-btn" onClick={() => copyToClipboard(jsonOutput)}>
                        Copy
                      </button>
                    )}
                  </div>
                  {jsonError ? (
                    <div className="error-box">{jsonError}</div>
                  ) : (
                    <textarea
                      className="textbox editor-box output-box"
                      value={jsonOutput}
                      readOnly
                      placeholder="Formatted output will appear here..."
                    ></textarea>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Regex Tester */}
        {activeTab === 'regex' && (
          <div className="scrollable-tab-content scrollable">
            <div className="panel-section">
              <div className="regex-header">
                <div className="input-wrap regex-field">
                  <label className="section-label">RegEx Pattern</label>
                  <div className="regex-regex-input">
                    <span className="regex-slash">/</span>
                    <input
                      type="text"
                      className="input-box"
                      value={regexPattern}
                      onChange={(e) => setRegexPattern(e.target.value)}
                      placeholder="Enter regex pattern..."
                    />
                    <span className="regex-slash">/</span>
                    <input
                      type="text"
                      className="input-box flags"
                      value={regexFlags}
                      onChange={(e) => setRegexFlags(e.target.value)}
                      placeholder="flags"
                      style={{ width: '50px' }}
                    />
                  </div>
                </div>
                <div className="input-wrap replace-field">
                  <label className="section-label">Replace String</label>
                  <input
                    type="text"
                    className="input-box"
                    value={regexReplace}
                    onChange={(e) => setRegexReplace(e.target.value)}
                    placeholder="Replacement..."
                  />
                </div>
              </div>

              <div className="regex-body">
                <div className="editor-col">
                  <label className="section-label">Test Text</label>
                  <textarea
                    className="textbox editor-box"
                    value={regexText}
                    onChange={(e) => setRegexText(e.target.value)}
                    placeholder="Text to evaluate matches against..."
                  ></textarea>
                </div>
                <div className="editor-col">
                  <label className="section-label">Matches ({regexMatches.length})</label>
                  <div className="match-list scrollable">
                    {regexMatches.length > 0 ? (
                      regexMatches.map((match, i) => (
                        <div className="match-item" key={i}>
                          {match}
                        </div>
                      ))
                    ) : (
                      <div className="no-matches">No matches found</div>
                    )}
                  </div>

                  <label className="section-label" style={{ marginTop: '10px' }}>
                    Replaced Text
                  </label>
                  <textarea className="textbox editor-box output-box" value={regexReplacedText} readOnly></textarea>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Epoch Converter */}
        {activeTab === 'epoch' && (
          <div className="scrollable-tab-content scrollable">
            <div className="panel-section epoch-panel">
              <div className="current-epoch-banner">
                <span className="label">CURRENT EPOCH</span>
                <span className="value">{currentEpoch}</span>
              </div>

              <div className="converter-box">
                <h3>Epoch Timestamp to Date</h3>
                <div className="convert-row">
                  <input
                    type="text"
                    className="input-box"
                    value={epochInput}
                    onChange={(e) => setEpochInput(e.target.value)}
                    placeholder="Epoch timestamp (seconds or ms)"
                  />
                  <button className="action-btn" onClick={useCurrentEpoch}>
                    Use Current
                  </button>
                </div>
                {epochDetails && (
                  <div className="epoch-results">
                    <div className="res-item">
                      <span className="label">Local:</span> <span className="val">{epochDetails.local}</span>
                    </div>
                    <div className="res-item">
                      <span className="label">UTC:</span> <span className="val">{epochDetails.utc}</span>
                    </div>
                    <div className="res-item">
                      <span className="label">ISO:</span> <span className="val">{epochDetails.iso}</span>
                    </div>
                    <div className="res-item">
                      <span className="label">Relative:</span> <span className="val">{epochDetails.relative}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="converter-box">
                <h3>Date to Epoch</h3>
                <div className="convert-row">
                  <input
                    type="text"
                    className="input-box"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    placeholder="ISO Date string or local format"
                  />
                </div>
                <pre className="epoch-results-raw">{dateToEpochResult}</pre>
              </div>
            </div>
          </div>
        )}

        {/* Base64 & URL Coder */}
        {activeTab === 'coder' && (
          <div className="scrollable-tab-content scrollable">
            <div className="panel-section coder-panel">
              <div className="json-editors">
                <div className="editor-col">
                  <label className="section-label">Input Text</label>
                  <textarea
                    className="textbox editor-box"
                    value={coderInput}
                    onChange={(e) => setCoderInput(e.target.value)}
                    placeholder="Text to encode or decode..."
                  ></textarea>
                  <div className="coder-actions">
                    <button className="action-btn" onClick={() => coderAction('b64e')}>
                      Base64 Encode
                    </button>
                    <button className="action-btn" onClick={() => coderAction('b64d')}>
                      Base64 Decode
                    </button>
                    <button className="action-btn" onClick={() => coderAction('urle')}>
                      URL Encode
                    </button>
                    <button className="action-btn" onClick={() => coderAction('urld')}>
                      URL Decode
                    </button>
                  </div>
                </div>
                <div className="editor-col">
                  <div className="block-title">
                    <label className="section-label">Output Result</label>
                    {coderOutput && !coderOutput.startsWith('Error:') && (
                      <button className="copy-btn" onClick={() => copyToClipboard(coderOutput)}>
                        Copy
                      </button>
                    )}
                  </div>
                  <textarea
                    className="textbox editor-box output-box"
                    value={coderOutput}
                    readOnly
                    placeholder="Output will appear here..."
                  ></textarea>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Embedded Devices */}
        {activeTab === 'embedded' && (
          <div className="scrollable-tab-content scrollable">
            <EmbeddedPanel />
          </div>
        )}
      </div>
    </div>
  );
}
